import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// What the offline import tells the backend about the session it hands over.
final class OfflineSessionImportTests: XCTestCase {
    /// A multiple-choice sitting composed offline is not importable, and the
    /// backend says so with 422 OFFLINE_MODE_UNSUPPORTED. The import used to
    /// claim SELF_RATED to get past that check, and the backend then held a
    /// self-rated session for answers given as a quiz, naming options it had
    /// never issued.
    func testAnOfflineSessionIsImportedUnderItsOwnMode() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()
        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [PersistenceFixtures.entity()],
            decks: [PersistenceFixtures.deck()],
            cards: [PersistenceFixtures.card()],
            deckCards: [PersistenceFixtures.deckCard()]
        )
        let transport = MockClientTransport()
        await transport.enqueue(
            .errorEnvelope(statusCode: 422, code: "OFFLINE_MODE_UNSUPPORTED"),
            for: "createStudySession"
        )
        let service = StudySessionService(
            clientFactory: APIClientFactory(
                configuration: APITestClient.configuration,
                transport: transport,
                identifiers: SequentialIdentifierProvider(),
                retryPolicy: RetryPolicy(maximumAttempts: 1),
                scheduler: RecordingBackoffScheduler(),
                jitter: ZeroJitterProvider()
            ),
            content: content
        )

        do {
            try await service.importOfflineSession(Self.quiz())
            XCTFail("A quiz composed offline is not importable")
        } catch {
            // The refusal that lets the sync park the answers under its code.
            guard case .validationFailed(let details) = APIError.from(error) else {
                return XCTFail("Expected the backend's refusal, got \(error)")
            }
            XCTAssertEqual(details.code, "OFFLINE_MODE_UNSUPPORTED")
        }

        let requests = await transport.requests(for: "createStudySession")
        let body = try XCTUnwrap(requests.first?.body)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(sent["mode"] as? String, "MULTIPLE_CHOICE")
    }

    /// The fixture's sitting, as a quiz.
    private static func quiz() -> StudySessionRecord {
        let sitting = PersistenceFixtures.session()
        return StudySessionRecord(
            id: sitting.id,
            deckID: sitting.deckID,
            mode: StudyAnswerMode.multipleChoice.rawValue,
            selectionOrigin: sitting.selectionOrigin,
            requestedUniqueCount: sitting.requestedUniqueCount,
            status: sitting.status,
            contentVersion: sitting.contentVersion,
            startedAt: sitting.startedAt,
            completedAt: sitting.completedAt,
            cards: sitting.cards
        )
    }
}
