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
        app.buttons["study.start"].tap()

        let reveal = app.buttons["study.reveal"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
        reveal.tap()
        XCTAssertTrue(
            app.staticTexts["study.answer"].waitForExistence(timeout: 10),
            app.debugDescription
        )
        app.buttons["study.rating.GOOD"].tap()

        // Back to home, then into progress.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        openProgress(in: app)

        let counts = app.staticTexts["progress.deck.ALL.counts"]
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

        app.buttons["root.shell.openSettings"].tap()
        let size = app.buttons["settings.sessionSize.20"]
        XCTAssertTrue(size.waitForExistence(timeout: 15), app.debugDescription)
        size.tap()
        XCTAssertTrue(size.isSelected, app.debugDescription)
        app.terminate()

        let relaunched = launch(arguments: identity)
        relaunched.buttons["root.shell.openSettings"].tap()
        let restored = relaunched.buttons["settings.sessionSize.20"]
        XCTAssertTrue(restored.waitForExistence(timeout: 15), relaunched.debugDescription)
        XCTAssertTrue(restored.isSelected, relaunched.debugDescription)
    }

    private func openProgress(in app: XCUIApplication) {
        let progress = app.buttons["home.openProgress"]
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
