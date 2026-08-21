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
        guard let (scope, stored) = await archiveToImport() else { return .refused }
        guard case .guest(let installationID) = scope else { return .refused }

        if let stored, stored.mayArchiveSourceScope, stored.targetUserID == userID {
            // Already imported and acknowledged; there is nothing left to do
            // and nothing left to send.
            return .nothingToImport
        }

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
        let migrationID = stored?.migrationID ?? identifiers.next()
        await records.save(
            GuestMigrationRecord(
                migrationID: migrationID,
                sourceScopeKey: scope.key,
                targetUserID: userID,
                state: .inProgress,
                startedAt: stored?.startedAt ?? dates.now(),
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
                startedAt: stored?.startedAt ?? dates.now()
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
    private func archiveToImport() async -> (AccountScope, GuestMigrationRecord?)? {
        let current = await guestScopes.currentScope()
        if current.isGuest {
            return (current, await records.record(forScopeKey: current.key))
        }
        guard
            let unsettled = await records.unsettledRecord(),
            let recovered = AccountScope(key: unsettled.sourceScopeKey),
            recovered.isGuest
        else { return nil }
        return (recovered, unsettled)
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
