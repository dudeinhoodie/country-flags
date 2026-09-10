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

    // MARK: - Harness

    private struct Context {
        let progress: ProgressService
        let imports: GuestImportService
        let changes: UserChangesService
    }

    private func makeContext(refusesDeletion: Bool = false) -> Context {
        let backend = MockLearningBackend(
            arguments: refusesDeletion ? [MockLearningBackend.refusedDeletionArgument] : [],
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
            changes: UserChangesService(clientFactory: factory)
        )
    }

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
