import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// Clearing progress in the order that makes it safe: consequences, then the
/// server, then the device. These pin every step where stopping early must
/// leave a learner's history exactly where it was.
@MainActor
final class ClearProgressStoreTests: XCTestCase {
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-00000000000b")!
    )

    func testRequestingAloneDeletesNothing() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let learning = WipeRecordingRepository()
        let store = makeStore(clearing: clearing, learning: learning)
        await store.load()

        store.request()

        XCTAssertEqual(store.phase, .confirming)
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 0)
        let wasWiped = await learning.wasWiped()
        XCTAssertFalse(wasWiped)
    }

    func testConfirmingClearsTheServerAndThenTheDevice() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let learning = WipeRecordingRepository()
        let outbox = WipeRecordingOutbox()
        let store = makeStore(clearing: clearing, learning: learning, outbox: outbox)
        await store.load()
        store.request()

        await store.confirm()

        XCTAssertEqual(store.phase, .cleared)
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 1)
        let wasWiped = await learning.wasWiped()
        XCTAssertTrue(wasWiped)
        let wasDiscarded = await outbox.wasDiscarded()
        XCTAssertTrue(wasDiscarded)
    }

    /// The composition puts the screens back in step afterwards; the store
    /// must actually call it, or a cleared account keeps showing its old
    /// numbers until something else happens to reload them.
    func testTheDeviceIsToldOnceTheProgressIsCleared() async throws {
        let store = makeStore(clearing: RecordingClearing(result: .success(())))
        let notified = Notified()
        store.onCleared = { await notified.note() }
        await store.load()
        store.request()

        await store.confirm()

        let wasNotified = await notified.wasNotified()
        XCTAssertTrue(wasNotified)
    }

    /// The backend refused, so the account's history is intact on its side —
    /// and the device must not pretend otherwise by wiping itself.
    func testARefusedDeletionLeavesTheDeviceIntact() async throws {
        let learning = WipeRecordingRepository()
        let outbox = WipeRecordingOutbox()
        let store = makeStore(
            clearing: RecordingClearing(result: .failure(Failure.refused)),
            learning: learning,
            outbox: outbox
        )
        await store.load()
        store.request()

        await store.confirm()

        XCTAssertEqual(store.phase, .failed)
        let wasWiped = await learning.wasWiped()
        XCTAssertFalse(wasWiped)
        let wasDiscarded = await outbox.wasDiscarded()
        XCTAssertFalse(wasDiscarded)
    }

    /// A dismissed dialog is not a failure, and it is not a deletion either.
    func testDismissingTheConfirmationReturnsToIdle() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let store = makeStore(clearing: clearing)
        await store.load()
        store.request()

        store.cancel()

        XCTAssertEqual(store.phase, .idle)
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 0)
    }

    /// Confirming without the dialog on screen must be inert: a stale tap
    /// that lands after a cancel is not a consent.
    func testConfirmingWithoutTheDialogIsInert() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let store = makeStore(clearing: clearing)
        await store.load()

        await store.confirm()

        XCTAssertEqual(store.phase, .idle)
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 0)
    }

    /// A guest has no account-side history to delete, so the entry point is
    /// never offered — and cannot be driven anyway.
    func testAGuestIsNotOfferedTheOperation() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let store = makeStore(
            clearing: clearing,
            scope: .guest(installationID: UUID(uuidString: "70000000-0000-4000-8000-000000000003")!)
        )
        await store.load()

        store.request()

        XCTAssertFalse(store.isOffered)
        XCTAssertEqual(store.phase, .idle)
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 0)
    }

    // MARK: - Harness

    private func makeStore(
        clearing: RecordingClearing,
        learning: WipeRecordingRepository = WipeRecordingRepository(),
        outbox: WipeRecordingOutbox = WipeRecordingOutbox(),
        scope: AccountScope? = nil
    ) -> ClearProgressStore {
        ClearProgressStore(
            clearing: clearing,
            learning: learning,
            outbox: outbox,
            scopes: FixedScopeResolver(scope: scope ?? account)
        )
    }

    private enum Failure: Error {
        case refused
    }
}

// MARK: - Doubles

private actor RecordingClearing: ProgressClearing {
    private let result: Result<Void, any Error>
    private var attemptCount = 0

    init(result: Result<Void, any Error>) {
        self.result = result
    }

    func clearProgress() async throws -> ProgressDeletionOutcome {
        attemptCount += 1
        try result.get()
        return ProgressDeletionOutcome(
            operationID: UUID(uuidString: "11000000-0000-4000-8000-000000000002")!,
            status: .pending,
            requestedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }

    func attempts() -> Int { attemptCount }
}

private actor WipeRecordingRepository: LearningRepository {
    private var wiped = false

    func wasWiped() -> Bool { wiped }

    func deleteAllProgress(for scope: AccountScope) async throws { wiped = true }

    func settings(for scope: AccountScope) async throws -> UserSettingsRecord? { nil }
    func saveSettings(_ settings: UserSettingsRecord, for scope: AccountScope) async throws {}
    func cardStates(for scope: AccountScope) async throws -> [CardStateRecord] { [] }
    func saveCardStates(_ states: [CardStateRecord], for scope: AccountScope) async throws {}
    func deleteCardStates(_ learningCardIDs: [UUID], for scope: AccountScope) async throws {}
    func deleteAllCardStates(for scope: AccountScope) async throws {}
    func activeSession(for scope: AccountScope) async throws -> StudySessionRecord? { nil }
    func session(id: UUID, for scope: AccountScope) async throws -> StudySessionRecord? { nil }
    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws {}
    func reviews(inSession sessionID: UUID, for scope: AccountScope) async throws
        -> [ReviewEventRecord]
    { [] }
    func sessions(for scope: AccountScope) async throws -> [StudySessionRecord] { [] }
    func reviews(for scope: AccountScope) async throws -> [ReviewEventRecord] { [] }
    func recordReview(
        _ review: ReviewEventRecord,
        projectedState: CardStateRecord,
        outbox: OutboxOperationRecord,
        for scope: AccountScope
    ) async throws {}
    func deckProgress(for scope: AccountScope) async throws -> [DeckProgressRecord] { [] }
    func saveDeckProgress(_ progress: [DeckProgressRecord], for scope: AccountScope) async throws {}
    func achievements(for scope: AccountScope) async throws -> [AchievementRecord] { [] }
    func saveAchievements(_ achievements: [AchievementRecord], for scope: AccountScope) async throws {}
    func dueSummary(for scope: AccountScope) async throws -> DueSummaryRecord? { nil }
    func saveDueSummary(_ summary: DueSummaryRecord, for scope: AccountScope) async throws {}
}

private actor WipeRecordingOutbox: OutboxRepository {
    private var discarded = false

    func wasDiscarded() -> Bool { discarded }

    func discardQueuedWork(for scope: AccountScope) async throws { discarded = true }

    func enqueue(_ operation: OutboxOperationRecord, for scope: AccountScope) async throws {}
    func pendingOperations(for scope: AccountScope) async throws -> [OutboxOperationRecord] { [] }
    func updateState(
        of operationID: UUID,
        to state: OutboxState,
        failureCode: String?,
        for scope: AccountScope
    ) async throws {}
    func requeueInterruptedOperations(for scope: AccountScope) async throws -> Int { 0 }

    func operations(
        failedWith code: String,
        for scope: AccountScope
    ) async throws -> [OutboxOperationRecord] { [] }

    func requeue(
        _ operationID: UUID,
        withPayload payload: Data,
        for scope: AccountScope
    ) async throws {}
    func cursor(
        _ feed: SyncCursorRecord.Feed,
        for scope: AccountScope
    ) async throws -> SyncCursorRecord? { nil }
    func saveCursor(_ cursor: SyncCursorRecord, for scope: AccountScope) async throws {}
}

private actor Notified {
    private var notified = false

    func note() { notified = true }
    func wasNotified() -> Bool { notified }
}
