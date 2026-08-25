import XCTest

/// The app under the settings a person may actually be using.
///
/// None of these check that the app is *pretty* at accessibility sizes — a
/// test cannot see. They check the thing that actually breaks: that the
/// controls a learner needs are still there, still reachable and still
/// labelled in words, when the text is three times its usual size, when the
/// animation is switched off, or when the interface is in the other language.
/// Every one of these has broken a screen in this app at least once.
@MainActor
final class AccessibilityUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// The largest accessibility size iOS offers. At this size a row that lays
    /// its label beside its value stops fitting, and a hero pane that pins its
    /// height clips the number it exists to show.
    func testTheFirstScreenSurvivesTheLargestText() {
        let app = launch(contentSize: "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge")

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(deck.isHittable, "the action is off the screen at AX5: \(app.debugDescription)")
        XCTAssertFalse(deck.label.isEmpty, "a control with no label is unusable by VoiceOver")

        // Settings is the densest screen in the app: rows with a label, a
        // control and a footnote each.
        let settings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(settings.isHittable, app.debugDescription)
        settings.tap()

        let reminders = app.switches["settings.reminders"]
        XCTAssertTrue(reminders.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(reminders.isHittable, "the switch cannot be reached at AX5")
        // Three sizes of text can push a segmented control's options out of
        // their track; the chosen one still has to be selectable.
        let size = app.buttons["settings.sessionSize.20"]
        XCTAssertTrue(size.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(size.isHittable, app.debugDescription)
    }

    /// A session is the screen a learner spends their time on, and the one
    /// with the most moving parts. It has to work with the motion switched off
    /// — the card still turns over, the rating buttons still answer.
    func testASessionIsAnswerableWithReducedMotion() {
        let app = launch(arguments: ["-reset-store", "-UIAccessibilityReduceMotionEnabled", "1"])

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        deck.tap()

        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 20), app.debugDescription)
        start.tap()

        let reveal = app.buttons["study.reveal"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 20), app.debugDescription)
        reveal.tap()

        // The swipe is what commits an answer: the rating bar left the
        // screen, so throwing the revealed card right is the whole gesture a
        // person makes. VoiceOver reaches the same four ratings as custom
        // actions on the card, which XCUITest cannot invoke — the arrival of
        // the next card is what proves the commit went through.
        let card = app.descendants(matching: .any)
            .matching(identifier: "study.card")
            .firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10), app.debugDescription)
        card.swipeRight()

        XCTAssertTrue(
            app.buttons["study.reveal"].waitForExistence(timeout: 15),
            "the next card did not arrive: \(app.debugDescription)"
        )
    }

    /// Russian is longer than English almost everywhere, and it is the default
    /// language of this app. A label that fits in English and truncates in
    /// Russian is a label nobody can read, so the strings are checked in the
    /// language most of them were written in.
    func testTheInterfaceIsWholeInRussian() {
        let app = launch(arguments: ["-reset-store", "-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"])

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        // A string catalog key that reached the interface is the failure this
        // catches: it looks like a label until you read it.
        XCTAssertFalse(deck.label.contains("study."), app.debugDescription)
        XCTAssertFalse(deck.label.contains("home."), app.debugDescription)
        XCTAssertTrue(deck.isHittable, app.debugDescription)

        let settings = app.buttons["root.shell.openSettings"]
        settings.tap()
        let reminders = app.switches["settings.reminders"]
        XCTAssertTrue(reminders.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(reminders.label.contains("settings."), app.debugDescription)
        XCTAssertFalse(reminders.label.isEmpty, app.debugDescription)
    }

    /// The app draws its own dark scene rather than following the system, so
    /// what is being checked here is that a device set to light does not end
    /// up with light text on the app's dark ground — the controls still have
    /// to be found and read.
    func testTheAppIsUsableWithTheSystemInLightAppearance() {
        let app = launch(arguments: ["-reset-store", "-AppleInterfaceStyle", "Light"])

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(deck.isHittable, app.debugDescription)
        XCTAssertTrue(
            app.buttons["root.shell.openSettings"].isHittable,
            app.debugDescription
        )
    }

    // MARK: - Helpers

    private func launch(
        contentSize: String? = nil,
        arguments: [String] = ["-reset-store"]
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        if let contentSize {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", contentSize]
        }
        app.launch()
        return app
    }
}
