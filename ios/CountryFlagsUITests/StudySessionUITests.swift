import XCTest

/// The guest study flow end to end: start a session from a deck, answer every
/// card, see the result, and resume in the middle after a relaunch.
@MainActor
final class StudySessionUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testAGuestAnswersEveryCardAndSeesTheResult() {
        let app = launch(arguments: ["-reset-store"])
        openDeck(in: app)

        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 10), app.debugDescription)
        start.tap()

        // Answer until the session ends. The count is not hard-coded: the mock
        // release decides how many cards a deck has, and a test that pinned it
        // would break every time the mock gains a country.
        let result = app.staticTexts["study.result.title"]
        var answered = 0
        while !result.exists && answered < 30 {
            let reveal = app.buttons["study.reveal"]
            // The deck is the published release, so selecting a session is real
            // work; this waits as long as a bootstrap does.
            XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
            // The answer must not be on screen before the flip.
            XCTAssertFalse(app.staticTexts["study.answer"].exists)
            reveal.tap()

            XCTAssertTrue(
                app.staticTexts["study.answer"].waitForExistence(timeout: 5),
                app.debugDescription
            )
            app.buttons["study.rating.GOOD"].tap()
            answered += 1
        }

        XCTAssertGreaterThan(answered, 0)
        XCTAssertTrue(result.waitForExistence(timeout: 10), app.debugDescription)
        let score = app.staticTexts["study.result.answered"]
        XCTAssertTrue(score.exists)
        XCTAssertFalse(score.label.isEmpty)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(score.label.contains("study.result"))
    }

    /// The durability requirement: an answer that was saved survives a
    /// relaunch, and the session continues where it stopped rather than
    /// starting over.
    func testARelaunchResumesTheSessionInPlace() {
        // The guest identity is pinned for this test. An unsigned build has no
        // keychain entitlement, so the installation identifier the scope is
        // built from would not survive the relaunch, and every launch would
        // study as a different guest.
        let identity = ["-installation-id", "11111111-2222-4333-8444-555555555555"]
        let app = launch(arguments: ["-reset-store"] + identity)
        openDeck(in: app)
        app.buttons["study.start"].tap()

        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 10))
        let firstPosition = app.staticTexts["study.progress"].label
        app.buttons["study.reveal"].tap()
        app.buttons["study.rating.GOOD"].tap()

        // The second card is up, which means the first answer committed.
        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 10))
        let secondPosition = app.staticTexts["study.progress"].label
        XCTAssertNotEqual(firstPosition, secondPosition)
        app.terminate()

        // The same store and the same guest, so the session is still open.
        let relaunched = launch(arguments: identity)
        openDeck(in: relaunched)
        relaunched.buttons["study.start"].tap()

        XCTAssertTrue(relaunched.buttons["study.reveal"].waitForExistence(timeout: 15))
        XCTAssertEqual(
            relaunched.staticTexts["study.progress"].label,
            secondPosition,
            relaunched.debugDescription
        )
    }

    /// The gesture the deck exists for: a card that has been turned over is
    /// answered by throwing it, and the session moves on. The buttons are
    /// tested above; this is the path a hand actually takes.
    func testARevealedCardIsAnsweredBySwipingIt() {
        let app = launch(arguments: ["-reset-store"])
        openDeck(in: app)
        app.buttons["study.start"].tap()

        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 30), app.debugDescription)
        let firstPosition = app.staticTexts["study.progress"].label

        let card = app.otherElements["study.card"]
        XCTAssertTrue(card.waitForExistence(timeout: 10), app.debugDescription)
        // Answering without turning the card over is the case the deck exists
        // for: a flag recognised on sight is thrown away, not read.
        card.swipeRight()

        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertNotEqual(
            app.staticTexts["study.progress"].label,
            firstPosition,
            app.debugDescription
        )
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
