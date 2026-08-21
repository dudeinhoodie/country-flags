import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

/// The backend composes when it can; the device composes when it must. These
/// pin the boundary: who is asked, what happens to the answer, and that every
/// failure lands on the local path rather than on the learner.
@MainActor
final class ServerSelectionTests: XCTestCase {
    private let deckID = UUID(uuidString: "40000000-0000-4000-8000-000000000001")!
    private let userID = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!

    func testAnAuthenticatedRunnerStudiesTheServersComposition() async {
        let learning = RecordingLearningRepository()
        let selection = ScriptedSelection(
            result: .success(Fixtures.serverSession(deckID: deckID))
        )
        let runner = makeRunner(learning: learning, selection: selection, authenticated: true)

        await runner.startOrResume(deckID: deckID, size: .ten)

        XCTAssertEqual(runner.state?.sessionID, Fixtures.serverSessionID)
        XCTAssertEqual(runner.state?.cards.count, 2)
        // The composition is stored the way a local one is, which is what
        // makes a relaunch resume it without knowing who composed it.
        let saved = await learning.sessions
        XCTAssertEqual(saved.first?.selectionOrigin, "SERVER")
    }

    /// Offline, a refusal, anything: the device composes, the way it always
    /// could. The learner sees a session either way.
    func testAServerFailureFallsBackToTheLocalComposition() async {
        let learning = RecordingLearningRepository()
        let selection = ScriptedSelection(result: .failure(Fixtures.Offline()))
        let runner = makeRunner(learning: learning, selection: selection, authenticated: true)

        await runner.startOrResume(deckID: deckID, size: .five)

        XCTAssertNotNil(runner.state)
        let saved = await learning.sessions
        XCTAssertEqual(saved.first?.selectionOrigin, "CLIENT_OFFLINE")
    }

    /// A guest has nothing on the server to select from, and asking would put
    /// an unauthenticated request on the wire for nothing.
    func testAGuestNeverAsksTheServer() async {
        let selection = ScriptedSelection(
            result: .success(Fixtures.serverSession(deckID: deckID))
        )
        let runner = makeRunner(
            learning: RecordingLearningRepository(),
            selection: selection,
            authenticated: false
        )

        await runner.startOrResume(deckID: deckID, size: .five)

        let calls = await selection.serverSessionCalls
        XCTAssertEqual(calls, 0)
        XCTAssertNotNil(runner.state)
    }

    /// The due launch asks the backend for the queue itself: the request
    /// carries DUE_ONLY, and the size is only the cap on one sitting.
    func testADueOnlyLaunchAsksForTheQueue() async {
        let selection = ScriptedSelection(
            result: .success(Fixtures.serverSession(deckID: deckID))
        )
        let runner = makeRunner(
            learning: RecordingLearningRepository(),
            selection: selection,
            authenticated: true
        )

        await runner.startOrResume(deckID: deckID, size: .twenty, composition: .dueOnly)

        let compositions = await selection.requestedCompositions
        XCTAssertEqual(compositions, [.dueOnly])
    }

    /// An empty server answer is not a session; the local half decides
    /// whether there is anything to study.
    func testAnEmptyServerSessionFallsBackLocally() async {
        let selection = ScriptedSelection(
            result: .success(Fixtures.serverSession(deckID: deckID, cardCount: 0))
        )
        let runner = makeRunner(
            learning: RecordingLearningRepository(),
            selection: selection,
            authenticated: true
        )

        await runner.startOrResume(deckID: deckID, size: .five)

        XCTAssertNotNil(runner.state)
        XCTAssertEqual(runner.state?.cards.isEmpty, false)
    }

    /// The bug this pins: the first screen advertised a queue, the session
    /// opened empty, and the two disagreed because only one of them had seen
    /// the answers still waiting in the outbox.
    ///
    /// The server is canonical about the cards it has received. It is not
    /// canonical about the ones it has not, and the count on the first screen
    /// is computed from those. So an empty due-only answer is a question put
    /// to the device, not a verdict.
    func testAnEmptyDueOnlyAnswerIsCheckedAgainstWhatTheDeviceKnows() async {
        let learning = RecordingLearningRepository(states: Fixtures.dueStates(deckID: deckID))
        let selection = ScriptedSelection(
            result: .success(Fixtures.serverSession(deckID: deckID, cardCount: 0))
        )
        // Answers this device has not sent: the backend is counting an older
        // world, and this is the only thing that says so.
        let outbox = PendingOutbox(count: 2)
        let runner = makeRunner(
            learning: learning,
            selection: selection,
            authenticated: true,
            outbox: outbox
        )

        await runner.startOrResume(deckID: deckID, size: .five, composition: .dueOnly)

        XCTAssertNil(runner.startFailure, "the device holds cards that are due")
        XCTAssertEqual(runner.state?.cards.isEmpty, false)
        let saved = await learning.sessions
        XCTAssertEqual(saved.first?.selectionOrigin, "CLIENT_OFFLINE")
        // The empty server session is still closed out rather than left
        // hanging ACTIVE on the backend.
        let completed = await selection.completedSessions
        XCTAssertEqual(completed.count, 1)
    }

    /// Nothing waiting to be sent means the backend has seen every answer from
    /// every device, so its "nothing is due" is the truth — even here, where
    /// this device happens to hold cards whose time has come. They are cards
    /// the backend has already accounted for.
    func testAnEmptyDueOnlyAnswerStandsWhenNothingIsWaitingToBeSent() async {
        let learning = RecordingLearningRepository(states: Fixtures.dueStates(deckID: deckID))
        let selection = ScriptedSelection(
            result: .success(Fixtures.serverSession(deckID: deckID, cardCount: 0))
        )
        let runner = makeRunner(
            learning: learning,
            selection: selection,
            authenticated: true,
            outbox: PendingOutbox(count: 0)
        )

        await runner.startOrResume(deckID: deckID, size: .five, composition: .dueOnly)

        XCTAssertEqual(runner.startFailure, .nothingDue)
    }

    /// And with no outbox to ask at all, nothing is known to be waiting.
    func testAnEmptyDueOnlyAnswerStandsWhenTheDeviceAgrees() async {
        let selection = ScriptedSelection(
            result: .success(Fixtures.serverSession(deckID: deckID, cardCount: 0))
        )
        let runner = makeRunner(
            learning: RecordingLearningRepository(),
            selection: selection,
            authenticated: true
        )

        await runner.startOrResume(deckID: deckID, size: .five, composition: .dueOnly)

        XCTAssertEqual(runner.startFailure, .nothingDue)
    }

    // MARK: - Harness

    private func makeRunner(
        learning: RecordingLearningRepository,
        selection: ScriptedSelection,
        authenticated: Bool,
        outbox: (any OutboxRepository)? = nil
    ) -> StudySessionRunner {
        StudySessionRunner(
            scopes: SelectableScopeResolver(
                scope: authenticated
                    ? .authenticated(userID: userID)
                    : .guest(installationID: UUID())
            ),
            content: FakeContentRepository(
                decks: [Fixtures.deck(id: deckID)],
                cards: [deckID: (0..<5).map { Fixtures.card(index: $0) }]
            ),
            learning: learning,
            selection: selection,
            dates: FixedDates(instant: Date(timeIntervalSince1970: 1_800_000_000)),
            identifiers: SequentialUUIDProvider()
        )
    }
}

// MARK: - Doubles

private struct SelectableScopeResolver: AccountScopeResolving {
    let scope: AccountScope
    func currentScope() async -> AccountScope { scope }
}

private actor ScriptedSelection: StudySessionSelecting {
    private let result: Result<StudySessionRecord, any Error>
    private(set) var serverSessionCalls = 0
    private(set) var requestedCompositions: [StudySessionComposition] = []
    private(set) var completedSessions: [UUID] = []

    init(result: Result<StudySessionRecord, any Error>) {
        self.result = result
    }

    func serverSession(
        id: UUID,
        deckID: UUID,
        size: StudySessionSize,
        mode: StudyAnswerMode,
        composition: StudySessionComposition
    ) async throws -> StudySessionRecord {
        serverSessionCalls += 1
        requestedCompositions.append(composition)
        return try result.get()
    }

    func completeSession(id: UUID) async {
        completedSessions.append(id)
    }
}

/// An outbox with a known number of unsent answers, which is the one thing the
/// runner asks it for.
private actor PendingOutbox: OutboxRepository {
    private let count: Int

    init(count: Int) {
        self.count = count
    }

    func enqueue(_ operation: OutboxOperationRecord, for scope: AccountScope) async throws {}

    func pendingOperations(for scope: AccountScope) async throws -> [OutboxOperationRecord] {
        (0..<count).map { index in
            OutboxOperationRecord(
                id: UUID(uuidString: String(format: "90000000-0000-4000-8000-%012d", index))!,
                kind: .reviewBatch,
                dependencyID: nil,
                payload: Data(),
                state: .pending,
                attemptCount: 0,
                lastFailureCode: nil,
                createdAt: Date(timeIntervalSince1970: 1_800_000_000),
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
            )
        }
    }

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

    func discardQueuedWork(for scope: AccountScope) async throws {}
}

private enum Fixtures {
    struct Offline: Error {}

    static let serverSessionID = UUID(uuidString: "80000000-0000-4000-8000-000000000001")!

    static func deck(id: UUID) -> DeckRecord {
        DeckRecord(
            id: id,
            code: "ALL",
            kind: "CURATED",
            name: "All countries",
            deckDescription: "",
            cardCount: 5,
            contentVersion: "fixture-v2",
            sortOrder: 0
        )
    }

    static func card(index: Int) -> LearningCardRecord {
        LearningCardRecord(
            id: UUID(uuidString: String(format: "50000000-0000-4000-8000-%012d", index))!,
            subjectEntityID: UUID(),
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: UUID(),
            displayName: "Country \(index)",
            aliases: [],
            contentVersion: "fixture-v2",
            isRetired: false
        )
    }

    /// Cards this device has answered and that have come round, as the
    /// device's own store sees them — the facts the first screen counts and
    /// the server has not received.
    static func dueStates(deckID: UUID) -> [CardStateRecord] {
        (0..<3).map { index in
            CardStateRecord(
                learningCardID: card(index: index).id,
                state: "REVIEW",
                difficulty: 5,
                stability: 10,
                dueAt: Date(timeIntervalSince1970: 1_800_000_000).addingTimeInterval(-3600),
                repetitions: 2,
                lapses: 0,
                schedulerVersion: "local-conservative-1",
                stateVersion: 1,
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000),
                isLocalProjection: true
            )
        }
    }

    static func serverSession(deckID: UUID, cardCount: Int = 2) -> StudySessionRecord {
        StudySessionRecord(
            id: serverSessionID,
            deckID: deckID,
            mode: "SELF_RATED",
            selectionOrigin: "SERVER",
            requestedUniqueCount: 10,
            status: "ACTIVE",
            contentVersion: "fixture-v2",
            startedAt: Date(timeIntervalSince1970: 1_800_000_000),
            completedAt: nil,
            cards: (0..<cardCount).map { index in
                StudySessionCardRecord(
                    id: UUID(uuidString: String(format: "81000000-0000-4000-8000-%012d", index))!,
                    learningCardID: UUID(
                        uuidString: String(format: "82000000-0000-4000-8000-%012d", index)
                    )!,
                    initialOrder: index,
                    selectionReason: "NEW",
                    displayName: "Country \(index)",
                    promptAssetID: UUID(),
                    revision: 1,
                    optionIDs: [],
                    optionNames: []
                )
            }
        )
    }
}
