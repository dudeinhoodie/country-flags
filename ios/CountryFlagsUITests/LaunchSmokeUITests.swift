import XCTest

/// Launch smoke: the app starts, shows the localized home screen and can follow
/// a typed route. The test addresses elements by accessibility identifier, so it
/// does not depend on the simulator language.
///
/// The class is `@MainActor` because XCUITest API is main-actor isolated under
/// the Swift 6 language mode.
@MainActor
final class LaunchSmokeUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testLaunchShowsLocalizedShell() {
        let app = XCUIApplication()
        // A fresh store, like every other suite: the deck pane this test
        // anchors on is only rendered when nothing is due and no session is
        // open, and leftover state from an earlier run must not decide that.
        app.launchArguments += ["-reset-store"]
        app.launch()

        // Home is the root screen; the hero deck pane is its localized entry.
        let hero = app.buttons["home.deck.ALL"]
        XCTAssertTrue(hero.waitForExistence(timeout: 10))
        XCTAssertFalse(hero.label.isEmpty)
        // A string catalog key must never reach the interface. The button's
        // label is its action title, so a broken catalog would surface the
        // raw "study." key there — never the identifier string.
        XCTAssertFalse(hero.label.contains("study."), app.debugDescription)
    }

    /// The claim of #301, demonstrated rather than argued: an install that has
    /// never reached a backend opens on a catalogue it can study.
    ///
    /// Nothing in the store and every content request refused — a fresh phone
    /// on a plane, and what a reviewer sees when the host is not answering.
    /// Before the app carried a catalogue this ran out the request timeout on
    /// a blocking screen and landed on "you are offline" over three empty
    /// tabs, which is the guideline 2.1 reading of an app that does not work.
    func testAFirstLaunchWithNoBackendOpensOnTheBundledCatalog() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store", "-offline-content"]
        app.launch()

        let hero = app.buttons["home.deck.ALL"]
        XCTAssertTrue(hero.waitForExistence(timeout: 60), app.debugDescription)
        // Neither of the two screens this replaces: the blocking wait and the
        // empty state behind it.
        XCTAssertFalse(
            app.descendants(matching: .any)
                .matching(identifier: "root.launchWait").firstMatch.exists,
            app.debugDescription
        )
        XCTAssertFalse(
            app.staticTexts["content.placeholder.title"].exists,
            app.debugDescription
        )
        // And it says what it is rather than pretending to be up to date: a
        // catalogue on the device with no connection behind it.
        XCTAssertTrue(
            app.staticTexts["content.statusBanner"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        // A catalogue that can be opened and studied, not a list of names: the
        // deck reports the cards it holds and offers to start.
        hero.tap()
        let cardCount = app.staticTexts["deck.cardCount"]
        XCTAssertTrue(cardCount.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(cardCount.label.isEmpty)
        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 20),
            app.debugDescription
        )
    }

    func testTypedRouteOpensAndReturns() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store"]
        app.launch()

        let openSettings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(openSettings.waitForExistence(timeout: 10))
        openSettings.tap()

        // Settings is a real screen, so the route is proved by a control the
        // screen owns rather than by a placeholder title.
        // The hierarchy is attached to the failure: this suite is verified
        // on CI as well, where the xcresult bundle is the only artifact.
        let reminders = app.switches["settings.reminders"]
        XCTAssertTrue(reminders.waitForExistence(timeout: 10), app.debugDescription)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(reminders.label.contains("settings."), app.debugDescription)

        // The Mock build says which build it is; Prod must not. It says it
        // here rather than on the first screen, whose corner belongs to the
        // account now — at the foot of the form, under the About row. A list
        // materialises only the rows on screen, so the form is scrolled to
        // its end before the badge is asked for; on a phone it starts below
        // the fold.
        let badge = app.staticTexts["root.shell.environmentBadge"]
        for _ in 0..<4 where !badge.exists {
            app.swipeUp()
        }
        XCTAssertTrue(badge.waitForExistence(timeout: 10), app.debugDescription)

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["home.deck.ALL"].waitForExistence(timeout: 5))
    }
}
