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
        // account now.
        XCTAssertTrue(
            app.staticTexts["root.shell.environmentBadge"].waitForExistence(timeout: 10),
            app.debugDescription
        )

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["home.deck.ALL"].waitForExistence(timeout: 5))
    }
}
