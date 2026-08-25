import XCTest

/// The two screens that were placeholders until this work package: what a
/// learner has done, and what they can change about how they do it.
@MainActor
final class ProgressSettingsUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// A fresh install has studied nothing, and saying so is a different screen
    /// from a column of zeroes — which would read as a load that failed.
    func testAFreshInstallExplainsThatNothingHasBeenStudied() {
        let app = launch(arguments: ["-reset-store"])

        // Opened while the launch is still importing content and running its
        // first sync, deliberately: that is when a screen that does not own
        // its store keeps starting its reading over.
        openProgress(in: app)

        XCTAssertTrue(
            app.staticTexts["progress.empty"].waitForExistence(timeout: 15),
            app.debugDescription
        )
    }

    /// The point of the screen: work done on the device shows up on it, with no
    /// account and no network behind it.
    func testAnAnsweredCardIsCountedOnTheProgressScreen() {
        let app = launch(arguments: ["-reset-store"])

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
        reveal.tap()
        XCTAssertTrue(
            app.staticTexts["study.answer"].waitForExistence(timeout: 10),
            app.debugDescription
        )
        app.descendants(matching: .any).matching(identifier: "study.card")
            .firstMatch.swipeRight()

        // Back to home, then into progress. The session screen has no
        // navigation bar any more — the flag is the screen — so leaving it is
        // the close control rather than a back button.
        app.buttons["study.close"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        openProgress(in: app)

        // Matched by identifier across every element type: the counts are a
        // combined element now, and how SwiftUI classifies it is its
        // business, not a promise the product makes.
        let counts = app.descendants(matching: .any)
            .matching(identifier: "progress.deck.ALL.counts")
            .firstMatch
        XCTAssertTrue(counts.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(counts.label.isEmpty)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(counts.label.contains("progress.deck_counts"))
        XCTAssertFalse(app.staticTexts["progress.empty"].exists, app.debugDescription)
    }

    /// A setting is stored on the device, so it is still there after a relaunch
    /// — which is the whole reason it is written before it is ever sent.
    func testASessionSizeSurvivesARelaunch() {
        // The guest identity is pinned: an unsigned build has no keychain
        // entitlement, so without this every launch would be a new guest and
        // the setting would be read from a different account.
        let identity = ["-installation-id", "22222222-3333-4444-8555-666666666666"]
        let app = launch(arguments: ["-reset-store"] + identity)

        openSettings(in: app)
        let size = app.buttons["settings.sessionSize.20"]
        XCTAssertTrue(size.waitForExistence(timeout: 15), app.debugDescription)
        size.tap()
        XCTAssertTrue(size.isSelected, app.debugDescription)
        // The choice is stored by a task the tap starts, and terminating the
        // app the instant it is made would race that write. Leaving the screen
        // the way a person would is what gives it time.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 30),
            app.debugDescription
        )
        app.terminate()

        let relaunched = launch(arguments: identity)
        openSettings(in: relaunched)
        let restored = relaunched.buttons["settings.sessionSize.20"]
        XCTAssertTrue(restored.waitForExistence(timeout: 15), relaunched.debugDescription)
        XCTAssertTrue(restored.isSelected, relaunched.debugDescription)
    }

    /// The toolbar is drawn with the first screen rather than before it, so a
    /// launch on a loaded machine has to be waited for rather than tapped
    /// through.
    private func openSettings(in app: XCUIApplication) {
        let settings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), app.debugDescription)
        settings.tap()
    }

    private func openProgress(in app: XCUIApplication) {
        // Progress lives on the tab bar now.
        let progress = app.tabBars.buttons["Progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 30), app.debugDescription)
        progress.tap()
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
