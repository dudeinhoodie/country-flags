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
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpLogger(),
        batchLimit: Int = 100
    ) {
        self.outbox = outbox
        self.learning = learning
        self.uploader = uploader
        self.sessionImports = sessionImports
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
            await run(scope: scope, trigger: trigger)
        }
        running[scope.key] = task
        let result = await task.value
        running[scope.key] = nil
        return result
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

        do {
            try await uploadPendingWork(scope: scope)
            return await publish(
                scope: scope,
                phase: .idle,
                failure: nil,
                recordSuccess: true
            )
        } catch {
            return await publish(scope: scope, phase: .idle, failure: Self.failure(from: error))
        }
    }

    /// Sends the queue in order, a batch at a time, and applies each decision.
    private func uploadPendingWork(scope: AccountScope) async throws {
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
        var canonicalStates: [CardStateRecord] = []

        for acknowledgement in outcome.acknowledgements {
            guard submitted.contains(acknowledgement.eventID) else {
                // An identifier this device did not send is not something to
                // act on.
                continue
            }

            switch acknowledgement.status {
            case .accepted, .duplicate:
                try await outbox.updateState(
                    of: acknowledgement.eventID,
                    to: .synced,
                    failureCode: nil,
                    for: scope
                )
            case .rejected:
                // Parked rather than retried: a refusal that came back once
                // will come back every time, and a loop is worse than a
                // diagnostic.
                try await outbox.updateState(
                    of: acknowledgement.eventID,
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
                    of: acknowledgement.eventID,
                    to: .pending,
                    failureCode: nil,
                    for: scope
                )
            }

            if let cardState = acknowledgement.cardState {
                canonicalStates.append(cardState)
            }
        }

        // An item the answer did not mention was never decided, so it goes back
        // to pending rather than being assumed lost or assumed stored.
        let mentioned = Set(outcome.acknowledgements.map(\.eventID))
        for operation in batch where !mentioned.contains(operation.id) {
            try await outbox.updateState(
                of: operation.id,
                to: .pending,
                failureCode: nil,
                for: scope
            )
        }

        try await applyCanonical(states: canonicalStates, scope: scope)

        if let cursor = outcome.cursor {
            // The cursor moves only after the page it describes has been
            // applied, so a crash in between replays rather than skips.
            try await outbox.saveCursor(
                SyncCursorRecord(feed: .userChanges, cursor: cursor, updatedAt: dates.now()),
                for: scope
            )
        }
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

        let untouched = local.filter { state in
            !merged.contains { $0.learningCardID == state.learningCardID }
        }
        try await learning.saveCardStates(untouched + merged, for: scope)
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
