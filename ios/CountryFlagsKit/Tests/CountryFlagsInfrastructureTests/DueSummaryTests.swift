import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The queue as the backend counts it: read on the sync run, stored beside the
/// rest of the canon, and never allowed to fail the run it rode home on.
final class DueSummaryTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000009")!
    )

    // MARK: - Reading it

    func testTheDueSummaryIsMappedFromTheContractsShape() async throws {
        let transport = MockClientTransport()
        await transport.always(Self.dueSummaryResponse, for: "getDueSummary")
        await Self.registerEmptyProgress(on: transport)

        let snapshot = try await Self.makeService(transport: transport).download()

        let summary = try XCTUnwrap(snapshot.dueSummary)
        XCTAssertEqual(summary.overdue, 7)
        XCTAssertEqual(summary.learning, 3)
        XCTAssertEqual(summary.relearning, 1)
        XCTAssertEqual(summary.review, 12)
        XCTAssertEqual(summary.newCards, 25)
        XCTAssertEqual(summary.totalDue, 23)
        XCTAssertEqual(summary.serverTime, now)
    }

    /// `review` is optional in the contract. A release that stops sending it
    /// shortens the breakdown; it does not fail the download.
    func testASummaryWithoutTheReviewCountStillReads() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"overdue":2,"learning":0,"relearning":0,"newCards":4,\
                "totalDue":2,"serverTime":"2027-01-15T08:00:00Z"}
                """
            ),
            for: "getDueSummary"
        )
        await Self.registerEmptyProgress(on: transport)

        let snapshot = try await Self.makeService(transport: transport).download()

        XCTAssertEqual(snapshot.dueSummary?.review, 0)
        XCTAssertEqual(snapshot.dueSummary?.totalDue, 2)
    }

    // MARK: - Storing it

    func testASyncRunStoresTheDueSummary() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let coordinator = SyncCoordinator(
            outbox: store.makeOutboxRepository(),
            learning: store.makeLearningRepository(),
            uploader: SilentUploader(),
            progressDownload: FixedProgressDownload(
                snapshot: ProgressSnapshot(
                    decks: [],
                    achievements: [],
                    settings: nil,
                    dueSummary: Self.summary(at: now)
                )
            ),
            dates: FixedDateProvider(instant: now)
        )

        _ = await coordinator.synchronize(scope: account, trigger: .launch)

        let stored = try await learning.dueSummary(for: account)
        XCTAssertEqual(stored?.totalDue, 23)
        XCTAssertEqual(stored?.newCards, 25)
        XCTAssertEqual(stored?.serverTime, now)
    }

    /// A newer answer replaces the older one rather than joining it: the
    /// summary answers one question, and two rows would be two answers.
    func testASecondSummaryReplacesTheFirst() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()

        try await learning.saveDueSummary(Self.summary(at: now), for: account)
        try await learning.saveDueSummary(
            DueSummaryRecord(
                overdue: 0,
                learning: 0,
                relearning: 0,
                review: 0,
                newCards: 0,
                totalDue: 0,
                serverTime: now.addingTimeInterval(60)
            ),
            for: account
        )

        let stored = try await learning.dueSummary(for: account)
        XCTAssertEqual(stored?.totalDue, 0)
        XCTAssertEqual(stored?.serverTime, now.addingTimeInterval(60))
    }

    /// Two accounts on one device count different queues.
    func testTheSummaryIsScopedToItsAccount() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let other = AccountScope.guest(
            installationID: UUID(uuidString: "70000000-0000-4000-8000-000000000001")!
        )

        try await learning.saveDueSummary(Self.summary(at: now), for: account)

        let stored = try await learning.dueSummary(for: other)
        XCTAssertNil(stored)
    }

    // MARK: - Freshness

    /// The queue moves with the clock, so the summary ages out. Skew is read
    /// the same way in both directions.
    func testFreshnessIsMeasuredAgainstTheServersOwnInstant() {
        let summary = Self.summary(at: now)

        XCTAssertTrue(summary.isFresh(at: now.addingTimeInterval(3600)))
        XCTAssertFalse(summary.isFresh(at: now.addingTimeInterval(13 * 3600)))
        XCTAssertFalse(summary.isFresh(at: now.addingTimeInterval(-13 * 3600)))
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

    /// The other three reads the download makes. They are answered so the test
    /// is about the due summary rather than about an unregistered operation.
    private static func registerEmptyProgress(on transport: MockClientTransport) async {
        await transport.always(
            .json(
                """
                {"totalCards":0,"learnedCards":0,"dueCards":0,\
                "currentMasteryTier":"NONE","highestAchievementTier":"NONE","decks":[]}
                """
            ),
            for: "getProgress"
        )
        await transport.always(
            .json(#"{"items":[],"page":{"hasMore":false}}"#),
            for: "listAchievements"
        )
        await transport.always(
            .json(
                """
                {"sessionSize":10,"contentLocale":"en","defaultAnswerMode":"SELF_RATED",\
                "extraFactTypes":[],"soundEnabled":true,"hapticsEnabled":true,\
                "remindersEnabled":false,"desiredRetention":0.9,"timezone":"UTC",\
                "version":1,"updatedAt":"2027-01-15T08:00:00Z"}
                """
            ),
            for: "getSettings"
        )
    }

    private static let dueSummaryResponse = MockClientTransport.Response.json(
        """
        {"overdue":7,"learning":3,"relearning":1,"review":12,"newCards":25,\
        "totalDue":23,"serverTime":"2027-01-15T08:00:00Z"}
        """
    )

    private static func summary(at instant: Date) -> DueSummaryRecord {
        DueSummaryRecord(
            overdue: 7,
            learning: 3,
            relearning: 1,
            review: 12,
            newCards: 25,
            totalDue: 23,
            serverTime: instant
        )
    }
}

// MARK: - Doubles

private struct SilentUploader: ReviewUploading {
    func upload(_ operations: [OutboxOperationRecord]) async throws -> ReviewBatchOutcome {
        ReviewBatchOutcome(
            acknowledgements: [],
            cursor: nil,
            serverTime: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}

private struct FixedProgressDownload: ProgressDownloading {
    let snapshot: ProgressSnapshot

    func download() async throws -> ProgressSnapshot { snapshot }
}
