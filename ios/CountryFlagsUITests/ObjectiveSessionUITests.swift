import XCTest

/// The quiz mode end to end: it appears only when its flag is on, four options
/// are offered, the answer is fixed once chosen, and the result is reached.
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
