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

    /// Home counts the countries met and learned, and the count is the way to
    /// the screen it summarises (#497).
    ///
    /// Two answers and no more: the block is there from the first started
    /// card, long before anything can be learned — which is why it replaced
    /// the deck pane's "0 / 195", a figure that could not move on the first
    /// day. The sitting is left open, so the block stands under the resume
    /// pane rather than the deck pane; it follows whichever hero the day has.
    func testTheKnownCountriesOnHomeOpenTheProgressTab() {
        let app = launch(arguments: ["-reset-store"])

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        deck.tap()
        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 30), app.debugDescription)
        start.tap()

        for _ in 0..<2 {
            let reveal = app.buttons["study.reveal"]
            XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
            reveal.tap()
            XCTAssertTrue(
                app.staticTexts["study.answer"].waitForExistence(timeout: 10),
                app.debugDescription
            )
            app.descendants(matching: .any).matching(identifier: "study.card")
                .firstMatch.swipeRight()
        }

        app.buttons["study.close"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // Waited for by its count as well as by its identifier: the screen
        // re-reads the numbers on the way back from a sitting, and a block
        // that is there with the previous word is not yet the one to check.
        // Both languages lead with the number, so the check reads no copy.
        let block = app.descendants(matching: .any).matching(
            NSPredicate(
                format: "identifier == %@ AND label BEGINSWITH %@",
                "home.knownLearned",
                "2 "
            )
        ).firstMatch
        XCTAssertTrue(block.waitForExistence(timeout: 30), app.debugDescription)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(block.label.contains("home.known_learned"), app.debugDescription)

        block.tap()

        let progressTab = app.tabBars.buttons["Progress"]
        XCTAssertTrue(progressTab.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(progressTab.isSelected, app.debugDescription)
        // And the screen behind the tab is the one with the counts, not an
        // empty state: the two answers are what the block was counting.
        let counts = app.descendants(matching: .any)
            .matching(identifier: "progress.deck.ALL.counts")
            .firstMatch
        XCTAssertTrue(counts.waitForExistence(timeout: 15), app.debugDescription)
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

    /// IOS-E2E-SE: the feedback switch is the learner's, and it stays off.
    ///
    /// Haptics is the setting somebody changes because the app is bothering
    /// them — on a bus, in a lecture, next to a sleeping child. A preference
    /// that quietly comes back on after a relaunch is not a setting, it is a
    /// suggestion, and it is the kind of thing a person only notices when it is
    /// already too late. There is no sound switch beside it: the app plays no
    /// sound, and the row went with #418.
    func testHapticsStayOffAcrossARelaunch() {
        let identity = ["-installation-id", "9a4f0e73-25bd-4c18-8e56-3f01b7d29c48"]
        let app = launch(arguments: ["-reset-store"] + identity)

        openSettings(in: app)
        let haptics = app.switches["settings.haptics"]
        XCTAssertTrue(haptics.waitForExistence(timeout: 30), app.debugDescription)
        haptics.tap()
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
        let restoredHaptics = relaunched.switches["settings.haptics"]
        XCTAssertTrue(restoredHaptics.waitForExistence(timeout: 30), relaunched.debugDescription)
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
    /// Opens Settings, offering the tap again if the first one is swallowed.
    ///
    /// This is the first tap after a cold launch, which is exactly where the
    /// launch wait costs one: it is a screen rather than an overlay, so the
    /// shell is built only after it and the first interactive frame replaces
    /// the hierarchy. Arrival is read off the session-size picker, which is on
    /// this screen in every state it has.
    private func openSettings(in app: XCUIApplication) {
        let settings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 60), app.debugDescription)
        let sizes = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "settings.sessionSize.")
        ).firstMatch
        for _ in 0..<3 {
            settings.tap()
            if sizes.waitForExistence(timeout: 15) { return }
        }
        XCTFail("The settings screen never opened\n\(app.debugDescription)")
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
