import XCTest

@testable import CountryFlagsDomain

final class CatalogGroupingTests: XCTestCase {
    func testDecksAreGroupedByKindWithCollectionsFirst() {
        let sections = CatalogGrouping.sections(for: [
            ContentFixtures.deck(code: "EUROPE", kind: "TAXONOMY", sortOrder: 0),
            ContentFixtures.deck(code: "ALL", kind: "CURATED", sortOrder: 0),
        ])

        XCTAssertEqual(sections.map(\.kind), [.curated, .taxonomy])
        XCTAssertEqual(sections.first?.decks.map(\.code), ["ALL"])
    }

    /// There is a contract fixture for a deck whose kind this build has never
    /// heard of. It has to remain openable: a deck the user can reach is worth
    /// more than a tidy section list.
    func testAnUnknownKindKeepsItsDeckAndSortsLast() {
        let sections = CatalogGrouping.sections(for: [
            ContentFixtures.deck(code: "SEASON", kind: "SEASONAL_EVENT", sortOrder: 0),
            ContentFixtures.deck(code: "ALL", kind: "CURATED", sortOrder: 0),
        ])

        XCTAssertEqual(sections.count, 2)
        XCTAssertEqual(sections.last?.kind, .unknown("SEASONAL_EVENT"))
        XCTAssertEqual(sections.last?.decks.map(\.code), ["SEASON"])
    }

    /// The backend states the order through `sortOrder`; `code` only breaks a
    /// tie, so the catalog cannot reshuffle between launches.
    func testDecksFollowTheBackendOrderAndBreakTiesByCode() {
        let sections = CatalogGrouping.sections(for: [
            ContentFixtures.deck(code: "C", kind: "CURATED", sortOrder: 2),
            ContentFixtures.deck(code: "B", kind: "CURATED", sortOrder: 1),
            ContentFixtures.deck(code: "A", kind: "CURATED", sortOrder: 1),
        ])

        XCTAssertEqual(sections.first?.decks.map(\.code), ["A", "B", "C"])
    }

    func testAnEmptyCatalogHasNoSections() {
        XCTAssertTrue(CatalogGrouping.sections(for: []).isEmpty)
    }
}

final class CatalogSearchTests: XCTestCase {
    private let decks = [
        ContentFixtures.deck(code: "EUROPE", kind: "TAXONOMY", name: "Европа", description: "Страны Европы"),
        ContentFixtures.deck(code: "AFRICA", kind: "TAXONOMY", name: "Африка", description: "Страны Африки"),
    ]

    func testAnEmptyQueryChangesNothing() {
        XCTAssertEqual(CatalogSearch.decks(decks, matching: "  ").count, 2)
    }

    func testDecksMatchOnNameAndDescription() {
        XCTAssertEqual(CatalogSearch.decks(decks, matching: "европ").map(\.code), ["EUROPE"])
        XCTAssertEqual(CatalogSearch.decks(decks, matching: "Африки").map(\.code), ["AFRICA"])
    }

    /// The alternative name is what makes "Kosovo" find "Косово" while the app
    /// is running in Russian.
    func testCardsMatchOnTheirAliases() {
        let cards = [
            ContentFixtures.card(displayName: "Косово", aliases: ["Kosovo"]),
            ContentFixtures.card(displayName: "Сербия", aliases: ["Serbia"]),
        ]

        XCTAssertEqual(
            CatalogSearch.cards(cards, matching: "kosovo").map(\.displayName),
            ["Косово"]
        )
    }

    /// A user should not have to reproduce an accent to reach a country.
    func testSearchFoldsDiacriticsAndCase() {
        let cards = [ContentFixtures.card(displayName: "Côte d'Ivoire", aliases: [])]

        XCTAssertEqual(CatalogSearch.cards(cards, matching: "cote").count, 1)
        XCTAssertEqual(CatalogSearch.cards(cards, matching: "CÔTE").count, 1)
    }

    func testAQueryThatMatchesNothingReturnsNothing() {
        XCTAssertTrue(CatalogSearch.decks(decks, matching: "антарктида").isEmpty)
    }
}

enum ContentFixtures {
    static func deck(
        id: UUID = UUID(),
        code: String,
        kind: String,
        name: String = "Deck",
        description: String = "",
        sortOrder: Int = 0
    ) -> DeckRecord {
        DeckRecord(
            id: id,
            code: code,
            kind: kind,
            name: name,
            deckDescription: description,
            cardCount: 0,
            contentVersion: "v1",
            sortOrder: sortOrder
        )
    }

    static func card(
        id: UUID = UUID(),
        displayName: String,
        aliases: [String]
    ) -> LearningCardRecord {
        LearningCardRecord(
            id: id,
            subjectEntityID: UUID(),
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: UUID(),
            displayName: displayName,
            aliases: aliases,
            contentVersion: "v1"
        )
    }
}
