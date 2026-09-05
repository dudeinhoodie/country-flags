import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

/// What the app does with a template it can draw, and with one it cannot.
@MainActor
final class CardTemplateRenderingTests: XCTestCase {
    private let deckID = UUID(uuidString: "70000000-0000-4000-8000-000000000009")!
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: - Which face a card wears

    func testTheFaceComesFromTheTemplateAndNotFromTheDeck() {
        let flag = Self.card(index: 0, code: "FLAG_TO_COUNTRY")
        let coat = Self.card(index: 1, code: "COAT_OF_ARMS_TO_COUNTRY")
        let future = Self.card(index: 2, code: "ANTHEM_TO_COUNTRY")

        let templates = CardTemplates(records: [flag, coat, future])

        XCTAssertEqual(templates.face(for: flag.id), .template(.flagToCountry))
        XCTAssertEqual(templates.face(for: coat.id), .template(.coatOfArmsToCountry))
        XCTAssertEqual(
            templates.face(for: future.id),
            .unsupported(CardTemplateKey(code: "ANTHEM_TO_COUNTRY", schemaVersion: 1))
        )
    }

    /// A card the store has not answered for is not an unsupported card. The
    /// first frame is drawn before the read finishes, and accusing an ordinary
    /// flag of being a template from the future for that frame would be a
    /// visible lie.
    func testACardNobodyHasResolvedYetIsPendingRatherThanUnsupported() {
        let templates = CardTemplates()

        XCTAssertEqual(templates.face(for: UUID()), .pending)
    }

    /// One country, two templates, two cards — and therefore two independent
    /// rows with progress of their own.
    func testGermanysFlagAndCoatAreTwoCards() {
        let entityID = UUID()
        let flag = Self.card(index: 0, code: "FLAG_TO_COUNTRY", entityID: entityID)
        let coat = Self.card(index: 1, code: "COAT_OF_ARMS_TO_COUNTRY", entityID: entityID)

        let templates = CardTemplates(records: [flag, coat])

        XCTAssertNotEqual(flag.id, coat.id)
        XCTAssertNotEqual(templates.face(for: flag.id), templates.face(for: coat.id))
    }

    // MARK: - An unknown template

    /// It is dropped where the session is composed, not at the screen, and the
    /// drop is reported as an operational error — the deck keeps the cards it
    /// can draw rather than being emptied by one unknown template.
    func testAnUnknownTemplateIsDroppedFromTheSessionAndReported() async {
        let errors = RecordingErrorReporter()
        let drawable = (0..<4).map { Self.card(index: $0, code: "FLAG_TO_COUNTRY") }
        let future = Self.card(index: 9, code: "ANTHEM_TO_COUNTRY")
        let runner = StudySessionRunner(
            scopes: FixedScopeResolver(),
            content: FakeContentRepository(
                decks: [Self.deck(id: deckID)],
                cards: [deckID: drawable + [future]]
            ),
            learning: RecordingLearningRepository(),
            errors: errors,
            dates: FixedDates(instant: now),
            identifiers: SequentialUUIDProvider()
        )

        await runner.startOrResume(deckID: deckID, size: .five)

        let dealt = Set(runner.state?.cards.map(\.learningCardID) ?? [])
        XCTAssertEqual(dealt, Set(drawable.map(\.id)))
        XCTAssertFalse(dealt.contains(future.id))

        let contexts = errors.contexts(
            forOperation: UnsupportedCardTemplateReport.operation
        )
        XCTAssertEqual(contexts.count, 1)
        XCTAssertEqual(contexts.first?.errorCode, "ANTHEM_TO_COUNTRY@v1")
        XCTAssertEqual(contexts.first?.category, .content)
    }

    /// The report carries the pair and nothing else — no card, no country, no
    /// account. It is the release that is being described, not a person.
    func testTheReportNamesOnlyTheTemplate() {
        let errors = RecordingErrorReporter()

        UnsupportedCardTemplateReport.send(
            CardTemplateKey(code: "ANTHEM_TO_COUNTRY", schemaVersion: 3),
            to: errors
        )

        let report = errors.reports.first
        let expected = CardTemplateKey(code: "ANTHEM_TO_COUNTRY", schemaVersion: 3)
        XCTAssertEqual(
            report?.error as? UnsupportedCardTemplate,
            UnsupportedCardTemplate(key: expected)
        )
        XCTAssertEqual(report?.context.errorCode, "ANTHEM_TO_COUNTRY@v3")
        XCTAssertNil(report?.context.requestID)
        XCTAssertNil(report?.context.localOperationID)
    }

    /// A deck of nothing but an unknown template is empty rather than broken,
    /// and the screen has words for that already.
    func testADeckOfOneUnknownTemplateStartsNoSession() async {
        let errors = RecordingErrorReporter()
        let runner = StudySessionRunner(
            scopes: FixedScopeResolver(),
            content: FakeContentRepository(
                decks: [Self.deck(id: deckID)],
                cards: [deckID: (0..<5).map { Self.card(index: $0, code: "ANTHEM_TO_COUNTRY") }]
            ),
            learning: RecordingLearningRepository(),
            errors: errors,
            dates: FixedDates(instant: now),
            identifiers: SequentialUUIDProvider()
        )

        await runner.startOrResume(deckID: deckID, size: .five)

        XCTAssertEqual(runner.startFailure, .noUsableCards)
        XCTAssertEqual(
            errors.contexts(forOperation: UnsupportedCardTemplateReport.operation).count,
            1
        )
    }

    // MARK: - Distractors, through the runner

    /// The end-to-end form of the rule: the runner resolves what each card is
    /// about and hands it to the selection, so a state's flag draws states.
    func testAStateFlagQuestionDrawsNoCountryOptions() async {
        let states = (0..<4).map {
            Self.card(index: $0, code: "FLAG_TO_COUNTRY", entityID: Self.entityID($0))
        }
        let countries = (4..<12).map {
            Self.card(index: $0, code: "FLAG_TO_COUNTRY", entityID: Self.entityID($0))
        }
        var entities: [UUID: GeoEntityRecord] = [:]
        for card in states {
            entities[card.subjectEntityID] = Self.entity(id: card.subjectEntityID, kind: "SUBDIVISION")
        }
        for card in countries {
            entities[card.subjectEntityID] = Self.entity(id: card.subjectEntityID, kind: "COUNTRY")
        }

        let runner = ObjectiveSessionRunner(
            scopes: FixedScopeResolver(),
            content: FakeContentRepository(
                decks: [Self.deck(id: deckID)],
                cards: [deckID: states + countries],
                entities: entities
            ),
            learning: RecordingLearningRepository(),
            dates: FixedDates(instant: now),
            identifiers: SequentialUUIDProvider()
        )

        await runner.startOrResume(deckID: deckID, size: .twenty)

        let stateNames = Set(states.map(\.displayName))
        let countryNames = Set(countries.map(\.displayName))
        let questions = runner.state?.questions ?? []
        var stateQuestions = 0
        for question in questions where stateNames.contains(question.displayName) {
            stateQuestions += 1
            for option in question.options {
                XCTAssertFalse(
                    countryNames.contains(option.displayName),
                    "\(option.displayName) is a country beside a state's flag"
                )
            }
        }
        // Otherwise the loop above proves nothing: a sitting with no state in
        // it would pass without ever asking the question this test is about.
        XCTAssertEqual(stateQuestions, states.count)
    }

    // MARK: - Fixtures

    private static func deck(id: UUID) -> DeckRecord {
        DeckRecord(
            id: id,
            code: "DECK",
            kind: "CURATED",
            name: "Deck",
            deckDescription: "",
            cardCount: 0,
            contentVersion: "v1",
            sortOrder: 0
        )
    }

    private static func entityID(_ index: Int) -> UUID {
        UUID(uuidString: String(format: "62000000-0000-4000-8000-%012d", index))!
    }

    private static func entity(id: UUID, kind: String) -> GeoEntityRecord {
        GeoEntityRecord(
            id: id,
            kind: kind,
            status: "PUBLISHED",
            recognitionStatus: "RECOGNIZED",
            contentVersion: "v1",
            names: [],
            assets: [],
            facts: []
        )
    }

    private static func card(
        index: Int,
        code: String,
        schemaVersion: Int = 1,
        entityID: UUID? = nil
    ) -> LearningCardRecord {
        LearningCardRecord(
            id: UUID(uuidString: String(format: "63000000-0000-4000-8000-%012d", index))!,
            subjectEntityID: entityID ?? Self.entityID(index),
            templateCode: code,
            templateSchemaVersion: schemaVersion,
            semanticVersion: 1,
            revision: 1,
            answerMode: StudyAnswerMode.multipleChoice.rawValue,
            promptAssetID: UUID(),
            displayName: "Subject \(index)",
            aliases: [],
            contentVersion: "v1"
        )
    }
}
