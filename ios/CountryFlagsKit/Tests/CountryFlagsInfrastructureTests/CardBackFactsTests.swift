import SwiftData
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// The facts a release prints on the back of a card have to survive being
/// stored, or the screen that shows them would need the network the rest of the
/// content does not.
final class CardBackFactsTests: XCTestCase {
    private let facts = [
        FactRecord(type: "CAPITAL", displayValue: "Brussels", sourceName: "annexare/Countries"),
        FactRecord(
            type: "POPULATION",
            displayValue: "11,822,592 (2024)",
            sourceName: "World Bank Open Data"
        ),
    ]

    func testTheFactsOfACardAreStoredAndReadBack() async throws {
        let repository = try LocalStore(location: .inMemory).makeContentRepository()

        try await repository.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [],
            decks: [PersistenceFixtures.deck()],
            cards: [PersistenceFixtures.card(facts: facts)],
            deckCards: [PersistenceFixtures.deckCard()]
        )

        let stored = try await repository.card(id: PersistenceFixtures.cardID)
        XCTAssertEqual(stored?.backSideFacts, facts)
        // The listing carries them too: the deck screen reads through the same
        // record the study screen does.
        let listed = try await repository.cards(inDeck: PersistenceFixtures.deckID)
        XCTAssertEqual(listed.first?.backSideFacts, facts)
    }

    /// A release that publishes nothing about a country is a card with nothing
    /// more to say, not a broken one.
    func testACardWithNoFactsStoresNone() async throws {
        let repository = try LocalStore(location: .inMemory).makeContentRepository()

        try await repository.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [],
            decks: [PersistenceFixtures.deck()],
            cards: [PersistenceFixtures.card()],
            deckCards: [PersistenceFixtures.deckCard()]
        )

        let stored = try await repository.card(id: PersistenceFixtures.cardID)
        XCTAssertEqual(stored?.backSideFacts, [])
    }

    /// Replaying a page must converge rather than accumulate: the facts of the
    /// second write are the facts, not the second copy of them.
    func testReapplyingAReleaseReplacesTheFactsRatherThanAppending() async throws {
        let repository = try LocalStore(location: .inMemory).makeContentRepository()
        let corrected = [
            FactRecord(type: "CAPITAL", displayValue: "Brussels", sourceName: "Wikidata")
        ]

        for cardFacts in [facts, corrected] {
            try await repository.applyContent(
                manifest: PersistenceFixtures.manifest(),
                entities: [],
                decks: [PersistenceFixtures.deck()],
                cards: [PersistenceFixtures.card(facts: cardFacts)],
                deckCards: [PersistenceFixtures.deckCard()]
            )
        }

        let stored = try await repository.card(id: PersistenceFixtures.cardID)
        XCTAssertEqual(stored?.backSideFacts, corrected)
    }

    /// A card the current release retired still resolves by identifier: a
    /// session that started before the retirement is still rendering its back.
    func testARetiredCardStillResolvesByIdentifier() async throws {
        let repository = try LocalStore(location: .inMemory).makeContentRepository()
        try await repository.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [],
            decks: [PersistenceFixtures.deck()],
            cards: [PersistenceFixtures.card(facts: facts)],
            deckCards: [PersistenceFixtures.deckCard()]
        )

        try await repository.retire(cardIDs: [PersistenceFixtures.cardID], entityIDs: [])

        let listed = try await repository.cards(inDeck: PersistenceFixtures.deckID)
        XCTAssertNil(listed.first { $0.id == PersistenceFixtures.cardID })
        let stored = try await repository.card(id: PersistenceFixtures.cardID)
        XCTAssertEqual(stored?.backSideFacts, facts)
    }
}

/// The store carries an outbox nobody has uploaded yet, so a schema change has
/// to be a migration rather than a reset.
final class LocalStoreMigrationTests: XCTestCase {
    func testTheCurrentSchemaIsTheLatestVersionThePlanKnows() {
        XCTAssertEqual(
            LocalStoreMigrationPlan.schemas.last?.versionIdentifier,
            LocalSchemaV4.versionIdentifier
        )
        XCTAssertEqual(LocalSchemaV4.versionIdentifier, Schema.Version(4, 0, 0))
    }

    /// Every version the plan lists has to be reachable from the one before it,
    /// or a device on an older store has no route forward.
    func testEveryVersionHasAStageLeadingToIt() {
        XCTAssertEqual(
            LocalStoreMigrationPlan.stages.count,
            LocalStoreMigrationPlan.schemas.count - 1
        )
    }

    func testTheStoreOpensOnTheCurrentSchema() throws {
        XCTAssertNoThrow(try LocalStore(location: .inMemory))
    }
}

/// The facts have to survive the mapping as well as the store: they arrive on
/// the card the deck listing returns, which is the only place this client sees
/// them.
final class CardBackFactsMappingTests: XCTestCase {
    func testTheFactsOnAPublishedCardReachTheRecord() async throws {
        let transport = MockClientTransport()
        await transport.always(
            SyntheticContent.deckCardsResponse(facts: true),
            for: "listDeckCards"
        )

        let page = try await ContentTestClient.makeService(transport: transport)
            .cards(inDeck: UUID(), locale: "en", supportedTemplateSchemaVersions: [1])

        let facts = try XCTUnwrap(page.cards.first?.backSideFacts)
        XCTAssertEqual(facts.map(\.type), ["CAPITAL"])
        XCTAssertEqual(facts.map(\.displayValue), ["Paris"])
        XCTAssertEqual(facts.map(\.sourceName), ["annexare/Countries"])
    }
}
