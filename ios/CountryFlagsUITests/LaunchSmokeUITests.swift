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
        app.launch()

        // Home is the root screen; the greeting is its localized headline.
        let greeting = app.staticTexts["home.greeting"]
        XCTAssertTrue(greeting.waitForExistence(timeout: 10))
        XCTAssertFalse(greeting.label.isEmpty)
        // A string catalog key must never reach the interface.
        XCTAssertNotEqual(greeting.label, "home.greeting")

        // The Mock build carries the environment badge; Prod must not.
        XCTAssertTrue(app.staticTexts["root.shell.environmentBadge"].exists)
    }

    func testTypedRouteOpensAndReturns() {
        let app = XCUIApplication()
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

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["home.greeting"].waitForExistence(timeout: 5))
    }
}
