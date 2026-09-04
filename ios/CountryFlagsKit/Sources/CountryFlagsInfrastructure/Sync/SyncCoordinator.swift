import Foundation

import CountryFlagsDomain

/// Sends queued work to the backend and brings back what it decided.
///
/// Separated from the coordinator so the queue rules can be tested without a
/// socket, and so the coordinator does not know what a DTO looks like.
public protocol ReviewUploading: Sendable {
    func upload(_ operations: [OutboxOperationRecord]) async throws -> ReviewBatchOutcome
}

/// One synchronisation per account scope, whatever asked for it.
///
/// A launch, a returning network path and a pull-to-refresh routinely land
/// together. Each scope therefore has at most one run: a second caller joins
/// the one in flight instead of starting a race that would submit the same
/// review twice and write conflicting cursors. Scopes never sync together —
/// a guest and a signed-in account are different accounts, and merging their
/// queues would attribute one person's work to another.
public actor SyncCoordinator: SyncCoordinating {
    private let outbox: any OutboxRepository
    private let learning: any LearningRepository
    private let uploader: any ReviewUploading
    private let sessionImports: (any StudySessionImporting)?
    private let progressDownload: (any ProgressDownloading)?
    private let userChanges: (any UserChangesDownloading)?
    private let dates: any DateProviding
    private let logger: any AppLogging
    private let batchLimit: Int

    private var statuses: [String: SyncStatus] = [:]
    private var running: [String: Task<SyncStatus, Never>] = [:]
    /// Sessions the backend has been handed during this process. The import
    /// is idempotent, so this is a saving rather than a correctness device.
    private var importedSessions: Set<UUID> = []

    public init(
        outbox: any OutboxRepository,
        learning: any LearningRepository,
        uploader: any ReviewUploading,
        sessionImports: (any StudySessionImporting)? = nil,
        progressDownload: (any ProgressDownloading)? = nil,
        userChanges: (any UserChangesDownloading)? = nil,
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpLogger(),
        batchLimit: Int = 100
    ) {
        self.outbox = outbox
        self.learning = learning
        self.uploader = uploader
        self.sessionImports = sessionImports
        self.progressDownload = progressDownload
        self.userChanges = userChanges
        self.dates = dates
        self.logger = logger
        self.batchLimit = batchLimit
    }

    /// The phase, the last result and how much work is waiting.
    ///
    /// The count is read from the store rather than from the last run's
    /// snapshot: answering a card enqueues work without any sync happening, so
    /// a cached number would under-report the queue for as long as nothing
    /// triggered a run.
    public func status(for scope: AccountScope) async -> SyncStatus {
        let cached = statuses[scope.key]
        let pending = ((try? await outbox.pendingOperations(for: scope)) ?? []).count
        return SyncStatus(
            phase: cached?.phase ?? .idle,
            lastSuccessAt: cached?.lastSuccessAt,
            lastFailure: cached?.lastFailure,
            pendingCount: pending,
            isHeldForGuest: scope.isGuest
        )
    }

    /// A crash leaves work claimed but not sent. It belongs back in the queue on
    /// the next launch rather than staying invisible forever.
    public func recoverInterruptedWork(for scope: AccountScope) async {
        let requeued = (try? await outbox.requeueInterruptedOperations(for: scope)) ?? 0
        if requeued > 0 {
            logger.log(
                .notice,
                .sync,
                "Requeued work claimed by a run that did not finish",
                ["count": .count(requeued)]
            )
        }
        await publish(scope: scope, phase: .idle, failure: statuses[scope.key]?.lastFailure)
    }

    @discardableResult
    public func synchronize(scope: AccountScope, trigger: SyncTrigger) async -> SyncStatus {
        if let running = running[scope.key] {
            return await running.value
        }

        let task = Task<SyncStatus, Never> { [self] in
            let result = await run(scope: scope, trigger: trigger)
            // Deregistered by the task itself, in the same actor job that
            // finished the run: were it cleared only after the first caller
            // resumed, a caller arriving in between would join a run that is
            // already over and its trigger would be swallowed.
            running[scope.key] = nil
            return result
        }
        running[scope.key] = task
        return await task.value
    }

    // MARK: - The run

    private func run(scope: AccountScope, trigger: SyncTrigger) async -> SyncStatus {
        await publish(scope: scope, phase: .syncing, failure: statuses[scope.key]?.lastFailure)

        // A guest's work is durable but not sent: there is no account to
        // attribute it to until sign-in or import, and uploading it under a
        // throwaway identity would be worse than keeping it.
        guard !scope.isGuest else {
            logger.log(
                .debug,
                .sync,
                "Holding queued work: the device has no account yet",
                ["trigger": .safe(trigger.rawValue)]
            )
            return await publish(scope: scope, phase: .idle, failure: nil)
        }

        var uploadError: (any Error)?
        do {
            try await uploadPendingWork(scope: scope)
        } catch {
            // The failure is reported, but it must not starve the downlinks:
            // a device whose push cannot succeed — an unregistered device is
            // the standing example — still deserves the account's history.
            uploadError = error
        }
        // The canonical answers ride home on the same run that delivered
        // the questions: deck mastery, achievements and settings are the
        // backend's to compute, and the screens only ever read the store.
        let statesMiss = await pullCanonicalStates(scope: scope)
        let progressMiss = await pullCanonicalProgress(scope: scope)
        if let uploadError {
            return await publish(
                scope: scope,
                phase: .idle,
                failure: Self.failure(from: uploadError)
            )
        }
        // The queue went up, so nothing of the learner's is lost — but what
        // should have come back did not, and every screen re-reading the
        // store now reads yesterday. To the person looking that is a failed
        // run, whatever the upload did: the chip says so, the success time
        // stays where it was, and the network coming back asks again. This
        // used to pass as a success, which is how a day's queue went missing
        // behind a spinner that claimed to have checked.
        if let miss = progressMiss ?? statesMiss {
            return await publish(
                scope: scope,
                phase: .idle,
                failure: Self.failure(from: miss)
            )
        }
        return await publish(
            scope: scope,
            phase: .idle,
            failure: nil,
            recordSuccess: true
        )
    }

    /// Walks the account's change stream and applies the canonical card
    /// states it carries — which is how a fresh device inherits a learner's
    /// history, and how one device hears what another answered.
    ///
    /// Best effort like the aggregate downlink: a page that misses leaves the
    /// local states standing, and the next run resumes from the same cursor.
    /// The cursor moves only after its page has been applied, so a crash in
    /// between replays rather than skips — and replaying is safe because the
    /// merge keeps whichever state is newer.
    /// - Returns: what stopped the walk, or nil when the stream was read.
    private func pullCanonicalStates(scope: AccountScope) async -> (any Error)? {
        guard let userChanges, case .authenticated = scope else { return nil }
        do {
            var cursor = try await outbox.cursor(.userChanges, for: scope)?.cursor
            var didRestart = false
            var pendingWipe = false
            for _ in 0..<Self.maximumChangePages {
                let page: UserChangesPage
                do {
                    page = try await userChanges.changes(
                        after: cursor,
                        limit: Self.changePageLimit
                    )
                } catch let error as APIError where Self.isCursorRejection(error) {
                    // The stream was rotated under this device — progress was
                    // cleared — so the old cursor no longer resolves and the
                    // honest answer is to read again from the beginning.
                    guard cursor != nil, !didRestart else { throw error }
                    cursor = nil
                    didRestart = true
                    // The local states fall with the rotation, or their old
                    // version numbers would outrank everything the account
                    // writes after the wipe and the reset would never land.
                    // Deferred until the fresh stream answers: destroying
                    // local state over a refusal, without a replacement in
                    // hand, would be worse than being stale.
                    pendingWipe = true
                    continue
                }
                if pendingWipe {
                    try await learning.deleteAllCardStates(for: scope)
                    pendingWipe = false
                }
                var upserts: [UUID: CardStateRecord] = [:]
                var tombstoned: Set<UUID> = []
                for change in page.changes {
                    switch change.operation {
                    case .upsert:
                        guard let state = change.state else { continue }
                        upserts[change.cardID] = state
                        tombstoned.remove(change.cardID)
                    case .tombstone:
                        upserts[change.cardID] = nil
                        tombstoned.insert(change.cardID)
                    }
                }
                try await applyCanonical(states: Array(upserts.values), scope: scope)
                // A tombstone is applied, never skipped: the cursor is about
                // to move past this page, and a deletion it carried would
                // otherwise be consumed once and lost forever.
                try await learning.deleteCardStates(Array(tombstoned), for: scope)
                try await outbox.saveCursor(
                    SyncCursorRecord(
                        feed: .userChanges,
                        cursor: page.nextCursor,
                        updatedAt: dates.now()
                    ),
                    for: scope
                )
                cursor = page.nextCursor
                if !page.hasMore { return nil }
            }
            logger.log(
                .notice,
                .sync,
                "The change stream is longer than one run walks; the rest follows next run"
            )
            return nil
        } catch {
            logger.log(
                .notice,
                .sync,
                "The canonical card states could not be downloaded this run",
                ["code": .safe(String(describing: Self.failure(from: error)))]
            )
            return error
        }
    }

    private static let changePageLimit = 100
    private static let maximumChangePages = 30

    /// Whether the backend refused the cursor itself rather than the request.
    private static func isCursorRejection(_ error: APIError) -> Bool {
        switch error {
        case .validationFailed, .client: true
        default: false
        }
    }

    /// Kept apart from the upload by design: a downlink that misses must not
    /// block the queue going up, so the upload runs first and this reports
    /// rather than throws. But a miss is a miss — the run that carries it is
    /// published as failed, and yesterday's canon stays on screen only until
    /// the network comes back and the next run replaces it.
    ///
    /// - Returns: what stopped the download, or nil when everything arrived.
    private func pullCanonicalProgress(scope: AccountScope) async -> (any Error)? {
        guard let progressDownload else { return nil }
        do {
            try await store(try await progressDownload.download(), scope: scope)
            return nil
        } catch let partial as PartialProgressDownload {
            // What arrived is kept — the one request the radio dropped must
            // not cost the three that landed — and the miss is still a miss.
            try? await store(partial.delivered, scope: scope)
            logger.log(
                .notice,
                .sync,
                "The canonical progress arrived in part this run",
                [
                    "missing": .safe(partial.missing.map(\.rawValue).sorted().joined(separator: ",")),
                    "code": .safe(String(describing: Self.failure(from: partial.underlying))),
                ]
            )
            return partial.underlying
        } catch {
            logger.log(
                .notice,
                .sync,
                "The canonical progress could not be downloaded this run",
                ["code": .safe(String(describing: Self.failure(from: error)))]
            )
            return error
        }
    }

    /// Writes whichever documents a download brought.
    private func store(_ snapshot: ProgressSnapshot, scope: AccountScope) async throws {
        if let decks = snapshot.decks {
            try await learning.saveDeckProgress(decks, for: scope)
        }
        if let achievements = snapshot.achievements {
            try await learning.saveAchievements(achievements, for: scope)
        }
        // Stored rather than held: the breakdown is what the screen shows
        // beside its own count, and a relaunch should not have to wait for
        // a network before it can show anything but the local projection.
        if let dueSummary = snapshot.dueSummary {
            try await learning.saveDueSummary(dueSummary, for: scope)
        }
        if let serverSettings = snapshot.settings {
            // The server's settings win only by being newer: the version
            // moves when the server accepts a change, so an older number
            // must not roll back what another device just wrote through.
            let local = try await learning.settings(for: scope)
            if local == nil || serverSettings.version > (local?.version ?? 0) {
                try await learning.saveSettings(serverSettings, for: scope)
            }
        }
    }

    /// Sends the queue in order, a batch at a time, and applies each decision.
    private func uploadPendingWork(scope: AccountScope) async throws {
        // Reviews parked as sequence collisions are work the account still
        // deserves: builds before the renumbering parked every collision, and
        // a collision is the one refusal a fresh number can cure. They rejoin
        // the queue here and ship with this run.
        let parked = try await outbox.operations(failedWith: Self.sequenceConflict, for: scope)
            .filter { $0.kind == .reviewBatch }
        let revived = try await renumberAndRequeue(parked, scope: scope)
        if !revived.isEmpty {
            logger.log(
                .notice,
                .sync,
                "Revived reviews parked by sequence collisions",
                ["count": .count(revived.count)]
            )
        }

        while true {
            let pending = try await outbox.pendingOperations(for: scope)
                .filter { $0.kind == .reviewBatch }
            guard !pending.isEmpty else { return }

            var batch = Array(pending.prefix(batchLimit))
            // A review references a session, and the backend must hold the
            // session before it will take the review. Sessions the server
            // itself composed are already there; offline ones are imported
            // here, and an import the content can never satisfy fails its
            // reviews permanently rather than blocking the queue forever.
            batch = try await withSessionsImported(batch, scope: scope)
            guard !batch.isEmpty else {
                if pending.count <= batchLimit { return }
                continue
            }
            // Claiming first is what makes a crash recoverable: the operations
            // are visibly in flight, and `recoverInterruptedWork` puts them
            // back rather than leaving them lost.
            for operation in batch {
                try await outbox.updateState(
                    of: operation.id,
                    to: .inFlight,
                    failureCode: nil,
                    for: scope
                )
            }

            let outcome: ReviewBatchOutcome
            do {
                outcome = try await uploader.upload(batch)
            } catch {
                // Nothing was acknowledged, so everything goes back to pending
                // and keeps its identity for the retry.
                for operation in batch {
                    try? await outbox.updateState(
                        of: operation.id,
                        to: .pending,
                        failureCode: nil,
                        for: scope
                    )
                }
                throw error
            }

            try await apply(outcome, batch: batch, scope: scope)

            // A partial answer clears only what it acknowledged. Stopping here
            // rather than looping keeps a backend that answers nothing from
            // spinning this forever.
            let cleared = outcome.acknowledgements.filter(\.clearsPendingItem).count
            if cleared == 0 { return }
            if batch.count < batchLimit { return }
        }
    }

    /// Hands the backend every session the batch depends on, and returns the
    /// operations whose sessions it now holds.
    private func withSessionsImported(
        _ batch: [OutboxOperationRecord],
        scope: AccountScope
    ) async throws -> [OutboxOperationRecord] {
        guard let sessionImports else { return batch }

        var usable = batch
        let sessionIDs = Set(batch.compactMap(\.dependencyID))
        for sessionID in sessionIDs where !importedSessions.contains(sessionID) {
            guard let session = try await learning.session(id: sessionID, for: scope) else {
                // Reviews whose session the device no longer holds cannot be
                // attributed; they are closed out rather than retried forever.
                usable = try await failDependents(
                    of: sessionID, in: usable, scope: scope, code: "SESSION_MISSING"
                )
                continue
            }
            if session.selectionOrigin == "SERVER" {
                importedSessions.insert(sessionID)
                continue
            }
            do {
                try await sessionImports.importOfflineSession(session)
                importedSessions.insert(sessionID)
            } catch let error as APIError {
                switch error {
                case .conflict(let details), .validationFailed(let details),
                    .client(let details):
                    // The composition can never become acceptable by asking
                    // again — the deck changed underneath the session.
                    usable = try await failDependents(
                        of: sessionID, in: usable, scope: scope, code: details.code
                    )
                default:
                    // The network failed; the whole run retries later with
                    // everything still pending.
                    throw error
                }
            }
        }
        return usable
    }

    private func failDependents(
        of sessionID: UUID,
        in batch: [OutboxOperationRecord],
        scope: AccountScope,
        code: String
    ) async throws -> [OutboxOperationRecord] {
        logger.log(
            .error,
            .sync,
            "A session could not be imported and its reviews were closed out",
            ["code": .safe(code)]
        )
        for operation in batch where operation.dependencyID == sessionID {
            try await outbox.updateState(
                of: operation.id,
                to: .permanentFailure,
                failureCode: code,
                for: scope
            )
        }
        return batch.filter { $0.dependencyID != sessionID }
    }

    private func apply(
        _ outcome: ReviewBatchOutcome,
        batch: [OutboxOperationRecord],
        scope: AccountScope
    ) async throws {
        let submitted = Set(batch.map(\.id))
        let batchByID = Dictionary(uniqueKeysWithValues: batch.map { ($0.id, $0) })
        var canonicalStates: [CardStateRecord] = []
        var sequenceCollisions: [OutboxOperationRecord] = []

        for acknowledgement in outcome.acknowledgements {
            // The queue is keyed by operation IDs; the server's review IDs
            // were already traced back to them by the uploader. Matching on
            // the review ID here is the bug that once resent every batch
            // forever: nothing was ever marked, so nothing ever cleared.
            guard submitted.contains(acknowledgement.operationID) else {
                // An identifier this device did not send is not something to
                // act on.
                continue
            }

            switch acknowledgement.status {
            case .accepted, .duplicate:
                try await outbox.updateState(
                    of: acknowledgement.operationID,
                    to: .synced,
                    failureCode: nil,
                    for: scope
                )
            case .rejected where acknowledgement.rejectionCode == Self.sequenceConflict:
                // Not a verdict on the answer: the backend says the number is
                // taken, not that the review is wrong. The event itself is
                // absent — the duplicate check by review ID ran first — so
                // the same answer under a fresh number is simply accepted.
                // It queues for renumbering below instead of being parked.
                if let operation = batchByID[acknowledgement.operationID] {
                    sequenceCollisions.append(operation)
                }
            case .rejected:
                // Parked rather than retried: a refusal that came back once
                // will come back every time, and a loop is worse than a
                // diagnostic.
                try await outbox.updateState(
                    of: acknowledgement.operationID,
                    to: .permanentFailure,
                    failureCode: acknowledgement.rejectionCode,
                    for: scope
                )
                logger.log(
                    .error,
                    .sync,
                    "The backend refused a review",
                    ["code": .safe(acknowledgement.rejectionCode ?? "UNKNOWN")]
                )
            case .reconciliationPending:
                // Still the backend's business; it stays queued so the next run
                // asks again.
                try await outbox.updateState(
                    of: acknowledgement.operationID,
                    to: .pending,
                    failureCode: nil,
                    for: scope
                )
            }

            if let cardState = acknowledgement.cardState {
                canonicalStates.append(cardState)
            }
        }

        let renumbered = try await renumberAndRequeue(sequenceCollisions, scope: scope)
        for operation in sequenceCollisions where !renumbered.contains(operation.id) {
            // A collided payload this build cannot read cannot be corrected;
            // it keeps the parked fate so the loss stays visible.
            try await outbox.updateState(
                of: operation.id,
                to: .permanentFailure,
                failureCode: Self.sequenceConflict,
                for: scope
            )
        }

        // An item the answer did not mention was never decided, so it goes back
        // to pending rather than being assumed lost or assumed stored.
        let mentioned = Set(outcome.acknowledgements.map(\.operationID))
        for operation in batch where !mentioned.contains(operation.id) {
            try await outbox.updateState(
                of: operation.id,
                to: .pending,
                failureCode: nil,
                for: scope
            )
        }

        try await applyCanonical(states: canonicalStates, scope: scope)

        // The batch answer names the stream's latest cursor, but writing it
        // would skip every change between the device's last read and now —
        // on a fresh device, the account's whole history. The changes pull
        // owns the cursor and moves it only over pages it has applied.
    }

    // MARK: - Sequence collisions

    /// The backend's code for "this clientSequence is already taken".
    private static let sequenceConflict = "SEQUENCE_CONFLICT"

    /// The fields renumbering reads from a queued payload. Nothing else is
    /// decoded: the bytes an earlier build promised to send are edited in
    /// place, not rebuilt from current types.
    private struct QueuedReviewSequence: Decodable {
        let clientOccurredAt: Date
        let clientSequence: Int64
    }

    /// The last sequence number renumbering handed out. It can run twice in
    /// one process — reviving parked work, then answering a fresh rejection —
    /// and both must stay unique even inside one millisecond.
    private var lastIssuedSequence: Int64 = 0

    /// Returns collided reviews to the queue under fresh sequence numbers and
    /// answers with the identifiers it managed to renumber.
    ///
    /// A sequence collision is the one refusal a retry can fix, because the
    /// number is the whole complaint: per-session numbering from before the
    /// wall-clock fix, or a reset store resuming from one, collides with
    /// history the backend already holds. The fresh numbers are wall-clock
    /// milliseconds — what a new answer would get — assigned in the order the
    /// answers were given so the per-device sequence keeps telling the truth.
    /// The review ID is untouched: an answer that did land but lost its
    /// acknowledgement still resolves as a duplicate, never as a second
    /// review.
    private func renumberAndRequeue(
        _ operations: [OutboxOperationRecord],
        scope: AccountScope
    ) async throws -> Set<UUID> {
        guard !operations.isEmpty else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let readable = operations
            .compactMap { operation -> (operation: OutboxOperationRecord, stored: QueuedReviewSequence)? in
                guard
                    let stored = try? decoder.decode(
                        QueuedReviewSequence.self,
                        from: operation.payload
                    )
                else { return nil }
                return (operation, stored)
            }
            .sorted {
                ($0.stored.clientOccurredAt, $0.stored.clientSequence)
                    < ($1.stored.clientOccurredAt, $1.stored.clientSequence)
            }

        var renumbered: Set<UUID> = []
        for (operation, _) in readable {
            guard
                var payload = try? JSONSerialization.jsonObject(with: operation.payload)
                    as? [String: Any]
            else { continue }
            let next = max(
                Int64(dates.now().timeIntervalSince1970 * 1000),
                lastIssuedSequence + 1
            )
            lastIssuedSequence = next
            payload["clientSequence"] = next
            guard
                let data = try? JSONSerialization.data(
                    withJSONObject: payload,
                    options: [.sortedKeys]
                )
            else { continue }
            try await outbox.requeue(operation.id, withPayload: data, for: scope)
            renumbered.insert(operation.id)
        }
        return renumbered
    }

    /// Replaces local projections with what the server decided.
    private func applyCanonical(states: [CardStateRecord], scope: AccountScope) async throws {
        guard !states.isEmpty else { return }
        let local = try await learning.cardStates(for: scope)
        let localByCard = Dictionary(
            local.map { ($0.learningCardID, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        var merged: [CardStateRecord] = []
        for canonical in states {
            if let resolved = CanonicalStateMerge.resolve(
                canonical: canonical,
                local: localByCard[canonical.learningCardID]
            ) {
                merged.append(resolved)
            }
        }
        guard !merged.isEmpty else { return }
        // The save is an upsert: rows the page did not mention stand as they
        // are, so only the resolved states need writing.
        try await learning.saveCardStates(merged, for: scope)
    }

    // MARK: - Status

    @discardableResult
    private func publish(
        scope: AccountScope,
        phase: SyncPhase,
        failure: SyncFailure?,
        recordSuccess: Bool = false
    ) async -> SyncStatus {
        let pending = ((try? await outbox.pendingOperations(for: scope)) ?? []).count
        let previous = statuses[scope.key]
        let status = SyncStatus(
            phase: phase,
            lastSuccessAt: recordSuccess ? dates.now() : previous?.lastSuccessAt,
            lastFailure: failure,
            pendingCount: pending,
            isHeldForGuest: scope.isGuest
        )
        statuses[scope.key] = status
        return status
    }

    private static func failure(from error: any Error) -> SyncFailure {
        // Nothing can be attributed until a device is registered, and asking
        // again without registering cannot change that.
        if error as? ReviewUploadFailure == .deviceNotRegistered { return .unauthorized }
        guard let apiError = error as? APIError else { return .recoverable(code: "UNKNOWN") }
        switch apiError {
        case .transport, .cancelled:
            return .offline
        case .unauthorized, .forbidden:
            return .unauthorized
        case .rateLimited(_, let retryAfter):
            return .throttled(
                retryAfter: retryAfter.map { TimeInterval($0.components.seconds) }
            )
        default:
            return .recoverable(code: apiError.details?.code ?? "UNKNOWN")
        }
    }
}
