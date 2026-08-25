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
        let capital = app.staticTexts["study.fact.CAPITAL"]

        // Almost every card of this release names a capital — a handful of
        // territories legitimately do not, and the session is free to lead
        // with one of them. The test walks the deck until a capital appears
        // instead of demanding one from whichever card came first, which was
        // a coin this test should not be flipping.
        var isCapitalShown = false
        for _ in 0..<5 where !isCapitalShown {
            XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
            // Nothing about the country before the flip: a capital would
            // answer the question the card is asking.
            XCTAssertFalse(capital.exists, app.debugDescription)
            reveal.tap()

            XCTAssertTrue(
                app.staticTexts["study.answer"].waitForExistence(timeout: 10),
                app.debugDescription
            )
            // The facts are read from the store once the card is over; a beat
            // of latency is theirs to take.
            isCapitalShown = capital.waitForExistence(timeout: 3)
            if !isCapitalShown {
                app.descendants(matching: .any).matching(identifier: "study.card")
                    .firstMatch.swipeRight()
            }
        }

        XCTAssertTrue(isCapitalShown, app.debugDescription)
        XCTAssertFalse(capital.label.isEmpty)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(capital.label.contains("fact.capital"), app.debugDescription)
    }
}
