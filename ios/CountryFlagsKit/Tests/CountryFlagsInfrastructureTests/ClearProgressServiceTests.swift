import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// Deleting an account's progress. These pin what goes on the wire, and what
/// the device deletes when the backend agrees — which is nothing until it
/// does. The session is the whole gate: no reauthentication proof travels
/// with the request any more.
final class ClearProgressServiceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-00000000000c")!
    )

    func testTheRequestCarriesTheConfirmation() async throws {
        let transport = MockClientTransport()
        await transport.always(Self.acceptedResponse, for: "deleteProgress")

        let outcome = try await Self.makeService(transport: transport).clearProgress()

        XCTAssertEqual(outcome.status, .pending)
        XCTAssertEqual(outcome.requestedAt, now)
        let sent = await transport.requests(for: "deleteProgress")
        let request = try XCTUnwrap(sent.first)
        XCTAssertNil(request.header("x-reauthentication-token"))
        // Compared as a document rather than as text: the generated encoder
        // decides the whitespace, and a test that pinned it would break on a
        // generator update without anything on the wire having changed.
        let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(request.body))
        XCTAssertEqual(body as? [String: String], ["confirmation": "DELETE_PROGRESS"])
    }

    /// A refusal is a refusal to delete. It must reach the caller as an
    /// error rather than as an outcome that would license a local wipe.
    func testARefusalFails() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 401, code: "UNAUTHORIZED"),
            for: "deleteProgress"
        )

        do {
            _ = try await Self.makeService(transport: transport).clearProgress()
            XCTFail("Expected the refusal to be thrown")
        } catch let error as APIError {
            guard case .unauthorized = error else {
                return XCTFail("Expected an unauthorized error, got \(error)")
            }
        }
    }

    // MARK: - What the device deletes

    /// The account survives its history: settings are not progress, and the
    /// catalogue is shared with every other account on the device.
    func testClearingProgressKeepsTheAccountsSettings() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        try await learning.saveSettings(Self.settings(now: now), for: account)
        try await learning.saveDueSummary(
            DueSummaryRecord(
                overdue: 1, learning: 0, relearning: 0, review: 0,
                newCards: 0, totalDue: 1, serverTime: now
            ),
            for: account
        )
        try await learning.saveCardStates([Self.cardState(now: now)], for: account)
        try await learning.saveDeckProgress([Self.deckProgress(now: now)], for: account)
        try await learning.saveAchievements([Self.achievement(now: now)], for: account)
        try await learning.saveSession(Self.session(now: now), for: account)

        try await learning.deleteAllProgress(for: account)

        let settings = try await learning.settings(for: account)
        let summary = try await learning.dueSummary(for: account)
        let states = try await learning.cardStates(for: account)
        let decks = try await learning.deckProgress(for: account)
        let achievements = try await learning.achievements(for: account)
        let session = try await learning.activeSession(for: account)
        XCTAssertEqual(settings?.sessionSize, 10)
        XCTAssertNil(summary)
        XCTAssertTrue(states.isEmpty)
        XCTAssertTrue(decks.isEmpty)
        XCTAssertTrue(achievements.isEmpty)
        XCTAssertNil(session)
    }

    /// One account's wipe is not another's: a guest on the same device keeps
    /// everything it did.
    func testClearingProgressLeavesAnotherScopeAlone() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let guest = AccountScope.guest(
            installationID: UUID(uuidString: "70000000-0000-4000-8000-000000000002")!
        )
        try await learning.saveCardStates([Self.cardState(now: now)], for: guest)

        try await learning.deleteAllProgress(for: account)

        let guestStates = try await learning.cardStates(for: guest)
        XCTAssertEqual(guestStates.count, 1)
    }

    /// The queue and the cursors go with the history: an unsent review belongs
    /// to a session the account no longer has, and the cursor points into a
    /// stream the deletion rotated.
    func testClearingProgressDiscardsTheQueueAndTheCursors() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        try await outbox.enqueue(Self.operation(now: now), for: account)
        try await outbox.saveCursor(
            SyncCursorRecord(feed: .userChanges, cursor: "cursor-1", updatedAt: now),
            for: account
        )

        try await outbox.discardQueuedWork(for: account)

        let pending = try await outbox.pendingOperations(for: account)
        let cursor = try await outbox.cursor(.userChanges, for: account)
        XCTAssertTrue(pending.isEmpty)
        XCTAssertNil(cursor)
    }

    // MARK: - Harness

    private static func makeService(transport: MockClientTransport) -> ProgressService {
        ProgressService(
            clientFactory: APIClientFactory(
                configuration: APITestClient.configuration,
                transport: transport,
                identifiers: SequentialIdentifierProvider(),
                retryPolicy: RetryPolicy(maximumAttempts: 1),
                scheduler: RecordingBackoffScheduler(),
                jitter: ZeroJitterProvider()
            )
        )
    }

    private static let acceptedResponse = MockClientTransport.Response.json(
        """
        {"operationId":"11000000-0000-4000-8000-000000000001","status":"PENDING",\
        "requestedAt":"2027-01-15T08:00:00Z"}
        """,
        statusCode: 202
    )

    private static func settings(now: Date) -> UserSettingsRecord {
        UserSettingsRecord(
            sessionSize: 10,
            contentLocale: "en",
            defaultAnswerMode: "SELF_RATED",
            extraFactTypes: [],
            soundEnabled: true,
            hapticsEnabled: true,
            remindersEnabled: false,
            version: 1,
            updatedAt: now
        )
    }

    private static func cardState(now: Date) -> CardStateRecord {
        CardStateRecord(
            learningCardID: UUID(uuidString: "12000000-0000-4000-8000-000000000001")!,
            state: "REVIEW",
            difficulty: 5,
            stability: 3,
            dueAt: now,
            repetitions: 2,
            lapses: 0,
            schedulerVersion: "fsrs-6",
            stateVersion: 3,
            updatedAt: now,
            isLocalProjection: false
        )
    }

    private static func deckProgress(now: Date) -> DeckProgressRecord {
        DeckProgressRecord(
            deckID: UUID(uuidString: "13000000-0000-4000-8000-000000000001")!,
            totalCards: 10,
            learnedCards: 4,
            dueCards: 1,
            currentMasteryTier: "BRONZE",
            highestAchievementTier: "BRONZE",
            updatedAt: now
        )
    }

    private static func achievement(now: Date) -> AchievementRecord {
        AchievementRecord(
            id: UUID(uuidString: "14000000-0000-4000-8000-000000000001")!,
            code: "FIRST_SESSION",
            category: "PROGRESS",
            tier: "BRONZE",
            scopeType: "GLOBAL",
            scopeID: nil,
            earnedAt: now
        )
    }

    private static func session(now: Date) -> StudySessionRecord {
        StudySessionRecord(
            id: UUID(uuidString: "15000000-0000-4000-8000-000000000001")!,
            deckID: UUID(uuidString: "13000000-0000-4000-8000-000000000001")!,
            mode: "SELF_RATED",
            selectionOrigin: "CLIENT_OFFLINE",
            requestedUniqueCount: 10,
            status: "ACTIVE",
            contentVersion: "fixture-v1",
            startedAt: now,
            completedAt: nil,
            cards: []
        )
    }

    private static func operation(now: Date) -> OutboxOperationRecord {
        OutboxOperationRecord(
            id: UUID(uuidString: "16000000-0000-4000-8000-000000000001")!,
            kind: .reviewBatch,
            dependencyID: nil,
            payload: Data(),
            state: .pending,
            attemptCount: 0,
            lastFailureCode: nil,
            createdAt: now,
            updatedAt: now
        )
    }
}
