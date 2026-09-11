import XCTest

/// The quiz mode end to end: it appears only when its flag is on, four options
/// are offered, the answer is fixed once chosen, the result is reached — and a
/// run that outlives the process comes back as the same question rather than a
/// freshly composed one.
@MainActor
final class ObjectiveSessionUITests: XCTestCase {
    /// The flag is server-enforced and defaults to off, so the mode is turned
    /// on for the test through the override the debug builds already accept.
    private let quizEnabled = ["-feature-flag", "study.multiple_choice.enabled=true"]

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// The mode is a released feature: with the flag off it is not offered at
    /// all rather than offered and refused.
    func testTheModeIsAbsentUntilItsFlagIsOn() {
        let app = launch(arguments: ["-reset-store"])
        openDeck(in: app)

        XCTAssertTrue(app.buttons["study.start"].waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(app.buttons["study.mode.objective"].exists)
    }

    func testAGuestAnswersTheQuizAndReachesTheResult() {
        let app = launch(arguments: ["-reset-store"] + quizEnabled)
        openDeck(in: app)

        let quiz = app.buttons["study.mode.objective"]
        XCTAssertTrue(quiz.waitForExistence(timeout: 30), app.debugDescription)
        quiz.tap()
        app.buttons["study.start"].tap()

        let result = app.staticTexts["study.result.title"]
        var answered = 0
        while !result.exists && answered < 30 {
            let firstOption = app.buttons["study.option.0"]
            // Composing a question draws its distractors from the whole deck,
            // and the deck is the published release rather than a handful of
            // cards, so this waits as long as a bootstrap does.
            XCTAssertTrue(firstOption.waitForExistence(timeout: 30), app.debugDescription)
            // Four options, every one of them tappable before a choice.
            for position in 0..<4 {
                XCTAssertTrue(app.buttons["study.option.\(position)"].exists, app.debugDescription)
            }
            // Nothing on screen says which one is right yet.
            XCTAssertFalse(app.buttons["study.next"].exists)

            firstOption.tap()

            let next = app.buttons["study.next"]
            XCTAssertTrue(next.waitForExistence(timeout: 10), app.debugDescription)
            // The answer is fixed: the options no longer accept input.
            XCTAssertFalse(app.buttons["study.option.1"].isEnabled)
            next.tap()
            answered += 1
        }

        XCTAssertGreaterThan(answered, 0)
        XCTAssertTrue(result.waitForExistence(timeout: 10), app.debugDescription)
        let score = app.staticTexts["study.result.answered"]
        XCTAssertTrue(score.exists)
        XCTAssertFalse(score.label.isEmpty)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(score.label.contains("study.objective"))
    }

    /// IOS-E2E-QZ-07: a quiz survives the process ending.
    ///
    /// A question is not a card — it is a card plus three distractors in an
    /// order somebody chose. Recomposing it on resume would be the quiet kind
    /// of wrong: the learner sees a question, answers it, and never learns
    /// that the one they were half-way through was replaced. So the options
    /// are compared as a list rather than as a set, and against the second
    /// question rather than the first, which is what makes this about the
    /// position as well as the composition.
    func testARelaunchResumesTheSameQuestionWithTheSameOptions() {
        // The guest identity is pinned: an unsigned build has no keychain
        // entitlement, so without it the relaunch would study as somebody else
        // and find no session at all.
        let identity = ["-installation-id", "6b1c40de-5f28-4a97-9d03-8e15c7a4b620"]
        let app = launch(arguments: ["-reset-store"] + identity + quizEnabled)
        openDeck(in: app)

        let quiz = app.buttons["study.mode.objective"]
        XCTAssertTrue(quiz.waitForExistence(timeout: 30), app.debugDescription)
        quiz.tap()
        app.buttons["study.start"].tap()

        let first = options(in: app)
        answerCurrentQuestion(in: app)

        // The second question is up, which means the first answer committed.
        let second = options(in: app)
        XCTAssertNotEqual(
            first,
            second,
            "The quiz moved on, so this must be a different question\n\(app.debugDescription)"
        )
        app.terminate()

        // Same store, same guest: the run is still open and Home leads with
        // the way back into it.
        let relaunched = launch(arguments: identity + quizEnabled)
        let resume = relaunched.buttons["home.continue"]
        XCTAssertTrue(resume.waitForExistence(timeout: 30), relaunched.debugDescription)
        resume.tap()

        let resumed = options(in: relaunched)
        XCTAssertEqual(
            resumed,
            second,
            "The resumed question must be the one that was on screen, with the "
                + "same distractors in the same order\n\(relaunched.debugDescription)"
        )
        XCTAssertNotEqual(
            resumed,
            first,
            "Resuming must not start the quiz over\n\(relaunched.debugDescription)"
        )
    }

    /// The four options as the screen offers them, in the order it offers
    /// them. Read as a list because the order is part of what a seed decides.
    private func options(in app: XCUIApplication) -> [String] {
        let first = app.buttons["study.option.0"]
        // Composing a question draws its distractors from the whole deck, so
        // this waits as long as a bootstrap does.
        XCTAssertTrue(first.waitForExistence(timeout: 30), app.debugDescription)
        return (0..<4).map { position in
            let option = app.buttons["study.option.\(position)"]
            XCTAssertTrue(option.exists, app.debugDescription)
            return option.label
        }
    }

    private func answerCurrentQuestion(in app: XCUIApplication) {
        app.buttons["study.option.0"].tap()
        let next = app.buttons["study.next"]
        XCTAssertTrue(next.waitForExistence(timeout: 10), app.debugDescription)
        next.tap()
    }

    private func openDeck(in app: XCUIApplication) {
        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        deck.tap()
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
