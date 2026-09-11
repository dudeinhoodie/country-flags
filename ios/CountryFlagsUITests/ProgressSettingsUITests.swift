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

    /// IOS-E2E-SE: the feedback switches are the learner's, and they stay off.
    ///
    /// Sound and haptics are the two settings somebody changes because the app
    /// is bothering them — on a bus, in a lecture, next to a sleeping child.
    /// A preference that quietly comes back on after a relaunch is not a
    /// setting, it is a suggestion, and it is the kind of thing a person only
    /// notices when it is already too late.
    func testSoundAndHapticsStayOffAcrossARelaunch() {
        let identity = ["-installation-id", "9a4f0e73-25bd-4c18-8e56-3f01b7d29c48"]
        let app = launch(arguments: ["-reset-store"] + identity)

        openSettings(in: app)
        let sound = app.switches["settings.sound"]
        let haptics = app.switches["settings.haptics"]
        XCTAssertTrue(sound.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(haptics.waitForExistence(timeout: 15), app.debugDescription)
        sound.tap()
        haptics.tap()
        let soundOff = sound.value as? String
        let hapticsOff = haptics.value as? String

        // Left the way a person leaves it: the write is started by the tap and
        // finishes while the screen is being dismissed.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(
            app.buttons["root.shell.openSettings"].waitForExistence(timeout: 30),
            app.debugDescription
        )
        app.terminate()

        let relaunched = launch(arguments: identity)
        openSettings(in: relaunched)
        let restoredSound = relaunched.switches["settings.sound"]
        let restoredHaptics = relaunched.switches["settings.haptics"]
        XCTAssertTrue(restoredSound.waitForExistence(timeout: 30), relaunched.debugDescription)
        XCTAssertEqual(
            restoredSound.value as? String,
            soundOff,
            "A silenced app must still be silent after a relaunch\n"
                + relaunched.debugDescription
        )
        XCTAssertEqual(
            restoredHaptics.value as? String,
            hapticsOff,
            "Haptics turned off must stay off\n\(relaunched.debugDescription)"
        )
    }

    /// IOS-E2E-SE: consent is a decision, not a default.
    ///
    /// Product analytics and diagnostics are the two switches with a legal
    /// weight behind them: a consent that resets is a consent that was never
    /// taken. This is deliberately checked after the process ends, because
    /// that is where a preference held only in memory would be lost.
    func testPrivacyConsentSurvivesARelaunch() {
        let identity = ["-installation-id", "c3810b9f-46da-4d27-9051-8e7a2c4f6b15"]
        let app = launch(arguments: ["-reset-store"] + identity)

        openSettings(in: app)
        let analytics = app.switches["settings.privacy.productAnalytics"]
        XCTAssertTrue(analytics.waitForExistence(timeout: 30), app.debugDescription)
        analytics.tap()
        let chosen = analytics.value as? String

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(
            app.buttons["root.shell.openSettings"].waitForExistence(timeout: 30),
            app.debugDescription
        )
        app.terminate()

        let relaunched = launch(arguments: identity)
        openSettings(in: relaunched)
        let restored = relaunched.switches["settings.privacy.productAnalytics"]
        XCTAssertTrue(restored.waitForExistence(timeout: 30), relaunched.debugDescription)
        XCTAssertEqual(
            restored.value as? String,
            chosen,
            "A consent decision must outlive the process that took it\n"
                + relaunched.debugDescription
        )
    }

    /// The toolbar is drawn with the first screen rather than before it, so a
    /// launch on a loaded machine has to be waited for rather than tapped
    /// through."""
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
