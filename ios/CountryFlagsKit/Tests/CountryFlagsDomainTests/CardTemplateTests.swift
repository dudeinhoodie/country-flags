import XCTest

@testable import CountryFlagsDomain

/// The rules that decide which card is drawn how, and which cards may stand
/// in one question.
final class CardTemplateTests: XCTestCase {
    // MARK: - The registry

    /// A template with a case but no row would be a face nothing selects: the
    /// selector would drop every card of it and the renderer would never run.
    func testEveryTemplateThisBuildDrawsIsRegistered() {
        let registered = Set(CardTemplateRegistry.registered.values)

        XCTAssertEqual(registered, Set(CardTemplate.allCases))
    }

    /// The version alone is not the key. This is the failure ADR-020 names:
    /// a coat of arms published at v1 passes a version check written for
    /// flags, and would be drawn by the flag renderer.
    func testAKnownVersionOfAnUnknownCodeIsNotSupported() {
        let key = CardTemplateKey(code: "CAPITAL_TO_COUNTRY", schemaVersion: 1)

        XCTAssertNil(CardTemplateRegistry.template(for: key))
    }

    func testAnUnknownVersionOfAKnownCodeIsNotSupported() {
        let key = CardTemplateKey(code: "FLAG_TO_COUNTRY", schemaVersion: 2)

        XCTAssertNil(CardTemplateRegistry.template(for: key))
    }

    func testBothRegisteredPairsResolve() {
        XCTAssertEqual(
            CardTemplateRegistry.template(
                for: CardTemplateKey(code: "FLAG_TO_COUNTRY", schemaVersion: 1)
            ),
            .flagToCountry
        )
        XCTAssertEqual(
            CardTemplateRegistry.template(
                for: CardTemplateKey(code: "COAT_OF_ARMS_TO_COUNTRY", schemaVersion: 1)
            ),
            .coatOfArmsToCountry
        )
    }

    /// An unknown template arrives by the deckful, and fifty identical reports
    /// say nothing the first one did not.
    func testUnknownPairsAreReportedOnceEach() {
        let cards = [
            Self.card(index: 0, code: "FLAG_TO_COUNTRY"),
            Self.card(index: 1, code: "ANTHEM_TO_COUNTRY"),
            Self.card(index: 2, code: "ANTHEM_TO_COUNTRY"),
            Self.card(index: 3, code: "ANTHEM_TO_COUNTRY", schemaVersion: 2),
        ]

        let keys = CardTemplateRegistry.unsupportedKeys(in: cards)

        XCTAssertEqual(
            keys,
            [
                CardTemplateKey(code: "ANTHEM_TO_COUNTRY", schemaVersion: 1),
                CardTemplateKey(code: "ANTHEM_TO_COUNTRY", schemaVersion: 2),
            ]
        )
    }

    func testTheKeyIdentifierNamesBothHalves() {
        XCTAssertEqual(
            CardTemplateKey(code: "COAT_OF_ARMS_TO_COUNTRY", schemaVersion: 1).identifier,
            "COAT_OF_ARMS_TO_COUNTRY@v1"
        )
    }

    // MARK: - Selection

    /// The whole point of the pair: a build that draws flags must not deal
    /// itself a coat of arms because the schema version happened to match.
    func testACardOfAnUnknownTemplateNeverEntersASession() {
        let drawable = Self.card(index: 0, code: "FLAG_TO_COUNTRY")
        let notDrawable = Self.card(index: 1, code: "ANTHEM_TO_COUNTRY")

        let selected = LocalCardSelection.select(
            from: [drawable, notDrawable],
            states: [],
            size: .five,
            supportedTemplateSchemaVersions: [1],
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        XCTAssertEqual(selected.map(\.card.id), [drawable.id])
    }

    func testACoatOfArmsCardIsSelectedNowThatThisBuildDrawsOne() {
        let coat = Self.card(index: 0, code: "COAT_OF_ARMS_TO_COUNTRY")

        let selected = LocalCardSelection.select(
            from: [coat],
            states: [],
            size: .five,
            supportedTemplateSchemaVersions: [1],
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        XCTAssertEqual(selected.map(\.card.id), [coat.id])
    }

    // MARK: - Distractors

    /// A coat of arms beside three flags is not a harder question, it is a
    /// different one.
    func testOptionsNeverMixTemplates() throws {
        let answer = Self.card(index: 0, code: "COAT_OF_ARMS_TO_COUNTRY")
        let coats = (1...5).map { Self.card(index: $0, code: "COAT_OF_ARMS_TO_COUNTRY") }
        let flags = (6...20).map { Self.card(index: $0, code: "FLAG_TO_COUNTRY") }

        let options = try LocalDistractorSelection.options(
            for: answer,
            from: [answer] + coats + flags,
            seed: "seed"
        )

        let coatNames = Set(([answer] + coats).map(\.displayName))
        XCTAssertEqual(options.count, 4)
        XCTAssertTrue(options.allSatisfy { coatNames.contains($0.displayName) })
    }

    /// The rule the issue states in as many words: a state's flag is never
    /// answered with a country.
    func testAStateIsNeverAnsweredWithACountry() throws {
        let answer = Self.card(index: 0, code: "FLAG_TO_COUNTRY")
        let states = (1...5).map { Self.card(index: $0, code: "FLAG_TO_COUNTRY") }
        let countries = (6...20).map { Self.card(index: $0, code: "FLAG_TO_COUNTRY") }
        var kinds: [UUID: CardSubjectKind] = [:]
        for card in [answer] + states { kinds[card.id] = .subdivision }
        for card in countries { kinds[card.id] = .country }

        let options = try LocalDistractorSelection.options(
            for: answer,
            from: [answer] + states + countries,
            seed: "seed",
            subjectKinds: kinds
        )

        let stateNames = Set(([answer] + states).map(\.displayName))
        XCTAssertEqual(options.count, 4)
        XCTAssertTrue(options.allSatisfy { stateNames.contains($0.displayName) })
    }

    /// And the other way round, which is the case a mixed deck produces on its
    /// own: the United States and California in one pool.
    func testACountryIsNeverAnsweredWithAState() throws {
        let answer = Self.card(index: 0, code: "FLAG_TO_COUNTRY")
        let countries = (1...5).map { Self.card(index: $0, code: "FLAG_TO_COUNTRY") }
        let states = (6...20).map { Self.card(index: $0, code: "FLAG_TO_COUNTRY") }
        var kinds: [UUID: CardSubjectKind] = [:]
        for card in states { kinds[card.id] = .subdivision }

        let options = try LocalDistractorSelection.options(
            for: answer,
            from: [answer] + countries + states,
            seed: "seed",
            subjectKinds: kinds
        )

        let countryNames = Set(([answer] + countries).map(\.displayName))
        XCTAssertTrue(options.allSatisfy { countryNames.contains($0.displayName) })
    }

    /// Narrowing the pool has to narrow it honestly: a deck with three states
    /// among fifty countries cannot ask a four-option question about a state,
    /// and saying so is better than filling the gap with countries.
    func testTooFewCompatibleCardsIsTheSameFailureAsTooFewCards() {
        let answer = Self.card(index: 0, code: "FLAG_TO_COUNTRY")
        let countries = (1...20).map { Self.card(index: $0, code: "FLAG_TO_COUNTRY") }
        let kinds: [UUID: CardSubjectKind] = [answer.id: .subdivision]

        XCTAssertThrowsError(
            try LocalDistractorSelection.options(
                for: answer,
                from: [answer] + countries,
                seed: "seed",
                subjectKinds: kinds
            )
        ) { error in
            XCTAssertEqual(
                error as? DistractorFailure,
                .notEnoughDistractors(learningCardID: answer.id)
            )
        }
    }

    /// Every card published before subdivisions existed is a country, so a
    /// pool nobody has resolved kinds for behaves exactly as it did.
    func testAnUnresolvedPoolStillComposesAQuestion() throws {
        let answer = Self.card(index: 0, code: "FLAG_TO_COUNTRY")
        let others = (1...5).map { Self.card(index: $0, code: "FLAG_TO_COUNTRY") }

        let options = try LocalDistractorSelection.options(
            for: answer,
            from: [answer] + others,
            seed: "seed"
        )

        XCTAssertEqual(options.count, 4)
        XCTAssertTrue(options.contains { $0.displayName == answer.displayName })
    }

    // MARK: - Subject kinds

    func testASubdivisionIsToldApartFromEverythingElse() {
        XCTAssertEqual(CardSubjectKind(entityKind: .subdivision), .subdivision)
        for kind in [
            GeoEntityKind.country, .territory, .dependency, .disputedArea, .region, .subregion,
            .other, .unknown("MOON_BASE"),
        ] {
            XCTAssertEqual(CardSubjectKind(entityKind: kind), .country)
        }
    }

    // MARK: - Fixtures

    private static func card(
        index: Int,
        code: String,
        schemaVersion: Int = 1
    ) -> LearningCardRecord {
        LearningCardRecord(
            id: UUID(uuidString: String(format: "60000000-0000-4000-8000-%012d", index))!,
            subjectEntityID: UUID(
                uuidString: String(format: "61000000-0000-4000-8000-%012d", index)
            )!,
            templateCode: code,
            templateSchemaVersion: schemaVersion,
            semanticVersion: 1,
            revision: 1,
            answerMode: "MULTIPLE_CHOICE",
            promptAssetID: UUID(),
            displayName: "Subject \(index)",
            aliases: [],
            contentVersion: "v1"
        )
    }
}
