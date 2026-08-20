import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// Clearing progress in the order that makes it safe: consequences, then a
/// fresh proof, then the server, then the device. These pin every step where
/// stopping early must leave a learner's history exactly where it was.
@MainActor
final class ClearProgressStoreTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-00000000000b")!
    )

    func testConfirmingAloneDeletesNothing() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let learning = WipeRecordingRepository()
        let store = makeStore(clearing: clearing, learning: learning)
        await store.load()

        store.request()
        store.confirm()

        XCTAssertEqual(store.phase, .provingIdentity)
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 0)
        let wasWiped = await learning.wasWiped()
        XCTAssertFalse(wasWiped)
    }

    func testAProvenIdentityClearsTheServerAndThenTheDevice() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let learning = WipeRecordingRepository()
        let outbox = WipeRecordingOutbox()
        let store = makeStore(clearing: clearing, learning: learning, outbox: outbox)
        await store.load()
        store.request()
        store.confirm()

        await store.prove(with: .google(idToken: "provider-token"))

        XCTAssertEqual(store.phase, .cleared)
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 1)
        let sentProof = await clearing.lastProof()
        XCTAssertEqual(sentProof, "proof-1")
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
        store.confirm()

        await store.prove(with: .google(idToken: "provider-token"))

        let wasNotified = await notified.wasNotified()
        XCTAssertTrue(wasNotified)
    }

    /// A proof that could not be obtained is a deletion that never happened.
    func testAFailedProofDeletesNothing() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let learning = WipeRecordingRepository()
        let store = makeStore(
            auth: StubReauthentication(result: .failure(Failure.refused)),
            clearing: clearing,
            learning: learning
        )
        await store.load()
        store.request()
        store.confirm()

        await store.prove(with: .google(idToken: "provider-token"))

        XCTAssertEqual(store.phase, .failed(.identity))
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 0)
        let wasWiped = await learning.wasWiped()
        XCTAssertFalse(wasWiped)
    }

    /// The backend enforces the window; the device checks it too, so an
    /// expired proof is not spent on a request that cannot succeed.
    func testAnExpiredProofIsNotSent() async throws {
        let clearing = RecordingClearing(result: .success(()))
        let store = makeStore(
            auth: StubReauthentication(
                result: .success(
                    ReauthenticationProof(token: "stale", expiresAt: now.addingTimeInterval(-1))
                )
            ),
            clearing: clearing
        )
        await store.load()
        store.request()
        store.confirm()

        await store.prove(with: .google(idToken: "provider-token"))

        XCTAssertEqual(store.phase, .failed(.identity))
        let attempts = await clearing.attempts()
        XCTAssertEqual(attempts, 0)
    }

    /// Identity was proven and the deletion still did not go through. The
    /// account's history is intact on both sides, and the device must not
    /// pretend otherwise by wiping itself.
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
        store.confirm()

        await store.prove(with: .google(idToken: "provider-token"))

        XCTAssertEqual(store.phase, .failed(.deletion))
        let wasWiped = await learning.wasWiped()
        XCTAssertFalse(wasWiped)
        let wasDiscarded = await outbox.wasDiscarded()
        XCTAssertFalse(wasDiscarded)
    }

    /// A provider sheet that was dismissed is not a failure, and it is not a
    /// deletion either.
    func testDismissingTheProviderReturnsToIdle() async throws {
        let store = makeStore(clearing: RecordingClearing(result: .success(())))
        await store.load()
        store.request()
        store.confirm()

        store.noteCancelledProof()

        XCTAssertEqual(store.phase, .idle)
    }

    /// A guest has no account-side history to delete and nobody to prove they
    /// are, so the entry point is never offered — and cannot be driven anyway.
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
        auth: StubReauthentication? = nil,
        clearing: RecordingClearing,
        learning: WipeRecordingRepository = WipeRecordingRepository(),
        outbox: WipeRecordingOutbox = WipeRecordingOutbox(),
        scope: AccountScope? = nil
    ) -> ClearProgressStore {
        ClearProgressStore(
            reauthentication: ReauthenticationCoordinator(
                auth: auth
                    ?? StubReauthentication(
                        result: .success(
                            ReauthenticationProof(
                                token: "proof-1",
                                expiresAt: now.addingTimeInterval(300)
                            )
                        )
                    ),
                nonces: FixedNonces(),
                dates: FixedDateProvider(instant: now)
            ),
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

private struct FixedNonces: NonceGenerating {
    func makeNonce() -> SignInNonce { SignInNonce(raw: "raw", hashed: "hashed") }
}

/// Answers the one call this flow makes of the authentication service.
private struct StubReauthentication: AuthenticationService {
    let result: Result<ReauthenticationProof, any Error>

    func reauthenticate(with credential: ProviderCredential) async throws -> ReauthenticationProof {
        try result.get()
    }

    func exchange(_ credential: ProviderCredential) async throws -> AuthSessionRecord {
        throw ClearProgressUnexpectedCall.exchange
    }

    func refresh(refreshToken: String) async throws -> RefreshedSessionRecord {
        throw ClearProgressUnexpectedCall.refresh
    }

    func logout(refreshToken: String) async throws {}
    func logoutEverywhere() async throws {}
}

private enum ClearProgressUnexpectedCall: Error {
    case exchange
    case refresh
}

private actor RecordingClearing: ProgressClearing {
    private let result: Result<Void, any Error>
    private var attemptCount = 0
    private var proof: String?

    init(result: Result<Void, any Error>) {
        self.result = result
    }

    func clearProgress(
        provingWith proof: ReauthenticationProof
    ) async throws -> ProgressDeletionOutcome {
        attemptCount += 1
        self.proof = proof.token
        try result.get()
        return ProgressDeletionOutcome(
            operationID: UUID(uuidString: "11000000-0000-4000-8000-000000000002")!,
            status: .pending,
            requestedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }

    func attempts() -> Int { attemptCount }
    func lastProof() -> String? { proof }
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
