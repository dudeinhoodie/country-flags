import Foundation

import CountryFlagsDomain

/// Moves the guest's work into the account that just signed in.
///
/// The rules are the domain's (`GuestMigrationPolicy`); this actor owns the
/// order of operations, which is where the safety lives: the migration
/// identifier is fixed before anything is sent, the record is written before
/// the request leaves, and the local archive is erased only after the backend
/// has said — and been heard to say — that it holds the work.
public actor GuestMigrationCoordinator: GuestMigrationRunning {
    /// The contract's hard limits on one import. A guest with more than this
    /// has to be extraordinarily dedicated; the newest sessions and the
    /// earliest reviews are kept, and the clamp is logged rather than silent.
    private static let sessionLimit = 100
    private static let reviewLimit = 1000

    /// How long to keep asking after a submit comes back PENDING before
    /// leaving the rest to the next attempt.
    private static let statusAttempts = 3
    private static let statusInterval: Duration = .milliseconds(800)

    private let guestScopes: any AccountScopeResolving
    private let learning: any LearningRepository
    private let importer: any GuestImportSubmitting
    private let records: any GuestMigrationRecordStoring
    private let cleaner: any AccountScopeCleaner
    private let dates: any DateProviding
    private let identifiers: any IdentifierProviding
    private let logger: any AppLogging

    public init(
        guestScopes: any AccountScopeResolving,
        learning: any LearningRepository,
        importer: any GuestImportSubmitting,
        records: any GuestMigrationRecordStoring,
        cleaner: any AccountScopeCleaner,
        dates: any DateProviding = SystemDateProvider(),
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        logger: any AppLogging = OSLogAppLogger()
    ) {
        self.guestScopes = guestScopes
        self.learning = learning
        self.importer = importer
        self.records = records
        self.cleaner = cleaner
        self.dates = dates
        self.identifiers = identifiers
        self.logger = logger
    }

    public func importGuestWork(into userID: UUID) async -> GuestMigrationOutcome {
        guard let (scope, stored) = await archiveToImport(for: userID) else { return .refused }
        guard case .guest(let installationID) = scope else { return .refused }

        let sessions = (try? await learning.sessions(for: scope)) ?? []
        let reviews = (try? await learning.reviews(for: scope)) ?? []

        switch GuestMigrationPolicy.canImport(
            guestScope: scope,
            previousOwner: stored?.targetUserID,
            targetUserID: userID,
            hasWork: !sessions.isEmpty || !reviews.isEmpty
        ) {
        case .failure(.nothingToImport):
            return .nothingToImport
        case .failure(.scopeBelongsToAnotherAccount):
            logger.log(
                .notice,
                .sync,
                "A guest archive already owned by another account was left alone"
            )
            return .refused
        case .success:
            break
        }

        // Fixed before anything is sent, and reused on every retry: the
        // identifier is what lets the backend see one archive rather than as
        // many as the network failed.
        //
        // A settled record's identifier belongs to the archive it already
        // moved, though. Reusing it for work done afterwards asks the backend
        // about the old import and gets its old answer, so this batch is only
        // ever a retry of an import that has not finished.
        let unfinished = stored.flatMap { $0.isSettled ? nil : $0 }
        let migrationID = unfinished?.migrationID ?? identifiers.next()
        await records.save(
            GuestMigrationRecord(
                migrationID: migrationID,
                sourceScopeKey: scope.key,
                targetUserID: userID,
                state: .inProgress,
                startedAt: unfinished?.startedAt ?? dates.now(),
                acknowledgedAt: nil
            )
        )

        if sessions.count > Self.sessionLimit || reviews.count > Self.reviewLimit {
            logger.log(
                .error,
                .sync,
                "The guest archive exceeds the import limits and was clamped",
                [
                    "sessions": .count(sessions.count),
                    "reviews": .count(reviews.count),
                ]
            )
        }

        let payload = GuestImportPayload(
            migrationID: migrationID,
            sourceInstallID: installationID.uuidString.lowercased(),
            sessions: Array(sessions.prefix(Self.sessionLimit)),
            reviews: Array(reviews.prefix(Self.reviewLimit))
        )

        do {
            var result = try await importer.submit(payload)
            var attempts = 0
            while !result.status.isSettled, attempts < Self.statusAttempts {
                attempts += 1
                try await Task.sleep(for: Self.statusInterval)
                result = try await importer.status(migrationID: migrationID)
            }
            return await settle(
                result,
                scope: scope,
                migrationID: migrationID,
                userID: userID,
                startedAt: unfinished?.startedAt ?? dates.now()
            )
        } catch {
            // The record stays in progress and the same request is repeated on
            // the next sign-in or launch. Nothing local has been touched.
            return .unavailable
        }
    }

    /// Which archive this attempt is about, and what is already known about
    /// it.
    ///
    /// While the device is still a guest, that is simply the scope it studies
    /// under. Once it has signed in it is not — and signing in is exactly
    /// when a half-finished import is supposed to be picked up again. Asking
    /// for the current scope then answers "the account", which is not an
    /// archive, and the retry refused itself on the only path that ever
    /// reaches it: the record went on saying `inProgress` for as long as the
    /// app was installed, and the answers under the guest scope were
    /// unreachable for just as long.
    ///
    /// The record is the one thing that still knows, so it is what gets
    /// asked.
    private func archiveToImport(
        for userID: UUID
    ) async -> (AccountScope, GuestMigrationRecord?)? {
        let current = await guestScopes.currentScope()
        if current.isGuest {
            return (current, await records.record(forScopeKey: current.key))
        }
        // Unfinished archives first: that work has been waiting longest, and
        // a settled one is only worth reopening if the guest studied again
        // afterwards — which is what having anything left to send means.
        let candidates = await records.all()
            .filter { $0.targetUserID == userID }
            .sorted { left, right in
                left.isSettled == right.isSettled
                    ? left.startedAt < right.startedAt
                    : !left.isSettled
            }
        for record in candidates {
            guard
                let recovered = AccountScope(key: record.sourceScopeKey),
                recovered.isGuest
            else { continue }
            if !record.isSettled { return (recovered, record) }
            if await holdsWork(recovered) { return (recovered, record) }
        }
        return nil
    }

    /// Whether a guest scope still has anything worth moving.
    ///
    /// A device that goes back to studying as a guest — which it does, since
    /// a launch that cannot restore the session falls back to one — writes
    /// under a scope an acknowledged record had already closed the door on.
    /// That work is only visible by looking.
    private func holdsWork(_ scope: AccountScope) async -> Bool {
        let sessions = (try? await learning.sessions(for: scope)) ?? []
        if !sessions.isEmpty { return true }
        return !((try? await learning.reviews(for: scope)) ?? []).isEmpty
    }

    private func settle(
        _ result: GuestImportResultRecord,
        scope: AccountScope,
        migrationID: UUID,
        userID: UUID,
        startedAt: Date
    ) async -> GuestMigrationOutcome {
        switch result.status {
        case .pending:
            return .pending
        case .applied, .partial:
            let record = GuestMigrationRecord(
                migrationID: migrationID,
                sourceScopeKey: scope.key,
                targetUserID: userID,
                state: .completed,
                startedAt: startedAt,
                acknowledgedAt: dates.now()
            )
            await records.save(record)
            // Only now, with the acknowledgement written down, may the guest
            // archive go. The reviews live on under the account; what is
            // erased is the copy nobody can reach any more.
            if record.mayArchiveSourceScope {
                try? await cleaner.erase(scope: scope)
            }
            return .imported(result)
        case .failed:
            await records.save(
                GuestMigrationRecord(
                    migrationID: migrationID,
                    sourceScopeKey: scope.key,
                    targetUserID: userID,
                    state: .failed,
                    startedAt: startedAt,
                    acknowledgedAt: nil
                )
            )
            logger.log(.error, .sync, "The backend refused the guest archive")
            return .failed(result)
        }
    }
}
