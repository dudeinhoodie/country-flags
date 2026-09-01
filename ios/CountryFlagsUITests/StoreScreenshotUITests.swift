import XCTest

/// The App Store screenshots, taken by the app itself.
///
/// Screenshots are the one release artifact that is traditionally produced by
/// hand at the worst possible moment — the evening of submission, on whatever
/// simulator is open, in whatever language it happens to be in. This app is
/// unusually well placed to take its own: the mock backend answers with a
/// deterministic release, and the store can be reset per launch, so the same
/// run produces the same pictures.
///
/// It is not part of any test plan that gates a pull request: nothing here
/// asserts a product rule, and a screenshot run is minutes of tapping. It is
/// driven on purpose, by `ios/Scripts/capture-screenshots.sh`, which points it
/// at each device and language the store asks for.
///
/// The attachments are kept whether the run passes or fails — a failed run
/// with four good pictures is still four pictures.
final class StoreScreenshotUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testCaptureTheStoreScreenshots() {
        let app = XCUIApplication()
        // The same identity every time, so the numbers on the home screen and
        // the progress ring do not drift between runs and languages.
        app.launchArguments += [
            "-reset-store",
            "-installation-id", "5B0B7FF2-6C0F-4C6F-B8B8-9C5F2E1D0A11",
        ]
        app.launch()

        // 1. Home, once the day's number has arrived.
        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 60), app.debugDescription)
        capture(app, named: "01-home")

        // 2. The catalogue, which is the app at its most colourful.
        app.tabBars.buttons["Catalog"].tap()
        XCTAssertTrue(
            app.descendants(matching: .any).matching(identifier: "catalog.deck.EUROPE")
                .firstMatch.waitForExistence(timeout: 30),
            app.debugDescription
        )
        capture(app, named: "02-catalog")

        // 3. A card mid-session: the flag is the screen, which is the product.
        app.tabBars.buttons["Home"].tap()
        deck.tap()
        let start = app.buttons["study.start"]
        if start.waitForExistence(timeout: 30) {
            start.tap()
        }
        let reveal = app.buttons["study.reveal"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 60), app.debugDescription)
        capture(app, named: "03-session")

        // 4. The card's back, where the facts are.
        reveal.tap()
        XCTAssertTrue(
            app.staticTexts["study.answer"].waitForExistence(timeout: 10),
            app.debugDescription
        )
        capture(app, named: "04-answer")

        // 5. Progress: the world, lit by how much of it is known.
        app.tabBars.buttons["Progress"].tap()
        XCTAssertTrue(
            app.descendants(matching: .any).matching(identifier: "progress.deck.ALL.counts")
                .firstMatch.waitForExistence(timeout: 30),
            app.debugDescription
        )
        capture(app, named: "05-progress")
    }

    /// One picture, named so the export script can file it by device and
    /// language without opening it.
    private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
