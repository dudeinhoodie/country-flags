import XCTest

/// Settings and the account are reachable from wherever the learner stands.
///
/// They used to hang off the Home screen alone, so changing a setting from
/// the catalog or the progress meant going back to Home first — a trip
/// through an unrelated screen to reach a control that belongs to no screen
/// in particular (#273).
@MainActor
final class TabToolbarUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testSettingsOpenFromEveryTab() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store"]
        app.launch()
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        for tab in ["Catalog", "Progress", "Home"] {
            app.tabBars.buttons[tab].tap()

            let settings = app.buttons["root.shell.openSettings"]
            XCTAssertTrue(
                settings.waitForExistence(timeout: 10),
                "no way to settings from \(tab): \(app.debugDescription)"
            )
            settings.tap()

            // A control the screen owns, rather than a title: the route is
            // proved by arriving, not by a label.
            XCTAssertTrue(
                app.switches["settings.reminders"].waitForExistence(timeout: 10),
                "settings did not open from \(tab): \(app.debugDescription)"
            )

            // Back onto the tab it was opened from — each tab keeps its own
            // stack, so settings pushed from the catalog must return there.
            app.navigationBars.buttons.element(boundBy: 0).tap()
            XCTAssertTrue(
                app.tabBars.buttons[tab].waitForExistence(timeout: 10),
                app.debugDescription
            )
        }
    }

    /// The avatar rides with the gear. It is the way to the account, and an
    /// account reachable from one tab out of three is reachable by accident.
    func testTheAccountOpensFromEveryTab() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store"]
        app.launch()
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        for tab in ["Catalog", "Progress", "Home"] {
            app.tabBars.buttons[tab].tap()

            let account = app.buttons["account.open"]
            XCTAssertTrue(
                account.waitForExistence(timeout: 10),
                "no way to the account from \(tab): \(app.debugDescription)"
            )
            XCTAssertTrue(account.isHittable, app.debugDescription)
        }
    }
}
