import XCTest

@testable import CountryFlagsDomain

final class ObjectiveSessionReducerTests: XCTestCase {
    private let reviewID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!

    /// The invariant the whole mode rests on: nothing a view receives before an
    /// answer names the correct option.
    func testThePresentationHidesTheAnswerUntilItIsGiven() {
        let state = Self.state(questionCount: 1)

        let presentation = try? XCTUnwrap(state.presentation)
        XCTAssertNil(presentation?.correctOptionID)
        XCTAssertNil(presentation?.selectedOptionID)
        XCTAssertFalse(presentation?.isAnswered ?? true)
        // Every option is undecided, so none can be told apart by its outcome.
        for option in presentation?.options ?? [] {
            XCTAssertEqual(presentation?.outcome(for: option), .undecided)
        }
    }

    func testEveryQuestionHasFourUniqueOptions() {
        let state = Self.state(questionCount: 3)

        for question in state.questions {
            XCTAssertEqual(question.options.count, 4)
            XCTAssertEqual(Set(question.options.map(\.id)).count, 4)
            XCTAssertEqual(Set(question.options.map(\.position)), [0, 1, 2, 3])
            // Two identical labels would put the learner in front of two
            // answers that cannot be told apart.
            XCTAssertEqual(Set(question.options.map(\.displayName)).count, 4)
        }
    }

    func testChoosingAnOptionAsksForACommit() {
        var state = Self.state(questionCount: 2)
        let chosen = state.questions[0].options[1]

        let effect = ObjectiveSessionReducer.reduce(
            &state,
            .choose(optionID: chosen.id, reviewID: reviewID)
        )

        XCTAssertEqual(
            effect,
            .commit(reviewID: reviewID, question: state.questions[0], optionID: chosen.id)
        )
        XCTAssertTrue(state.isCommitting)
        // Still nothing revealed while the write is in flight.
        XCTAssertNil(state.presentation?.correctOptionID)
    }

    /// The double-tap criterion: the second choice arrives while the first is
    /// being written and is dropped.
    func testASecondChoiceDuringACommitIsDropped() {
        var state = Self.state(questionCount: 2)
        let first = state.questions[0].options[0]
        let second = state.questions[0].options[1]
        ObjectiveSessionReducer.reduce(&state, .choose(optionID: first.id, reviewID: reviewID))

        let effect = ObjectiveSessionReducer.reduce(
            &state,
            .choose(optionID: second.id, reviewID: UUID())
        )

        XCTAssertNil(effect)
        ObjectiveSessionReducer.reduce(&state, .commitSucceeded)
        XCTAssertEqual(state.answers.count, 1)
        XCTAssertEqual(state.answers[state.questions[0].sessionCardID], first.id)
    }

    /// An answer cannot be changed once it is given.
    func testAnAnsweredQuestionRefusesAnotherChoice() {
        var state = Self.state(questionCount: 2)
        let first = state.questions[0].options[0]
        ObjectiveSessionReducer.reduce(&state, .choose(optionID: first.id, reviewID: reviewID))
        ObjectiveSessionReducer.reduce(&state, .commitSucceeded)

        let effect = ObjectiveSessionReducer.reduce(
            &state,
            .choose(optionID: state.questions[0].options[2].id, reviewID: UUID())
        )

        XCTAssertNil(effect)
        XCTAssertEqual(state.answers[state.questions[0].sessionCardID], first.id)
    }

    /// A tap carrying an option from another question cannot answer this one.
    func testAnOptionFromAnotherQuestionIsRefused() {
        var state = Self.state(questionCount: 2)
        let foreign = state.questions[1].options[0]

        let effect = ObjectiveSessionReducer.reduce(
            &state,
            .choose(optionID: foreign.id, reviewID: reviewID)
        )

        XCTAssertNil(effect)
        XCTAssertEqual(state.phase, .asking(index: 0))
    }

    func testTheOutcomeIsRevealedOnlyAfterTheAnswer() {
        var state = Self.state(questionCount: 1)
        let correctID = try? XCTUnwrap(state.questions[0].correctOptionID)
        let wrong = state.questions[0].options.first { $0.id != correctID }!
        ObjectiveSessionReducer.reduce(&state, .choose(optionID: wrong.id, reviewID: reviewID))
        ObjectiveSessionReducer.reduce(&state, .commitSucceeded)

        let presentation = try? XCTUnwrap(state.presentation)
        XCTAssertEqual(presentation?.selectedOptionID, wrong.id)
        XCTAssertEqual(presentation?.correctOptionID, correctID)
        XCTAssertEqual(presentation?.outcome(for: wrong), .incorrect)
        let correctOption = state.questions[0].options.first { $0.id == correctID }!
        XCTAssertEqual(presentation?.outcome(for: correctOption), .correct)
    }

    func testAFailedCommitLeavesTheQuestionAskable() {
        var state = Self.state(questionCount: 1)
        let chosen = state.questions[0].options[0]
        ObjectiveSessionReducer.reduce(&state, .choose(optionID: chosen.id, reviewID: reviewID))

        ObjectiveSessionReducer.reduce(&state, .commitFailed)

        XCTAssertEqual(state.phase, .asking(index: 0))
        XCTAssertTrue(state.answers.isEmpty)
        XCTAssertNil(state.presentation?.correctOptionID)
    }

    func testAdvancingPastTheLastQuestionFinishesTheSession() {
        var state = Self.state(questionCount: 1)
        ObjectiveSessionReducer.reduce(
            &state,
            .choose(optionID: state.questions[0].options[0].id, reviewID: reviewID)
        )
        ObjectiveSessionReducer.reduce(&state, .commitSucceeded)

        let effect = ObjectiveSessionReducer.reduce(&state, .advance)

        XCTAssertEqual(effect, .complete)
        XCTAssertEqual(state.phase, .finished)
        XCTAssertNil(state.presentation)
    }

    // MARK: - Fixtures

    static func state(questionCount: Int) -> ObjectiveSessionState {
        let pool = (0..<8).map { LocalCardSelectionTests.card(index: $0) }
        let questions = (0..<questionCount).map { index -> ObjectiveQuestion in
            let card = pool[index]
            let options = try! LocalDistractorSelection.options(
                for: card,
                from: pool,
                seed: "seed-\(index)"
            )
            return ObjectiveQuestion(
                sessionCardID: UUID(uuidString: String(format: "40000000-0000-4000-8000-%012d", index))!,
                learningCardID: card.id,
                promptAssetID: card.promptAssetID,
                displayName: card.displayName,
                options: options,
                correctOptionID: LocalDistractorSelection.correctOptionID(
                    in: options,
                    answer: card.displayName
                )
            )
        }
        return ObjectiveSessionState(
            sessionID: UUID(uuidString: "20000000-0000-4000-8000-000000000001")!,
            deckID: UUID(uuidString: "30000000-0000-4000-8000-000000000001")!,
            questions: questions,
            phase: .asking(index: 0)
        )
    }
}

final class LocalDistractorSelectionTests: XCTestCase {
    private let pool = (0..<8).map { LocalCardSelectionTests.card(index: $0) }

    func testFourUniqueOptionsIncludingTheAnswer() throws {
        let card = pool[0]

        let options = try LocalDistractorSelection.options(for: card, from: pool, seed: "seed")

        XCTAssertEqual(options.count, 4)
        XCTAssertEqual(Set(options.map(\.id)).count, 4)
        XCTAssertEqual(options.map(\.position), [0, 1, 2, 3])
        XCTAssertTrue(options.contains { $0.displayName == card.displayName })
    }

    /// A relaunch must show the same question, so the same inputs produce the
    /// same options in the same order with the same identifiers.
    func testTheSameSeedProducesTheSameQuestion() throws {
        let card = pool[0]

        let first = try LocalDistractorSelection.options(for: card, from: pool, seed: "seed-a")
        let second = try LocalDistractorSelection.options(
            for: card,
            from: pool.reversed(),
            seed: "seed-a"
        )

        XCTAssertEqual(first, second)
    }

    func testADifferentSeedProducesADifferentArrangement() throws {
        let card = pool[0]

        let first = try LocalDistractorSelection.options(for: card, from: pool, seed: "seed-a")
        let second = try LocalDistractorSelection.options(for: card, from: pool, seed: "seed-b")

        XCTAssertNotEqual(first.map(\.displayName), second.map(\.displayName))
    }

    /// Two countries with the same localized name must never be offered
    /// together: one of them would be marked wrong for being a duplicate.
    func testDuplicateNamesAreNeverOfferedTogether() throws {
        let card = LocalCardSelectionTests.card(index: 0)
        var pool = [card]
        // Four more cards, but only three distinct names.
        pool.append(contentsOf: [1, 2, 3].map { LocalCardSelectionTests.card(index: $0) })
        pool.append(Self.renamed(LocalCardSelectionTests.card(index: 4), to: pool[1].displayName))

        let options = try LocalDistractorSelection.options(for: card, from: pool, seed: "seed")

        XCTAssertEqual(Set(options.map(\.displayName)).count, 4)
    }

    /// The deck cannot fill four distinct answers, which the backend reports as
    /// 422 NO_DISTRACTORS. The client names the same situation rather than
    /// showing a broken question.
    func testTooFewDistinctNamesIsReportedRatherThanRendered() {
        let card = LocalCardSelectionTests.card(index: 0)
        let pool = [card, LocalCardSelectionTests.card(index: 1)]

        XCTAssertThrowsError(
            try LocalDistractorSelection.options(for: card, from: pool, seed: "seed")
        ) { error in
            XCTAssertEqual(
                error as? DistractorFailure,
                .notEnoughDistractors(learningCardID: card.id)
            )
        }
    }

    func testARetiredCardIsNeverOfferedAsADistractor() throws {
        let card = LocalCardSelectionTests.card(index: 0)
        let retired = LocalCardSelectionTests.card(index: 9, isRetired: true)
        var pool = [card, retired]
        pool.append(contentsOf: [1, 2, 3].map { LocalCardSelectionTests.card(index: $0) })

        let options = try LocalDistractorSelection.options(for: card, from: pool, seed: "seed")

        XCTAssertFalse(options.contains { $0.displayName == retired.displayName })
    }

    /// The ordering must not depend on a per-process seed, or the same session
    /// would look different after a relaunch.
    func testTheHashIsStableAcrossCalls() {
        XCTAssertEqual(
            LocalDistractorSelection.hash("country-flags"),
            LocalDistractorSelection.hash("country-flags")
        )
    }

    private static func renamed(_ card: LearningCardRecord, to name: String) -> LearningCardRecord {
        LearningCardRecord(
            id: card.id,
            subjectEntityID: card.subjectEntityID,
            templateCode: card.templateCode,
            templateSchemaVersion: card.templateSchemaVersion,
            semanticVersion: card.semanticVersion,
            revision: card.revision,
            answerMode: card.answerMode,
            promptAssetID: card.promptAssetID,
            displayName: name,
            aliases: card.aliases,
            contentVersion: card.contentVersion,
            isRetired: card.isRetired
        )
    }
}
