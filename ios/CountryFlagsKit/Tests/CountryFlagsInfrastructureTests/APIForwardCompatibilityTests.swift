import XCTest

@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// The client has to survive a backend that ships before it does.
final class APIForwardCompatibilityTests: XCTestCase {
    func testUnknownFieldsAreIgnored() async throws {
        let payload = try TestFixtures.decksJSON.addingTopLevelField(
            "\"introducedByANewerServer\": {\"nested\": true}"
        )
        let transport = MockClientTransport()
        await transport.always(.json(payload), for: "listDecks")
        let client = APITestClient.make(transport: transport)

        let output = try await client.listDecks(
            .init(query: .init(locale: "ru"))
        )

        // The page still decodes: an added field cannot cost the user a screen.
        let page = try output.ok.body.json
        XCTAssertEqual(page.items.count, 2)
    }

    /// Taxonomy values the content pipeline owns are declared as strings with
    /// `x-extensible-enum`, so a new one decodes instead of failing the page.
    /// See ADR-009.
    func testUnknownExtensibleEnumValueDecodes() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(TestFixtures.deckWithUnknownKindJSON),
            for: "getDeck"
        )
        let client = APITestClient.make(transport: transport)

        let output = try await client.getDeck(
            .init(
                path: .init(deckId: "70000000-0000-4000-8000-000000000001"),
                query: .init(locale: "ru")
            )
        )

        let deck = try output.ok.body.json
        XCTAssertEqual(deck.kind, "SEASONAL_EVENT")
        XCTAssertEqual(deck.cardCount, 8)
    }

    /// A value added to a closed protocol enum is a breaking change that needs
    /// an API major version. Until then the client must fail in a way a caller
    /// can catch, never trap.
    func testUnknownClosedEnumValueFailsAsACatchableError() async throws {
        let payload = try TestFixtures.completedSessionJSON.replacingJSONValue(
            of: "status",
            with: "PAUSED"
        )
        let transport = MockClientTransport()
        await transport.always(.json(payload), for: "getStudySession")
        let client = APITestClient.make(transport: transport)

        do {
            _ = try await client.getStudySession(
                .init(path: .init(sessionId: "90000000-0000-4000-8000-000000000006"))
            )
            XCTFail("an unknown session status must not decode silently")
        } catch {
            guard case .decoding = APIError.from(error) else {
                return XCTFail("unexpected error: \(error)")
            }
        }
    }
}

extension String {
    /// Adds a field the client has never heard of to a JSON object.
    func addingTopLevelField(_ field: String) throws -> String {
        guard let brace = firstIndex(of: "{") else {
            throw FixtureEditError.notAJSONObject
        }
        return replacingCharacters(in: brace...brace, with: "{\n  \(field),")
    }

    /// Replaces the value of the first occurrence of a key.
    func replacingJSONValue(of key: String, with value: String) throws -> String {
        guard let range = range(of: "\"\(key)\": \"[^\"]*\"", options: .regularExpression) else {
            throw FixtureEditError.keyNotFound(key)
        }
        return replacingCharacters(in: range, with: "\"\(key)\": \"\(value)\"")
    }
}

enum FixtureEditError: Error {
    case notAJSONObject
    case keyNotFound(String)
}
