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

    /// The parts have to survive the store as much as the line does: the
    /// screens read them offline, and a fact that lost them there would be
    /// worded one way on a fresh sync and another after a relaunch (#255).
    func testTheStructuredPartsOfAFactSurviveTheStore() async throws {
        let repository = try LocalStore(location: .inMemory).makeContentRepository()
        let currency = FactRecord(
            type: "CURRENCY",
            displayValue: "Euro (EUR)",
            sourceName: "TEST_ONLY",
            details: .currency(tenders: [
                .init(code: "EUR", name: "Euro", role: "official")
            ])
        )
        let population = FactRecord(
            type: "POPULATION",
            displayValue: "11,822,592 (2024)",
            sourceName: "TEST_ONLY",
            details: .population(value: 11_822_592, year: 2024)
        )

        try await repository.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [],
            decks: [PersistenceFixtures.deck()],
            cards: [PersistenceFixtures.card(facts: [currency, population])],
            deckCards: [PersistenceFixtures.deckCard()]
        )

        let stored = try await repository.card(id: PersistenceFixtures.cardID)
        XCTAssertEqual(stored?.backSideFacts, [currency, population])
        XCTAssertEqual(
            stored?.backSideFacts.first?.details,
            .currency(tenders: [.init(code: "EUR", name: "Euro", role: "official")])
        )
    }

    /// The country sheet reads the entity's facts rather than the card's, and
    /// those take the other route through the store — a column of their own on
    /// a model, not a value inside the card.
    func testTheEntityFactsKeepTheirPartsToo() async throws {
        let repository = try LocalStore(location: .inMemory).makeContentRepository()
        let capital = FactRecord(
            type: "CAPITAL",
            displayValue: "Брюссель",
            sourceName: "TEST_ONLY",
            details: .capital(seats: [.init(name: "Брюссель", role: "official")])
        )
        let entity = GeoEntityRecord(
            id: PersistenceFixtures.entityID,
            kind: "COUNTRY",
            status: "ACTIVE",
            recognitionStatus: "UN_MEMBER",
            contentVersion: "test-only-fixture-v1",
            names: [],
            assets: [],
            facts: [capital]
        )

        try await repository.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [entity],
            decks: [],
            cards: [],
            deckCards: []
        )

        let stored = try await repository.entity(id: PersistenceFixtures.entityID)
        XCTAssertEqual(stored?.facts, [capital])
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
            LocalSchemaV5.versionIdentifier
        )
        XCTAssertEqual(LocalSchemaV5.versionIdentifier, Schema.Version(5, 0, 0))
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
