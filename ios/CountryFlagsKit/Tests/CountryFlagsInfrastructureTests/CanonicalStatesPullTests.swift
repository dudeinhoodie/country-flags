import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The change stream is how a fresh device inherits a learner's history and
/// how one device hears what another answered. These pin the walk: pages are
/// applied in order, the cursor moves only over applied pages, a stale change
/// never rolls a newer local state back, and a rotated stream restarts from
/// the beginning instead of failing forever.
final class CanonicalStatesPullTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000002")!
    )
    private let cardA = UUID(uuidString: "50000000-0000-4000-8000-000000000001")!
    private let cardB = UUID(uuidString: "50000000-0000-4000-8000-000000000002")!

    /// A fresh device asks from the beginning and walks every page.
    func testAFreshDeviceInheritsTheAccountsHistory() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let feed = ScriptedChangesFeed(pages: [
            nil: UserChangesPage(
                changes: [Fixtures.upsert(cardA, stateVersion: 3, state: "REVIEW", now: now)],
                nextCursor: "c-1",
                hasMore: true
            ),
            "c-1": UserChangesPage(
                changes: [Fixtures.upsert(cardB, stateVersion: 1, state: "LEARNING", now: now)],
                nextCursor: "c-2",
                hasMore: false
            ),
        ])
        let coordinator = makeCoordinator(store: store, feed: feed)

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertNil(status.lastFailure)
        let states = try await learning.cardStates(for: account)
        XCTAssertEqual(states.count, 2)
        XCTAssertEqual(states.first { $0.learningCardID == cardA }?.state, "REVIEW")
        let cursor = try await store.makeOutboxRepository().cursor(.userChanges, for: account)
        XCTAssertEqual(cursor?.cursor, "c-2")
    }

    /// The next run resumes from the stored cursor rather than re-reading
    /// the whole stream.
    func testTheWalkResumesFromTheStoredCursor() async throws {
        let store = try LocalStore(location: .inMemory)
        try await store.makeOutboxRepository().saveCursor(
            SyncCursorRecord(feed: .userChanges, cursor: "c-7", updatedAt: now),
            for: account
        )
        let feed = ScriptedChangesFeed(pages: [
            "c-7": UserChangesPage(changes: [], nextCursor: "c-7", hasMore: false)
        ])
        let coordinator = makeCoordinator(store: store, feed: feed)

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertNil(status.lastFailure)
        let asked = await feed.askedCursors
        XCTAssertEqual(asked, ["c-7"])
    }

    /// A change that lost a race to the device's own answer must not undo it.
    func testAStaleChangeDoesNotRollANewerLocalStateBack() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        try await learning.saveCardStates(
            [Fixtures.state(cardA, stateVersion: 5, state: "REVIEW", now: now)],
            for: account
        )
        let feed = ScriptedChangesFeed(pages: [
            nil: UserChangesPage(
                changes: [Fixtures.upsert(cardA, stateVersion: 2, state: "LEARNING", now: now)],
                nextCursor: "c-1",
                hasMore: false
            )
        ])
        let coordinator = makeCoordinator(store: store, feed: feed)

        _ = await coordinator.synchronize(scope: account, trigger: .launch)

        let states = try await learning.cardStates(for: account)
        XCTAssertEqual(states.first { $0.learningCardID == cardA }?.stateVersion, 5)
    }

    /// Progress was cleared somewhere: the stream rotated, the old cursor
    /// stops resolving, and the device reads again from the beginning.
    func testARotatedStreamRestartsFromTheBeginning() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        try await store.makeOutboxRepository().saveCursor(
            SyncCursorRecord(feed: .userChanges, cursor: "c-stale", updatedAt: now),
            for: account
        )
        let feed = ScriptedChangesFeed(
            pages: [
                nil: UserChangesPage(
                    changes: [Fixtures.upsert(cardA, stateVersion: 1, state: "LEARNING", now: now)],
                    nextCursor: "c-new",
                    hasMore: false
                )
            ],
            rejecting: ["c-stale"]
        )
        let coordinator = makeCoordinator(store: store, feed: feed)

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertNil(status.lastFailure)
        let states = try await learning.cardStates(for: account)
        XCTAssertEqual(states.count, 1)
        let cursor = try await store.makeOutboxRepository().cursor(.userChanges, for: account)
        XCTAssertEqual(cursor?.cursor, "c-new")
    }

    /// A feed that misses leaves the local states standing and the run green.
    func testAFeedMissDoesNotFailTheRun() async throws {
        let store = try LocalStore(location: .inMemory)
        let feed = ScriptedChangesFeed(pages: [:])
        let coordinator = makeCoordinator(store: store, feed: feed)

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertNil(status.lastFailure)
    }

    // MARK: - Harness

    private func makeCoordinator(
        store: LocalStore,
        feed: ScriptedChangesFeed
    ) -> SyncCoordinator {
        SyncCoordinator(
            outbox: store.makeOutboxRepository(),
            learning: store.makeLearningRepository(),
            uploader: AcceptingUploader(),
            userChanges: feed,
            dates: FixedDateProvider(instant: now)
        )
    }
}

// MARK: - Doubles

private struct AcceptingUploader: ReviewUploading {
    func upload(_ operations: [OutboxOperationRecord]) async throws -> ReviewBatchOutcome {
        ReviewBatchOutcome(
            acknowledgements: [],
            cursor: nil,
            serverTime: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}

/// Pages keyed by the cursor they were asked with; an unknown cursor is the
/// network failing, a listed one is the backend refusing it.
private actor ScriptedChangesFeed: UserChangesDownloading {
    private let pages: [String?: UserChangesPage]
    private let rejecting: Set<String>
    private(set) var askedCursors: [String?] = []

    init(pages: [String?: UserChangesPage], rejecting: Set<String> = []) {
        self.pages = pages
        self.rejecting = rejecting
    }

    func changes(after cursor: String?, limit: Int) async throws -> UserChangesPage {
        askedCursors.append(cursor)
        if let cursor, rejecting.contains(cursor) {
            throw APIError.validationFailed(
                APIErrorDetails(
                    statusCode: 422,
                    code: "VALIDATION_FAILED",
                    message: "The cursor does not resolve",
                    requestID: nil
                )
            )
        }
        guard let page = pages[cursor] else {
            throw APIError.transport("offline")
        }
        return page
    }
}

private enum Fixtures {
    static func upsert(
        _ cardID: UUID,
        stateVersion: Int,
        state: String,
        now: Date
    ) -> CardStateChange {
        CardStateChange(
            operation: .upsert,
            cardID: cardID,
            state: Self.state(cardID, stateVersion: stateVersion, state: state, now: now)
        )
    }

    static func state(
        _ cardID: UUID,
        stateVersion: Int,
        state: String,
        now: Date
    ) -> CardStateRecord {
        CardStateRecord(
            learningCardID: cardID,
            state: state,
            difficulty: 5,
            stability: 2,
            dueAt: now.addingTimeInterval(86_400),
            repetitions: 1,
            lapses: 0,
            schedulerVersion: "fsrs-6",
            stateVersion: stateVersion,
            updatedAt: now,
            isLocalProjection: false
        )
    }
}
