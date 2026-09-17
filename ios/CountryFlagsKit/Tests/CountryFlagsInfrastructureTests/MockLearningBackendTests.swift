import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// The offline fixture behind the Mock build, on the one endpoint whose whole
/// point is that something disappears.
///
/// Clearing progress used to be undrivable on `CountryFlags-Mock`: nothing
/// answered `deleteProgress`, and an unregistered operation fails loudly, so
/// every attempt ended on the failure copy. A UI test could reach the dialog
/// and nothing past it.
///
/// Answering `202` would not have been enough either. A fixture that accepted
/// the deletion and went on serving the same history would let the app clear
/// itself, resynchronize, and quietly get everything back — which is the
/// regression this endpoint exists to prevent, and the one the account
/// progress E2E wave is there to catch.
final class MockLearningBackendTests: XCTestCase {
    private static let instant = Date(timeIntervalSince1970: 1_800_000_000)

    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "country-flags-mock-learning-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    /// The gap itself: the operation is answered, so the app reaches a
    /// decision instead of the transport's refusal to invent one.
    func testTheFixtureAnswersAProgressDeletion() async throws {
        let context = makeContext()

        let outcome = try await context.progress.clearProgress()

        XCTAssertEqual(outcome.status, .completed)
        XCTAssertEqual(outcome.requestedAt, Self.instant)
    }

    /// The account's history is gone from the fixture, not merely reported as
    /// deleted. Both reads are checked because both put progress back on a
    /// device: the change stream rebuilds the card states, the snapshot draws
    /// the screen.
    func testAConfirmedDeletionEmptiesTheAccountsHistory() async throws {
        let context = makeContext()
        _ = try await context.imports.submit(Self.archive())

        let imported = try await context.changes.changes(after: nil, limit: 100)
        XCTAssertEqual(imported.changes.count, 1)
        let importedDecks = try await deckProgress(from: context.progress)
        XCTAssertFalse(importedDecks.isEmpty)

        _ = try await context.progress.clearProgress()

        let remaining = try await context.changes.changes(after: nil, limit: 100)
        XCTAssertTrue(remaining.changes.isEmpty, "The deleted stream must not replay")
        let decks = try await deckProgress(from: context.progress)
        XCTAssertTrue(decks.isEmpty, "A cleared account has no deck progress to draw")
    }

    /// A relaunch reads the same defaults, so what the deletion forgot has to
    /// stay forgotten — which is exactly what a UI test asserts after
    /// terminating the app.
    func testTheDeletionSurvivesARelaunchOfTheFixture() async throws {
        let context = makeContext()
        _ = try await context.imports.submit(Self.archive())
        _ = try await context.progress.clearProgress()

        let relaunched = makeContext()

        let changes = try await relaunched.changes.changes(after: nil, limit: 100)
        XCTAssertTrue(changes.changes.isEmpty)
        let decks = try await deckProgress(from: relaunched.progress)
        XCTAssertTrue(decks.isEmpty)
    }

    /// Confirming twice is one deletion. A retry after a dropped answer is an
    /// ordinary thing for a device to do, and it must not become an error the
    /// learner has to read.
    func testASecondDeletionIsAccepted() async throws {
        let context = makeContext()
        _ = try await context.imports.submit(Self.archive())
        _ = try await context.progress.clearProgress()

        let outcome = try await context.progress.clearProgress()

        XCTAssertEqual(outcome.status, .completed)
        let changes = try await context.changes.changes(after: nil, limit: 100)
        XCTAssertTrue(changes.changes.isEmpty)
    }

    /// A refused deletion keeps the history, on the fixture's side as well as
    /// the device's. This is the affordance a UI test needs to watch the
    /// order hold: the server agrees first, the device erases second, and a
    /// refusal must leave a learner with everything they had.
    func testARefusedDeletionKeepsTheHistory() async throws {
        let context = makeContext(refusesDeletion: true)
        _ = try await context.imports.submit(Self.archive())

        do {
            _ = try await context.progress.clearProgress()
            XCTFail("A refused deletion must reach the caller as an error")
        } catch {
            // The shape of the refusal is the API layer's business; that it is
            // an error at all is this test's.
        }

        let changes = try await context.changes.changes(after: nil, limit: 100)
        XCTAssertEqual(changes.changes.count, 1, "The refusal must not have deleted anything")
        let decks = try await deckProgress(from: context.progress)
        XCTAssertFalse(decks.isEmpty)
    }

    /// The other half of the offline story. With nothing answering
    /// `createReviewBatch` an answer stays queued for ever — which is the
    /// state the sign-out tests are about — so the fixture has to be able to
    /// take a batch as well, or the network can never come back.
    func testTheFixtureTakesAnUploadedBatchWhenTheLaunchAsks() async throws {
        let context = makeContext(acceptsReviews: true)
        let card = UUID(uuidString: "50000000-0000-4000-8000-000000000001")!

        let outcome = try await context.reviews.upload([Self.queuedReview(cardID: card)])

        XCTAssertEqual(outcome.acknowledgements.count, 1, "Every answer is acknowledged")
        let changes = try await context.changes.changes(after: nil, limit: 100)
        XCTAssertTrue(
            changes.changes.contains { $0.cardID == card },
            "An answer the server said it took has to be in the stream it serves"
        )
    }

    /// And by default it cannot, because an unregistered operation fails
    /// loudly — which is what keeps the queue full for the tests that are
    /// about a full queue.
    func testTheFixtureRefusesAnUploadedBatchByDefault() async throws {
        let context = makeContext()
        let card = UUID(uuidString: "50000000-0000-4000-8000-000000000002")!

        do {
            _ = try await context.reviews.upload([Self.queuedReview(cardID: card)])
            XCTFail("Without the launch argument there is nothing to upload to")
        } catch {
            // The shape of the refusal is the transport's business; that the
            // upload does not quietly succeed is this test's.
        }
    }

    /// The whole upload, as the app performs it: a real coordinator, a real
    /// store, a real uploader, and an answer that belongs to a session the
    /// backend has never seen.
    ///
    /// This is the thing a UI test could not see. The sync run reports its
    /// outcome to nothing a screen shows, so a queue that stays full looks
    /// exactly like a launch that has not settled. Driving the coordinator
    /// directly is what turns "the answers did not go up" into a line number.
    func testACoordinatorRunDrainsTheQueueAgainstTheFixture() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let learning = store.makeLearningRepository()
        let scope = AccountScope.authenticated(
            userID: UUID(uuidString: "90000000-0000-4000-8000-0000000000e1")!
        )

        // The card the answer is about has to be in the catalogue: the import
        // describes the sitting in terms of what the device was shown.
        let content = store.makeContentRepository()
        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [PersistenceFixtures.entity()],
            decks: [PersistenceFixtures.deck()],
            cards: [PersistenceFixtures.card()],
            deckCards: [PersistenceFixtures.deckCard()]
        )

        // The sitting the answer was given in, composed offline — which is
        // what makes it something the backend has to be handed first.
        try await learning.saveSession(PersistenceFixtures.session(), for: scope)
        try await outbox.enqueue(
            Self.queuedReview(cardID: PersistenceFixtures.cardID),
            for: scope
        )

        let factory = Self.factory(
            backend: MockLearningBackend(
                arguments: [MockLearningBackend.acceptedReviewsArgument],
                defaults: defaults,
                now: { Self.instant }
            )
        )
        let coordinator = SyncCoordinator(
            outbox: outbox,
            learning: learning,
            uploader: ReviewUploader(clientFactory: factory, devices: FixedDevice()),
            sessionImports: StudySessionService(clientFactory: factory, content: content),
            dates: FixedDateProvider(instant: Self.instant)
        )

        let status = await coordinator.synchronize(scope: scope, trigger: .launch)

        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertTrue(
            pending.isEmpty,
            "The answer was acknowledged and must leave the queue; "
                + "the run reported \(String(describing: status.lastFailure))"
        )
    }

    // MARK: - Harness

    private struct Context {
        let progress: ProgressService
        let imports: GuestImportService
        let changes: UserChangesService
        let reviews: ReviewUploader
    }

    /// A client wired to one fixture, with the deterministic policies the
    /// rest of the API tests use.
    private static func factory(backend: MockLearningBackend) -> APIClientFactory {
        APIClientFactory(
            configuration: APITestClient.configuration,
            transport: MockClientTransport(handlers: backend.handlers()),
            identifiers: SequentialIdentifierProvider(),
            retryPolicy: RetryPolicy(maximumAttempts: 1),
            scheduler: RecordingBackoffScheduler(),
            jitter: ZeroJitterProvider()
        )
    }

    private func makeContext(
        refusesDeletion: Bool = false,
        acceptsReviews: Bool = false
    ) -> Context {
        var arguments: [String] = []
        if refusesDeletion { arguments.append(MockLearningBackend.refusedDeletionArgument) }
        if acceptsReviews { arguments.append(MockLearningBackend.acceptedReviewsArgument) }
        let backend = MockLearningBackend(
            arguments: arguments,
            defaults: defaults,
            now: { Self.instant }
        )
        let factory = APIClientFactory(
            configuration: APITestClient.configuration,
            transport: MockClientTransport(handlers: backend.handlers()),
            identifiers: SequentialIdentifierProvider(),
            retryPolicy: RetryPolicy(maximumAttempts: 1),
            scheduler: RecordingBackoffScheduler(),
            jitter: ZeroJitterProvider()
        )
        return Context(
            progress: ProgressService(clientFactory: factory),
            imports: GuestImportService(clientFactory: factory),
            changes: UserChangesService(clientFactory: factory),
            reviews: ReviewUploader(clientFactory: factory, devices: FixedDevice())
        )
    }

    /// One answer as the study runner queues it: the stored bytes, not a
    /// rebuilt event, because the stored bytes are what the uploader reads.
    private static func queuedReview(cardID: UUID) -> OutboxOperationRecord {
        let payload = "{"
            + PAYLOAD_REVIEW_ID
            + PAYLOAD_SESSION_ID
            + "\"learningCardID\":\"\(cardID.uuidString)\","
            + "\"rating\":\"GOOD\",\"answerMode\":\"SELF_RATED\","
            + "\"clientOccurredAt\":\"2027-01-15T08:00:00Z\","
            + "\"clientSequence\":1,\"baseStateVersion\":0,"
            + "\"selectedOptionID\":null}"
        return OutboxOperationRecord(
            id: UUID(uuidString: "b0000000-0000-4000-8000-000000000009")!,
            kind: .reviewBatch,
            dependencyID: PersistenceFixtures.sessionID,
            payload: Data(payload.utf8),
            state: .pending,
            attemptCount: 0,
            lastFailureCode: nil,
            createdAt: instant,
            updatedAt: instant
        )
    }

    private static let PAYLOAD_REVIEW_ID =
        "\"reviewID\":\"92000000-0000-4000-8000-000000000009\","
    private static let PAYLOAD_SESSION_ID =
        "\"sessionID\":\"90000000-0000-4000-8000-000000000001\","


    /// The fixture answers the deck progress and nothing else — achievements,
    /// settings and the due summary have no handler — so a full download
    /// reports the miss while still delivering the part this reads.
    private func deckProgress(from service: ProgressService) async throws -> [DeckProgressRecord] {
        do {
            return try await service.download().decks ?? []
        } catch let partial as PartialProgressDownload {
            return partial.delivered.decks ?? []
        }
    }

    private static func archive() -> GuestImportPayload {
        GuestImportPayload(
            migrationID: UUID(uuidString: "00000000-0000-4000-8000-00000000f00d")!,
            sourceInstallID: "70000000-0000-4000-8000-000000000009",
            sessions: [PersistenceFixtures.session()],
            reviews: [PersistenceFixtures.review()]
        )
    }
}

/// A device that is registered, which is the precondition for attributing an
/// answer to anything at all.
private struct FixedDevice: DeviceIdentityProviding {
    func registeredDeviceID() async -> UUID? {
        UUID(uuidString: "d0000000-0000-4000-8000-000000000001")
    }
}
