import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

@MainActor
final class ObjectiveSessionRunnerTests: XCTestCase {
    private let deckID = UUID(uuidString: "70000000-0000-4000-8000-000000000001")!
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testStartingComposesFourOptionQuestionsAndStoresTheirSnapshot() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 6, learning: learning)

        await runner.startOrResume(deckID: deckID, size: .five)

        let questions = runner.state?.questions ?? []
        XCTAssertEqual(questions.count, 5)
        for question in questions {
            XCTAssertEqual(question.options.count, 4)
            XCTAssertEqual(Set(question.options.map(\.displayName)).count, 4)
        }
        let sessions = await learning.recordedSessions()
        XCTAssertEqual(sessions.first?.mode, StudyAnswerMode.multipleChoice.rawValue)
        // The options are part of the stored snapshot, which is what lets a
        // relaunch rebuild the very same question.
        XCTAssertEqual(sessions.first?.cards.first?.optionIDs.count, 4)
        XCTAssertEqual(sessions.first?.cards.first?.optionNames.count, 4)
    }

    /// A deck that cannot fill four distinct answers is named the way the
    /// contract names it, and offering a retry would be a lie: the pool stays
    /// too small until the content changes.
    func testADeckWithTooFewDistinctNamesReportsTheDistractorPool() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 2, learning: learning)

        await runner.startOrResume(deckID: deckID, size: .five)

        XCTAssertEqual(runner.startFailure, .distractorPoolInsufficient)
        XCTAssertFalse(runner.startFailure?.isRetryable ?? true)
        XCTAssertNil(runner.state)
        let sessions = await learning.recordedSessions()
        XCTAssertTrue(sessions.isEmpty)
    }

    func testAnAnswerIsStoredWithTheOpaqueOptionIdentifier() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 6, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)
        let chosen = runner.state!.questions[0].options[2]

        await runner.choose(optionID: chosen.id)

        let reviews = await learning.recordedReviews()
        XCTAssertEqual(reviews.count, 1)
        XCTAssertEqual(reviews.first?.selectedOptionID, chosen.id)
        XCTAssertEqual(reviews.first?.answerMode, StudyAnswerMode.multipleChoice.rawValue)
        // The outcome is revealed only after the answer.
        XCTAssertNotNil(runner.state?.presentation?.correctOptionID)
    }

    /// The double-tap criterion for this mode.
    func testTwoOverlappingChoicesProduceOneReview() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 6, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)
        let first = runner.state!.questions[0].options[0]
        let second = runner.state!.questions[0].options[1]

        await learning.armGate()
        async let a: Void = runner.choose(optionID: first.id)
        await Task.yield()
        async let b: Void = runner.choose(optionID: second.id)
        await Task.yield()
        await learning.openGate()
        _ = await (a, b)

        let reviews = await learning.recordedReviews()
        XCTAssertEqual(reviews.count, 1)
        XCTAssertEqual(reviews.first?.selectedOptionID, first.id)
    }

    /// An answer cannot be revised once it is stored.
    func testAnAnsweredQuestionIgnoresAnotherChoice() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 6, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)
        let first = runner.state!.questions[0].options[0]
        await runner.choose(optionID: first.id)

        await runner.choose(optionID: runner.state!.questions[0].options[3].id)

        let reviews = await learning.recordedReviews()
        XCTAssertEqual(reviews.count, 1)
        XCTAssertEqual(reviews.first?.selectedOptionID, first.id)
    }

    func testAFailedWriteLeavesTheQuestionAnswerable() async {
        let learning = RecordingLearningRepository(failReviews: true)
        let runner = makeRunner(cards: 6, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)

        await runner.choose(optionID: runner.state!.questions[0].options[0].id)

        XCTAssertTrue(runner.lastCommitFailed)
        XCTAssertEqual(runner.state?.phase, .asking(index: 0))
        // Nothing is revealed, so a retry is still a real question.
        XCTAssertNil(runner.state?.presentation?.correctOptionID)
    }

    /// The relaunch criterion: position and answered state come back from the
    /// store, and the question is rebuilt from its snapshot rather than
    /// recomposed from the deck.
    func testARelaunchRestoresPositionAndTheSameOptions() async {
        let learning = RecordingLearningRepository()
        let identifiers = SequentialUUIDProvider()
        let first = makeRunner(cards: 6, learning: learning, identifiers: identifiers)
        await first.startOrResume(deckID: deckID, size: .five)
        let firstQuestionOptions = first.state!.questions[0].options
        await first.choose(optionID: firstQuestionOptions[0].id)
        await first.advance()

        let relaunched = makeRunner(cards: 6, learning: learning, identifiers: identifiers)
        await relaunched.startOrResume(deckID: deckID, size: .five)

        XCTAssertEqual(relaunched.state?.sessionID, first.state?.sessionID)
        XCTAssertEqual(relaunched.state?.position, 2)
        XCTAssertEqual(relaunched.state?.questions[0].options, firstQuestionOptions)
        // The answered question keeps its recorded choice.
        XCTAssertEqual(
            relaunched.state?.answers[first.state!.questions[0].sessionCardID],
            firstQuestionOptions[0].id
        )
    }

    /// The result counts what was stored, and correctness is decided by the
    /// option identity rather than by the text that was displayed.
    func testTheResultCountsStoredAnswersAndTheirCorrectness() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 6, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)

        for _ in 0..<5 {
            guard let question = runner.state?.currentQuestion else { break }
            let correct = question.options.first { question.isCorrect($0.id) }!
            await runner.choose(optionID: correct.id)
            await runner.advance()
        }

        let summary = try? XCTUnwrap(runner.summary)
        XCTAssertEqual(summary?.answeredQuestions, 5)
        XCTAssertEqual(summary?.correctAnswers, 5)
        XCTAssertEqual(summary?.plannedQuestions, 5)
        let sessions = await learning.recordedSessions()
        XCTAssertEqual(sessions.first?.status, StudySessionStatus.completed.rawValue)
    }

    func testAWrongAnswerIsCountedAsSuch() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 6, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)
        let question = runner.state!.currentQuestion!
        let wrong = question.options.first { !question.isCorrect($0.id) }!

        await runner.choose(optionID: wrong.id)

        let projections = await learning.recordedProjections()
        // A wrong objective answer is a lapse for the scheduler, exactly as
        // rating a card "again" would be.
        XCTAssertEqual(projections.first?.state, "RELEARNING")
        XCTAssertEqual(runner.state?.presentation?.outcome(for: wrong), .incorrect)
    }

    // MARK: - Helpers

    private func makeRunner(
        cards: Int,
        learning: RecordingLearningRepository,
        identifiers: any IdentifierProviding = SequentialUUIDProvider()
    ) -> ObjectiveSessionRunner {
        ObjectiveSessionRunner(
            scopes: FixedScopeResolver(),
            content: FakeContentRepository(
                decks: [Self.deck(id: deckID)],
                cards: [deckID: (0..<cards).map { Self.card(index: $0) }]
            ),
            learning: learning,
            dates: FixedDates(instant: now),
            identifiers: identifiers
        )
    }

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

    private static func card(index: Int) -> LearningCardRecord {
        LearningCardRecord(
            id: UUID(uuidString: String(format: "50000000-0000-4000-8000-%012d", index))!,
            subjectEntityID: UUID(),
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: StudyAnswerMode.multipleChoice.rawValue,
            promptAssetID: UUID(),
            displayName: "Country \(index)",
            aliases: [],
            contentVersion: "v1"
        )
    }
}
