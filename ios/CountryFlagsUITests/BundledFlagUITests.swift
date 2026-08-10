import XCTest

/// What ADR-011 was for, end to end: the app draws the flags of the release it
/// ships without reaching for a single byte over the network.
///
/// The Mock build hosts no assets at all — `MockAssetFetcher` refuses every
/// download — so a flag on screen can only have come out of the app's own
/// asset catalog. That refusal is what gives this test its teeth: were the
/// bundled baseline to miss, the card would show the placeholder instead.
@MainActor
final class BundledFlagUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testAFreshInstallDrawsTheFlagsOfTheBundledRelease() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store"]
        app.launch()

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        deck.tap()

        // A study card is where a flag is the screen rather than a detail of a
        // row, which is the one place its identifier is its own element.
        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 10), app.debugDescription)
        start.tap()

        let flag = app.descendants(matching: .any)
            .matching(identifier: "content.flag.image")
            .firstMatch
        XCTAssertTrue(flag.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(
            app.descendants(matching: .any)
                .matching(identifier: "content.flag.placeholder")
                .firstMatch
                .exists,
            app.debugDescription
        )
    }
}
