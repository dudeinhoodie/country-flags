import XCTest

/// Turning a card over says something about the country, not just its name.
///
/// The Mock build serves a published release and hosts nothing, so whatever
/// appears here came out of the local store — which is the point: the back of
/// a card reads the same in a tunnel as it does on wifi.
@MainActor
final class CardBackFactsUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testRevealingACardShowsWhatTheReleaseSaysAboutTheCountry() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store"]
        app.launch()

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        deck.tap()
        // The deck screen has to draw before its button can be pressed, and
        // drawing it means reading the release.
        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 30), app.debugDescription)
        start.tap()

        let reveal = app.buttons["study.reveal"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
        // Nothing about the country before the flip: a capital would answer the
        // question the card is asking.
        XCTAssertFalse(app.staticTexts["study.fact.CAPITAL"].exists, app.debugDescription)
        reveal.tap()

        // Every card of this release names a capital, so the flip has to
        // produce one whichever card the session chose.
        let capital = app.staticTexts["study.fact.CAPITAL"]
        XCTAssertTrue(capital.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(capital.label.isEmpty)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(capital.label.contains("fact.capital"), app.debugDescription)
    }
}
