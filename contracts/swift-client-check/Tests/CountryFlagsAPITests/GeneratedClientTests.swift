import Foundation
import XCTest

@testable import CountryFlagsAPI

/// Proves three properties of the canonical contract for the iOS client:
/// 1. the bundled document compiles with the official Swift generator;
/// 2. every committed response fixture decodes into the generated types;
/// 3. an unknown value in an extensible enum decodes, while an unknown value in
///    a closed protocol enum surfaces as a catchable error, never a crash.
final class GeneratedClientTests: XCTestCase {
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    private func fixture(_ name: String) throws -> Data {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // CountryFlagsAPITests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // swift-client-check
            .deletingLastPathComponent()  // contracts
            .appendingPathComponent("fixtures/openapi/\(name).json")
        return try Data(contentsOf: root)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try decoder.decode(type, from: try fixture(name))
    }

    func testDecodesEveryCommittedResponseFixture() throws {
        let session = try decode(Components.Schemas.AuthSession.self, "auth-session")
        XCTAssertEqual(session.user.status, .ACTIVE)
        _ = try decode(Components.Schemas.AuthSession.self, "token-refresh")

        let settings = try decode(Components.Schemas.UserSettings.self, "settings")
        XCTAssertEqual(settings.version, 7)
        _ = try decode(Components.Schemas.PrivacySettings.self, "privacy-settings")

        _ = try decode(Components.Schemas.Deck.self, "deck")
        _ = try decode(Components.Schemas.DeckPage.self, "decks")
        _ = try decode(Components.Schemas.LearningCardPage.self, "deck-cards")
        _ = try decode(Components.Schemas.GeoEntity.self, "entity")
        _ = try decode(Components.Schemas.ContentChangePage.self, "content-changes")

        _ = try decode(Components.Schemas.StudySession.self, "study-session-self-rated")
        let objective = try decode(
            Components.Schemas.StudySession.self, "study-session-multiple-choice")
        XCTAssertEqual(objective.cards.first?.options?.count, 4)
        let completed = try decode(
            Components.Schemas.StudySession.self, "study-session-completed")
        XCTAssertEqual(completed.summary?.durationSeconds, 90)

        let batch = try decode(
            Components.Schemas.ReviewBatchResult.self, "review-batch-partial")
        XCTAssertEqual(batch.results.count, 4)
        XCTAssertEqual(batch.results.map(\.status), [
            .ACCEPTED, .DUPLICATE, .REJECTED, .RECONCILIATION_PENDING,
        ])

        _ = try decode(Components.Schemas.UserChangePage.self, "user-changes")
        _ = try decode(Components.Schemas.ProgressSummary.self, "progress")
        _ = try decode(Components.Schemas.ProgressDeletionResult.self, "progress-deletion")
        _ = try decode(Components.Schemas.AchievementPage.self, "achievements")
        _ = try decode(Components.Schemas.ErrorEnvelope.self, "error-envelope")
    }

    func testExtensibleEnumsSurviveUnknownValues() throws {
        let deck = try decode(Components.Schemas.Deck.self, "deck-unknown-kind")
        XCTAssertEqual(deck.kind, "SEASONAL_EVENT")
        XCTAssertEqual(deck.cardCount, 8)

        let entity = try decode(
            Components.Schemas.GeoEntity.self, "entity-unknown-taxonomy")
        XCTAssertEqual(entity.kind, "MICRONATION")
        XCTAssertEqual(entity.recognitionStatus, "TREATY_ASSOCIATED")
        XCTAssertEqual(entity.name.short, "Косово")

        let changes = try decode(
            Components.Schemas.ContentChangePage.self,
            "content-changes-unknown-resource")
        XCTAssertEqual(changes.items.count, 3)
        XCTAssertEqual(changes.items.last?.resourceType, "CARD_TEMPLATE")

        // The mapping a client is expected to apply to those raw values.
        XCTAssertEqual(
            ExtensibleEnum<DeckKind>(rawValue: deck.kind), .unknown("SEASONAL_EVENT"))
        XCTAssertNil(ExtensibleEnum<GeoEntityKind>(rawValue: entity.kind).knownValue)
        XCTAssertEqual(
            changes.items.compactMap {
                ExtensibleEnum<ContentResourceType>(rawValue: $0.resourceType).knownValue
            },
            [.entity, .learningCard])

        let settings = try decode(
            Components.Schemas.UserSettings.self, "settings-unknown-fact-type")
        XCTAssertEqual(settings.extraFactTypes.count, 3)
        XCTAssertTrue(settings.extraFactTypes.contains("SPOKEN_LANGUAGES"))
    }

    /// Documents the current cost of `additionalProperties: false` on response
    /// schemas: a field added by a newer server makes the generated client
    /// reject the whole payload. Tracked as an open contract decision in
    /// `docs/15-ios-client-readiness.md`.
    func testUnknownResponseFieldIsRejectedToday() throws {
        var payload = try JSONSerialization.jsonObject(with: try fixture("deck"))
            as! [String: Any]
        payload["introducedByANewerServer"] = "value"
        let data = try JSONSerialization.data(withJSONObject: payload)

        XCTAssertThrowsError(
            try decoder.decode(Components.Schemas.Deck.self, from: data)
        ) { error in
            XCTAssertTrue(error is DecodingError, "unexpected error: \(error)")
        }
    }

    func testClosedProtocolEnumFailsWithACatchableError() throws {
        var payload = try JSONSerialization.jsonObject(
            with: try fixture("study-session-self-rated")) as! [String: Any]
        payload["status"] = "PAUSED"
        let data = try JSONSerialization.data(withJSONObject: payload)

        // Adding a value to a closed protocol enum requires an API major
        // version bump; until then the client must see a thrown DecodingError
        // rather than a trap.
        XCTAssertThrowsError(
            try decoder.decode(Components.Schemas.StudySession.self, from: data)
        ) { error in
            XCTAssertTrue(error is DecodingError, "unexpected error: \(error)")
        }
    }
}
