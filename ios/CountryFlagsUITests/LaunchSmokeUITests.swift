import XCTest

/// Launch smoke: приложение стартует, показывает локализованную оболочку и
/// умеет уйти по типизированному маршруту. Тест опирается на accessibility
/// identifier, поэтому не зависит от языка симулятора.
final class LaunchSmokeUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testLaunchShowsLocalizedShell() {
        let app = XCUIApplication()
        app.launch()

        let title = app.staticTexts["root.shell.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertFalse(title.label.isEmpty)
        // Ключ каталога строк не должен просочиться в интерфейс.
        XCTAssertNotEqual(title.label, "shell.title")

        // Mock-сборка помечена бейджем окружения; в Prod его быть не должно.
        XCTAssertTrue(app.staticTexts["root.shell.environmentBadge"].exists)
    }

    func testTypedRouteOpensAndReturns() {
        let app = XCUIApplication()
        app.launch()

        let openSettings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(openSettings.waitForExistence(timeout: 10))
        openSettings.tap()

        let routeScreen = app.otherElements["root.route.screen"]
        XCTAssertTrue(routeScreen.waitForExistence(timeout: 5))

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["root.shell.title"].waitForExistence(timeout: 5))
    }
}
