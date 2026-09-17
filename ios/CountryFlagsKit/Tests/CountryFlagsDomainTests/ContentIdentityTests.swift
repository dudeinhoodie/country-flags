import XCTest

import CountryFlagsDomain

/// The rule that lets one release's work be moved onto another's identifiers.
///
/// A backend allocates content identifiers in its database, so the catalogue a
/// build ships carries identifiers of its own and is superseded whole by the
/// first release a server hands over (ADR-021). What the two agree on is the
/// content: the question the card asks, and the file the drawing is published
/// at — which the pipeline names after the entity, and which is therefore the
/// content key in the only form a client ever sees it.
final class ContentIdentityTests: XCTestCase {
    func testTheSameDrawingIsTheSameCardAcrossTwoReleaseAddresses() {
        let mapping = ContentIdentityMapping.between(
            superseded: release(
                "bundled:fixture-1",
                cards: [card(id: 1, at: "https://cdn.app/content/fixture-1/png/germany@2x.png")]
            ),
            arriving: release(
                "2026-09-01",
                cards: [card(id: 2, at: "https://assets.example/releases/2026-09-01/png/germany@2x.png")]
            )
        )

        XCTAssertEqual(mapping.cards[uuid(1)]?.id, uuid(2))
        XCTAssertTrue(mapping.strandedCardIDs.isEmpty)
    }

    /// A file published somewhere else is a different drawing as far as this
    /// rule can tell, and a wrong match would attribute somebody's work to a
    /// country they never saw. Saying so is the safe answer.
    func testACardPublishedAtAnotherPathIsStrandedRatherThanGuessedAt() {
        let mapping = ContentIdentityMapping.between(
            superseded: release(
                "bundled:fixture-1",
                cards: [card(id: 1, at: "https://cdn.app/content/fixture-1/png/atlantis@2x.png")]
            ),
            arriving: release(
                "2026-09-01",
                cards: [card(id: 2, at: "https://cdn.app/content/2026-09-01/png/germany@2x.png")]
            )
        )

        XCTAssertTrue(mapping.cards.isEmpty)
        XCTAssertEqual(mapping.strandedCardIDs, [uuid(1)])
    }

    /// Two arriving cards that look identical cannot both be the one the work
    /// belongs to, so neither is chosen.
    func testAnIdentityTheArrivingReleasePublishesTwiceMapsToNothing() {
        let mapping = ContentIdentityMapping.between(
            superseded: release(
                "bundled:fixture-1",
                cards: [card(id: 1, at: "https://cdn.app/a/png/germany@2x.png")]
            ),
            arriving: release(
                "2026-09-01",
                cards: [
                    card(id: 2, at: "https://cdn.app/b/png/germany@2x.png"),
                    card(id: 3, at: "https://cdn.app/b/png/germany@2x.png"),
                ]
            )
        )

        XCTAssertTrue(mapping.cards.isEmpty)
        XCTAssertEqual(mapping.strandedCardIDs, [uuid(1)])
    }

    /// A different question about the same drawing is a different card.
    func testTheTemplateIsPartOfTheIdentity() {
        let mapping = ContentIdentityMapping.between(
            superseded: release(
                "bundled:fixture-1",
                cards: [card(id: 1, at: "https://cdn.app/a/png/germany@2x.png")]
            ),
            arriving: release(
                "2026-09-01",
                cards: [
                    card(
                        id: 2,
                        at: "https://cdn.app/b/png/germany@2x.png",
                        template: "COUNTRY_TO_FLAG"
                    )
                ]
            )
        )

        XCTAssertTrue(mapping.cards.isEmpty)
    }

    /// A deck is the same deck across releases by what it is called, which is
    /// the rule the catalogue already resolves an open deck screen by.
    func testDecksAreMatchedByTheirCode() {
        let mapping = ContentIdentityMapping.between(
            superseded: release("bundled:fixture-1", decks: ["EUROPE": uuid(10), "ATLANTIS": uuid(11)]),
            arriving: release("2026-09-01", decks: ["EUROPE": uuid(20)])
        )

        XCTAssertEqual(mapping.decks, [uuid(10): uuid(20)])
    }

    /// The mapping is applied to a store that may already have been rewritten,
    /// so an identifier that has not moved must not appear in it at all —
    /// which is what makes running the carry twice a no-op.
    func testAnIdentifierThatDidNotMoveIsNotInTheMapping() {
        let mapping = ContentIdentityMapping.between(
            superseded: release(
                "bundled:fixture-1",
                cards: [card(id: 1, at: "https://cdn.app/a/png/germany@2x.png")],
                decks: ["EUROPE": uuid(10)]
            ),
            arriving: release(
                "2026-09-01",
                cards: [card(id: 1, at: "https://cdn.app/b/png/germany@2x.png")],
                decks: ["EUROPE": uuid(10)]
            )
        )

        XCTAssertTrue(mapping.isEmpty)
        XCTAssertTrue(mapping.strandedCardIDs.isEmpty)
    }

    // MARK: - Fixtures

    private func release(
        _ version: String,
        cards: [ReleaseContents.Card] = [],
        decks: [String: UUID] = [:]
    ) -> ReleaseContents {
        ReleaseContents(contentVersion: version, deckIDsByCode: decks, cards: cards)
    }

    private func card(
        id: Int,
        at url: String,
        template: String = "FLAG_TO_COUNTRY"
    ) -> ReleaseContents.Card {
        ReleaseContents.Card(
            id: uuid(id),
            templateCode: template,
            semanticVersion: 1,
            revision: 1,
            promptAssetID: uuid(id + 100),
            promptAssetType: "FLAG",
            promptAssetVariant: "current",
            promptAssetURL: URL(string: url)!
        )
    }

    private func uuid(_ value: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", value))!
    }
}
