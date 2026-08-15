import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The rules the import must not bend: one identifier per archive however many
/// attempts it takes, nothing erased before the backend acknowledged, and a
/// shared device never handing one person's work to another.
final class GuestMigrationCoordinatorTests: XCTestCase {
    private let installationID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    private let userID = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
    private let otherUserID = UUID(uuidString: "20000000-0000-4000-8000-000000000002")!

    func testAnAcknowledgedImportArchivesTheGuestAndKeepsTheReviewIdentifiers() async {
        let harness = Harness(installationID: installationID)
        await harness.learning.seed(
            sessions: [Fixtures.session()],
            reviews: [Fixtures.review(sequence: 1), Fixtures.review(sequence: 2)]
        )
        await harness.importer.answer(.success(Fixtures.result(.applied)))

        let outcome = await harness.coordinator.importGuestWork(into: userID)

        guard case .imported = outcome else {
            return XCTFail("Expected an imported outcome, got \(outcome)")
        }
        let submitted = await harness.importer.submitted
        XCTAssertEqual(submitted.count, 1)
        // The same work changes owner: identical UUIDs, the guest's own
        // installation identifier.
        XCTAssertEqual(
            submitted[0].reviews.map(\.id),
            [Fixtures.review(sequence: 1).id, Fixtures.review(sequence: 2).id]
        )
        XCTAssertEqual(submitted[0].sourceInstallID, installationID.uuidString.lowercased())
        let erased = await harness.cleaner.erasedScopes
        XCTAssertEqual(erased, [.guest(installationID: installationID)])
        let record = await harness.records.record(
            forScopeKey: AccountScope.guest(installationID: installationID).key
        )
        XCTAssertEqual(record?.state, .completed)
        XCTAssertNotNil(record?.acknowledgedAt)
    }

    /// A network failure repeats the same request later — same archive, same
    /// migration identifier — and touches nothing local in the meantime.
    func testARetryAfterANetworkFailureReusesTheMigrationIdentifier() async {
        let harness = Harness(installationID: installationID)
        await harness.learning.seed(sessions: [Fixtures.session()], reviews: [])
        await harness.importer.answer(.failure(APIError.transport("offline")))

        let first = await harness.coordinator.importGuestWork(into: userID)
        XCTAssertEqual(first, .unavailable)
        let erasedAfterFailure = await harness.cleaner.erasedScopes
        XCTAssertTrue(erasedAfterFailure.isEmpty)

        await harness.importer.answer(.success(Fixtures.result(.applied)))
        let second = await harness.coordinator.importGuestWork(into: userID)
        guard case .imported = second else {
            return XCTFail("Expected the retry to land, got \(second)")
        }

        let submitted = await harness.importer.submitted
        XCTAssertEqual(submitted.count, 2)
        XCTAssertEqual(submitted[0].migrationID, submitted[1].migrationID)
    }

    /// The shared-device guard: an archive one account already owns is never
    /// offered to another, and nothing is sent while refusing.
    func testAnArchiveOwnedByAnotherAccountIsRefused() async {
        let harness = Harness(installationID: installationID)
        await harness.learning.seed(sessions: [Fixtures.session()], reviews: [])
        await harness.records.save(
            GuestMigrationRecord(
                migrationID: UUID(),
                sourceScopeKey: AccountScope.guest(installationID: installationID).key,
                targetUserID: otherUserID,
                state: .completed,
                startedAt: .distantPast,
                acknowledgedAt: .distantPast
            )
        )

        let outcome = await harness.coordinator.importGuestWork(into: userID)

        XCTAssertEqual(outcome, .refused)
        let submitted = await harness.importer.submitted
        XCTAssertTrue(submitted.isEmpty)
        let erased = await harness.cleaner.erasedScopes
        XCTAssertTrue(erased.isEmpty)
    }

    func testACleanInstallHasNothingToImport() async {
        let harness = Harness(installationID: installationID)

        let outcome = await harness.coordinator.importGuestWork(into: userID)

        XCTAssertEqual(outcome, .nothingToImport)
        let submitted = await harness.importer.submitted
        XCTAssertTrue(submitted.isEmpty)
    }

    /// A refusal from the backend is terminal: recorded, surfaced, and the
    /// archive stays untouched for support to look at.
    func testABackendRefusalKeepsTheArchive() async {
        let harness = Harness(installationID: installationID)
        await harness.learning.seed(sessions: [Fixtures.session()], reviews: [])
        await harness.importer.answer(.success(Fixtures.result(.failed)))

        let outcome = await harness.coordinator.importGuestWork(into: userID)

        guard case .failed = outcome else {
            return XCTFail("Expected a failed outcome, got \(outcome)")
        }
        let erased = await harness.cleaner.erasedScopes
        XCTAssertTrue(erased.isEmpty)
        let record = await harness.records.record(
            forScopeKey: AccountScope.guest(installationID: installationID).key
        )
        XCTAssertEqual(record?.state, .failed)
        XCTAssertNil(record?.acknowledgedAt)
    }
}

// MARK: - Harness

private struct Harness {
    let learning = SeededLearningRepository()
    let importer = ScriptedImporter()
    let records = InMemoryMigrationRecords()
    let cleaner = RecordingCleaner()
    let coordinator: GuestMigrationCoordinator

    init(installationID: UUID) {
        coordinator = GuestMigrationCoordinator(
            guestScopes: FixedScopeResolver(
                scope: .guest(installationID: installationID)
            ),
            learning: learning,
            importer: importer,
            records: records,
            cleaner: cleaner,
            logger: NoOpLogger()
        )
    }
}

private struct FixedScopeResolver: AccountScopeResolving {
    let scope: AccountScope
    func currentScope() async -> AccountScope { scope }
}

private actor ScriptedImporter: GuestImportSubmitting {
    private(set) var submitted: [GuestImportPayload] = []
    private var nextAnswer: Result<GuestImportResultRecord, any Error> = .failure(
        APIError.transport("unscripted")
    )

    func answer(_ answer: Result<GuestImportResultRecord, any Error>) {
        nextAnswer = answer
    }

    func submit(_ payload: GuestImportPayload) async throws -> GuestImportResultRecord {
        submitted.append(payload)
        return try nextAnswer.get()
    }

    func status(migrationID: UUID) async throws -> GuestImportResultRecord {
        try nextAnswer.get()
    }
}

private actor InMemoryMigrationRecords: GuestMigrationRecordStoring {
    private var records: [String: GuestMigrationRecord] = [:]

    func record(forScopeKey scopeKey: String) async -> GuestMigrationRecord? {
        records[scopeKey]
    }

    func save(_ record: GuestMigrationRecord) async {
        records[record.sourceScopeKey] = record
    }
}

private actor RecordingCleaner: AccountScopeCleaner {
    private(set) var erasedScopes: [AccountScope] = []

    func erase(scope: AccountScope) async throws {
        erasedScopes.append(scope)
    }
}

private actor SeededLearningRepository: LearningRepository {
    private var storedSessions: [StudySessionRecord] = []
    private var storedReviews: [ReviewEventRecord] = []

    func seed(sessions: [StudySessionRecord], reviews: [ReviewEventRecord]) {
        storedSessions = sessions
        storedReviews = reviews
    }

    func sessions(for scope: AccountScope) async throws -> [StudySessionRecord] {
        storedSessions
    }

    func reviews(for scope: AccountScope) async throws -> [ReviewEventRecord] {
        storedReviews
    }

    // MARK: - Unused by the coordinator

    func settings(for scope: AccountScope) async throws -> UserSettingsRecord? { nil }
    func saveSettings(_ settings: UserSettingsRecord, for scope: AccountScope) async throws {}
    func cardStates(for scope: AccountScope) async throws -> [CardStateRecord] { [] }
    func saveCardStates(_ states: [CardStateRecord], for scope: AccountScope) async throws {}
    func activeSession(for scope: AccountScope) async throws -> StudySessionRecord? { nil }
    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws {}
    func reviews(inSession sessionID: UUID, for scope: AccountScope) async throws
        -> [ReviewEventRecord]
    { [] }
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
}

// MARK: - Fixtures

private enum Fixtures {
    static func session() -> StudySessionRecord {
        StudySessionRecord(
            id: UUID(uuidString: "30000000-0000-4000-8000-000000000001")!,
            deckID: UUID(uuidString: "40000000-0000-4000-8000-000000000001")!,
            mode: "SELF_RATED",
            selectionOrigin: "CLIENT_OFFLINE",
            requestedUniqueCount: 10,
            status: "COMPLETED",
            contentVersion: "fixture-v1",
            startedAt: Date(timeIntervalSince1970: 1_800_000_000),
            completedAt: Date(timeIntervalSince1970: 1_800_000_600),
            cards: []
        )
    }

    static func review(sequence: Int64) -> ReviewEventRecord {
        ReviewEventRecord(
            id: UUID(uuidString: String(format: "50000000-0000-4000-8000-%012d", sequence))!,
            sessionID: session().id,
            learningCardID: UUID(uuidString: "60000000-0000-4000-8000-000000000001")!,
            rating: "GOOD",
            answerMode: "SELF_RATED",
            selectedOptionID: nil,
            responseTimeMilliseconds: nil,
            clientOccurredAt: Date(timeIntervalSince1970: 1_800_000_000 + Double(sequence)),
            estimatedServerOccurredAt: nil,
            clientSequence: sequence,
            baseStateVersion: nil
        )
    }

    static func result(_ status: GuestImportStatus) -> GuestImportResultRecord {
        GuestImportResultRecord(
            migrationID: UUID(uuidString: "70000000-0000-4000-8000-000000000001")!,
            status: status,
            acceptedEventCount: 2,
            duplicateEventCount: 0,
            rejectedEventCount: status == .failed ? 2 : 0,
            completedAt: status.isSettled ? Date(timeIntervalSince1970: 1_800_000_700) : nil
        )
    }
}
