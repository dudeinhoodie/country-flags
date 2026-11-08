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
    /// The contract's hard limits on one import. An archive above them moves
    /// in pages, oldest sessions first; see `page(sessions:reviews:)`.
    private static let sessionLimit = 100
    private static let reviewLimit = 1000
    /// How many pages one run sends. The backend admits ten imports an account
    /// in its window, and a run that took them all would leave its own retry
    /// refused; whatever is left goes on the next launch, which finds the
    /// archive still holding work.
    private static let pagesPerRun = 5

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
        var moved: GuestImportResultRecord?
        for _ in 0..<Self.pagesPerRun {
            let (outcome, wasLastPage) = await importPage(into: userID)
            guard case .imported(let result) = outcome else {
                // Earlier pages of this run were acknowledged and let go, so
                // they stay moved; the page that did not land is where the
                // archive stands now.
                if outcome == .nothingToImport, let moved { return .imported(moved) }
                return outcome
            }
            moved = moved.map { Self.combined($0, result) } ?? result
            if wasLastPage { break }
        }
        return moved.map(GuestMigrationOutcome.imported) ?? .nothingToImport
    }

    /// Sends the next page of the archive.
    ///
    /// - Returns: how the page ended, and whether it was the archive's last.
    private func importPage(into userID: UUID) async -> (GuestMigrationOutcome, Bool) {
        guard let (scope, stored) = await archiveToImport(for: userID),
            case .guest(let installationID) = scope
        else {
            return (.refused, true)
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
            return (.nothingToImport, true)
        case .failure(.scopeBelongsToAnotherAccount):
            logger.log(
                .notice,
                .sync,
                "A guest archive already owned by another account was left alone"
            )
            return (.refused, true)
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

        let page = Self.page(sessions: sessions, reviews: reviews)
        if !page.isLast {
            logger.log(
                .notice,
                .sync,
                "The guest archive is above the import limits and moves in pages",
                [
                    "sessions": .count(sessions.count),
                    "reviews": .count(reviews.count),
                ]
            )
        }
        if page.droppedReviews > 0 {
            logger.log(
                .error,
                .sync,
                "Answers above the import limit were left out of the guest archive",
                ["reviews": .count(page.droppedReviews)]
            )
        }

        let payload = GuestImportPayload(
            migrationID: migrationID,
            sourceInstallID: installationID.uuidString.lowercased(),
            sessions: page.sessions,
            reviews: page.reviews
        )

        do {
            var result = try await importer.submit(payload)
            var attempts = 0
            while !result.status.isSettled, attempts < Self.statusAttempts {
                attempts += 1
                try await Task.sleep(for: Self.statusInterval)
                result = try await importer.status(migrationID: migrationID)
            }
            let outcome = await settle(
                result,
                page: page,
                scope: scope,
                migrationID: migrationID,
                userID: userID,
                startedAt: unfinished?.startedAt ?? dates.now()
            )
            return (outcome, page.isLast)
        } catch {
            // The record stays in progress and the same request is repeated on
            // the next sign-in or launch. Nothing local has been touched.
            return (.unavailable, page.isLast)
        }
    }

    /// One import's share of a guest archive.
    private struct Page {
        let sessions: [StudySessionRecord]
        let reviews: [ReviewEventRecord]
        /// Whether the page holds every session left, so that settling it
        /// settles the archive.
        let isLast: Bool
        /// Answers left out because one session alone held more than an
        /// import may carry. They go with their session when it is let go.
        let droppedReviews: Int
    }

    /// The oldest sessions that fit the contract's limits, each with every
    /// answer made in it.
    ///
    /// The pages used to be cut separately — the hundred newest sessions and
    /// the thousand earliest answers — so above both limits the answers sent
    /// belonged to sessions that were not, the backend refused them, the
    /// import settled as partial and the whole archive was erased with
    /// everything never sent.
    ///
    /// A session therefore never travels without its answers, nor with only
    /// some of them: the backend fingerprints an imported session by the
    /// cards its answers name, and the same session sent again with another
    /// share is refused as a different payload. Answers naming no stored
    /// session ride on the last page, as they always did.
    private static func page(
        sessions: [StudySessionRecord],
        reviews: [ReviewEventRecord]
    ) -> Page {
        let chronological = sessions.sorted { $0.startedAt < $1.startedAt }
        let bySession = Dictionary(grouping: reviews, by: \.sessionID)
        var taken: [StudySessionRecord] = []
        var answers: [ReviewEventRecord] = []
        var dropped = 0
        for session in chronological {
            let own = bySession[session.id] ?? []
            if taken.isEmpty, own.count > reviewLimit {
                // A sitting bigger than one import cannot be split without
                // being refused, so it goes alone and as much of it as fits.
                taken.append(session)
                answers += own.prefix(reviewLimit)
                dropped = own.count - reviewLimit
                break
            }
            guard taken.count < sessionLimit, answers.count + own.count <= reviewLimit else {
                break
            }
            taken.append(session)
            answers += own
        }
        let isLast = taken.count == chronological.count
        if isLast {
            let known = Set(chronological.map(\.id))
            let orphans = reviews.filter { !known.contains($0.sessionID) }
            let room = max(0, reviewLimit - answers.count)
            answers += orphans.prefix(room)
            dropped += orphans.count - min(orphans.count, room)
        }
        // The backend ingests in the order it is handed, which used to be
        // the order the answers were made in; grouping by session keeps it.
        answers.sort {
            ($0.clientOccurredAt, $0.clientSequence) < ($1.clientOccurredAt, $1.clientSequence)
        }
        return Page(sessions: taken, reviews: answers, isLast: isLast, droppedReviews: dropped)
    }

    /// Several pages, told as the one import the learner made.
    private static func combined(
        _ earlier: GuestImportResultRecord,
        _ later: GuestImportResultRecord
    ) -> GuestImportResultRecord {
        GuestImportResultRecord(
            migrationID: later.migrationID,
            status: earlier.status == .partial || later.status == .partial ? .partial : .applied,
            acceptedEventCount: earlier.acceptedEventCount + later.acceptedEventCount,
            duplicateEventCount: earlier.duplicateEventCount + later.duplicateEventCount,
            rejectedEventCount: earlier.rejectedEventCount + later.rejectedEventCount,
            completedAt: later.completedAt ?? earlier.completedAt
        )
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
        page: Page,
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
            // erased is the copy nobody can reach any more. A page that is
            // not the last lets go of its own sessions only: the rest of the
            // archive is still the only copy there is.
            if record.mayArchiveSourceScope {
                if page.isLast {
                    try? await cleaner.erase(scope: scope)
                } else {
                    do {
                        try await learning.deleteSessions(page.sessions.map(\.id), for: scope)
                    } catch {
                        // Harmless but wasteful: the next page sends these
                        // sessions again and the backend answers duplicates.
                        logger.log(.error, .sync, "An imported page of the guest archive was kept")
                    }
                }
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
