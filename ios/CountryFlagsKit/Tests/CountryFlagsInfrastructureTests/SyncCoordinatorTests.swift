import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The queue rules: what is sent, what is cleared, what stays, and what a crash
/// or a second trigger does to any of it.
final class SyncCoordinatorTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000001")!
    )
    private let guestScope = AccountScope.guest(
        installationID: UUID(uuidString: "91000000-0000-4000-8000-000000000001")!
    )

    // MARK: - Coalescing

    /// Two triggers landing together must not submit the same review twice.
    func testConcurrentTriggersProduceOneRun() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        try await enqueue(count: 2, into: outbox, scope: account)
        let uploader = RecordingUploader(acknowledgeAll: .accepted)
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        // Hoisted so the concurrent calls capture a value rather than the test
        // case itself.
        let scope = account
        async let first = coordinator.synchronize(scope: scope, trigger: .launch)
        async let second = coordinator.synchronize(scope: scope, trigger: .pullToRefresh)
        _ = await (first, second)

        let uploads = await uploader.uploadCount()
        XCTAssertEqual(uploads, 1)
    }

    /// A guest and a signed-in account are different accounts; their queues are
    /// never merged.
    func testAGuestQueueIsStoredButNeverSent() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        try await enqueue(count: 3, into: outbox, scope: guestScope)
        let uploader = RecordingUploader(acknowledgeAll: .accepted)
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        let status = await coordinator.synchronize(scope: guestScope, trigger: .launch)

        let uploads = await uploader.uploadCount()
        XCTAssertEqual(uploads, 0)
        XCTAssertTrue(status.isHeldForGuest)
        XCTAssertNil(status.lastFailure)
        // The work is still there, and the status says how much.
        XCTAssertEqual(status.pendingCount, 3)
        let pending = try await outbox.pendingOperations(for: guestScope)
        XCTAssertEqual(pending.count, 3)
    }

    // MARK: - Acknowledgement

    func testAcceptedAndDuplicateBothClearTheQueue() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let ids = try await enqueue(count: 2, into: outbox, scope: account)
        let uploader = RecordingUploader(
            results: [
                ids[0]: .accepted,
                // A duplicate means an earlier attempt already landed, which is
                // exactly what the queue existed to achieve.
                ids[1]: .duplicate,
            ]
        )
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        await coordinator.synchronize(scope: account, trigger: .launch)

        let pending = try await outbox.pendingOperations(for: account)
        XCTAssertTrue(pending.isEmpty)
    }

    /// A partial answer clears only what it acknowledged.
    func testAPartialAnswerLeavesTheRestQueued() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let ids = try await enqueue(count: 3, into: outbox, scope: account)
        let uploader = RecordingUploader(results: [ids[0]: .accepted])
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        await coordinator.synchronize(scope: account, trigger: .launch)

        let pending = try await outbox.pendingOperations(for: account)
        XCTAssertEqual(Set(pending.map(\.id)), Set([ids[1], ids[2]]))
    }

    /// A refusal that came back once will come back every time, so it is parked
    /// with its code instead of retried forever.
    func testARejectionIsParkedRatherThanRetried() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let ids = try await enqueue(count: 1, into: outbox, scope: account)
        let uploader = RecordingUploader(
            results: [ids[0]: .rejected],
            rejectionCode: "OFFLINE_MODE_UNSUPPORTED"
        )
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        await coordinator.synchronize(scope: account, trigger: .launch)
        // A second run must not pick it up again.
        await coordinator.synchronize(scope: account, trigger: .foreground)

        let pending = try await outbox.pendingOperations(for: account)
        XCTAssertTrue(pending.isEmpty)
        let uploads = await uploader.uploadCount()
        XCTAssertEqual(uploads, 1)
    }

    /// A rejected event must not hold back the ones that were accepted.
    func testARejectionDoesNotBlockAcknowledgedWork() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let ids = try await enqueue(count: 2, into: outbox, scope: account)
        let uploader = RecordingUploader(results: [ids[0]: .rejected, ids[1]: .accepted])
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        await coordinator.synchronize(scope: account, trigger: .launch)

        let pending = try await outbox.pendingOperations(for: account)
        XCTAssertTrue(pending.isEmpty)
    }

    /// Work the backend has not settled stays queued rather than being assumed
    /// stored.
    func testReconciliationPendingStaysQueued() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let ids = try await enqueue(count: 1, into: outbox, scope: account)
        let uploader = RecordingUploader(results: [ids[0]: .reconciliationPending])
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        await coordinator.synchronize(scope: account, trigger: .launch)

        let pending = try await outbox.pendingOperations(for: account)
        XCTAssertEqual(pending.count, 1)
    }

    // MARK: - Failure and recovery

    /// A refused request acknowledges nothing, so everything goes back to the
    /// queue with its identity intact and the next attempt is a replay, not a
    /// second review.
    func testAFailedRequestReturnsTheWholeBatchToTheQueue() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let ids = try await enqueue(count: 2, into: outbox, scope: account)
        let uploader = RecordingUploader(failure: APIError.transport("offline"))
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertEqual(status.lastFailure, .offline)
        let pending = try await outbox.pendingOperations(for: account)
        XCTAssertEqual(Set(pending.map(\.id)), Set(ids))
    }

    /// A kill mid-request leaves work claimed. It belongs back in the queue on
    /// the next launch rather than staying invisible.
    func testInterruptedWorkIsRecoveredOnTheNextLaunch() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let ids = try await enqueue(count: 2, into: outbox, scope: account)
        for id in ids {
            try await outbox.updateState(of: id, to: .inFlight, failureCode: nil, for: account)
        }
        let coordinator = makeCoordinator(
            store: store,
            uploader: RecordingUploader(acknowledgeAll: .accepted)
        )

        await coordinator.recoverInterruptedWork(for: account)

        let pending = try await outbox.pendingOperations(for: account)
        XCTAssertEqual(Set(pending.map(\.id)), Set(ids))
    }

    func testARefusalIsClassifiedSoTheUICanExplainIt() async throws {
        let store = try LocalStore(location: .inMemory)
        try await enqueue(count: 1, into: store.makeOutboxRepository(), scope: account)
        let coordinator = makeCoordinator(
            store: store,
            uploader: RecordingUploader(
                failure: APIError.unauthorized(
                    APIErrorDetails(statusCode: 401, code: "UNAUTHORIZED", message: "", requestID: nil)
                )
            )
        )

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertEqual(status.lastFailure, .unauthorized)
        // Asking again cannot help, so the UI must not offer it.
        XCTAssertFalse(status.lastFailure?.isRetryable ?? true)
    }

    // MARK: - Canonical state

    /// The server's state replaces the guess the device was showing.
    func testCanonicalStateReplacesTheLocalProjection() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let learning = store.makeLearningRepository()
        let cardID = UUID(uuidString: "50000000-0000-4000-8000-000000000001")!
        try await learning.saveCardStates(
            [Self.state(cardID: cardID, version: 3, isLocal: true)],
            for: account
        )
        let ids = try await enqueue(count: 1, into: outbox, scope: account)
        let canonical = Self.state(cardID: cardID, version: 4, isLocal: false)
        let uploader = RecordingUploader(results: [ids[0]: .accepted], cardState: canonical)
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        await coordinator.synchronize(scope: account, trigger: .launch)

        let states = try await learning.cardStates(for: account)
        XCTAssertEqual(states.count, 1)
        XCTAssertFalse(states.first?.isLocalProjection ?? true)
        XCTAssertEqual(states.first?.stateVersion, 4)
    }

    /// A response that arrives after the learner has answered again must not
    /// roll their progress backwards.
    func testAStaleCanonicalStateDoesNotOverwriteNewerLocalWork() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let learning = store.makeLearningRepository()
        let cardID = UUID(uuidString: "50000000-0000-4000-8000-000000000002")!
        try await learning.saveCardStates(
            [Self.state(cardID: cardID, version: 9, isLocal: true)],
            for: account
        )
        let ids = try await enqueue(count: 1, into: outbox, scope: account)
        let stale = Self.state(cardID: cardID, version: 4, isLocal: false)
        let uploader = RecordingUploader(results: [ids[0]: .accepted], cardState: stale)
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        await coordinator.synchronize(scope: account, trigger: .launch)

        let states = try await learning.cardStates(for: account)
        XCTAssertEqual(states.first?.stateVersion, 9)
    }

    /// A canonical state beats a projection of the same version: the projection
    /// was only ever a guess at it.
    func testCanonicalStateWinsATieAgainstAProjection() {
        let cardID = UUID()
        let resolved = CanonicalStateMerge.resolve(
            canonical: Self.state(cardID: cardID, version: 5, isLocal: false),
            local: Self.state(cardID: cardID, version: 5, isLocal: true)
        )

        XCTAssertEqual(resolved?.isLocalProjection, false)
    }

    /// Two canonical states of the same version do not fight; nothing changes.
    func testACanonicalStateDoesNotReplaceAnEqualCanonicalOne() {
        let cardID = UUID()
        let resolved = CanonicalStateMerge.resolve(
            canonical: Self.state(cardID: cardID, version: 5, isLocal: false),
            local: Self.state(cardID: cardID, version: 5, isLocal: false)
        )

        XCTAssertNil(resolved)
    }

    // MARK: - Cursor

    /// The batch answer names the stream's latest cursor, but writing it
    /// would skip everything between the device's last read and now — on a
    /// fresh device, the account's whole history. Only the changes pull may
    /// move the cursor, and only over pages it has applied.
    func testTheBatchCursorDoesNotMoveTheChangesFeed() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let ids = try await enqueue(count: 1, into: outbox, scope: account)
        let uploader = RecordingUploader(results: [ids[0]: .accepted], cursor: "cursor-7")
        let coordinator = makeCoordinator(store: store, uploader: uploader)

        await coordinator.synchronize(scope: account, trigger: .launch)

        let cursor = try await outbox.cursor(.userChanges, for: account)
        XCTAssertNil(cursor)
    }

    // MARK: - Helpers

    private func makeCoordinator(
        store: LocalStore,
        uploader: RecordingUploader
    ) -> SyncCoordinator {
        SyncCoordinator(
            outbox: store.makeOutboxRepository(),
            learning: store.makeLearningRepository(),
            uploader: uploader,
            dates: FixedDateProvider(instant: now)
        )
    }

    @discardableResult
    private func enqueue(
        count: Int,
        into outbox: any OutboxRepository,
        scope: AccountScope
    ) async throws -> [UUID] {
        var ids: [UUID] = []
        for index in 0..<count {
            let id = UUID(uuidString: String(format: "aa000000-0000-4000-8000-%012d", index))!
            ids.append(id)
            try await outbox.enqueue(
                OutboxOperationRecord(
                    id: id,
                    kind: .reviewBatch,
                    dependencyID: nil,
                    payload: Data("{}".utf8),
                    state: .pending,
                    attemptCount: 0,
                    lastFailureCode: nil,
                    createdAt: now.addingTimeInterval(Double(index)),
                    updatedAt: now.addingTimeInterval(Double(index))
                ),
                for: scope
            )
        }
        return ids
    }

    static func state(cardID: UUID, version: Int, isLocal: Bool) -> CardStateRecord {
        CardStateRecord(
            learningCardID: cardID,
            state: "REVIEW",
            difficulty: 5,
            stability: 3,
            dueAt: Date(timeIntervalSince1970: 1_800_000_000),
            repetitions: 2,
            lapses: 0,
            schedulerVersion: isLocal ? "local-conservative-1" : "fsrs-6",
            stateVersion: version,
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000),
            isLocalProjection: isLocal
        )
    }
}

/// Answers with the decisions a test names and counts how often it was asked.
actor RecordingUploader: ReviewUploading {
    private let results: [UUID: ReviewAcknowledgementStatus]
    private let acknowledgeAll: ReviewAcknowledgementStatus?
    private let rejectionCode: String?
    private let cardState: CardStateRecord?
    private let cursor: String?
    private let failure: (any Error)?
    private var uploads = 0

    init(
        results: [UUID: ReviewAcknowledgementStatus] = [:],
        acknowledgeAll: ReviewAcknowledgementStatus? = nil,
        rejectionCode: String? = nil,
        cardState: CardStateRecord? = nil,
        cursor: String? = nil,
        failure: (any Error)? = nil
    ) {
        self.results = results
        self.acknowledgeAll = acknowledgeAll
        self.rejectionCode = rejectionCode
        self.cardState = cardState
        self.cursor = cursor
        self.failure = failure
    }

    func uploadCount() -> Int { uploads }

    func upload(_ operations: [OutboxOperationRecord]) async throws -> ReviewBatchOutcome {
        uploads += 1
        if let failure { throw failure }

        let acknowledgements = operations.compactMap { operation -> ReviewAcknowledgement? in
            guard let status = acknowledgeAll ?? results[operation.id] else { return nil }
            return ReviewAcknowledgement(
                eventID: operation.id,
                status: status,
                rejectionCode: status == .rejected ? rejectionCode : nil,
                cardState: status == .accepted ? cardState : nil
            )
        }
        return ReviewBatchOutcome(
            acknowledgements: acknowledgements,
            cursor: cursor,
            serverTime: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}
