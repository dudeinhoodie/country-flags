import XCTest

/// The content vertical slice end to end: a fresh install bootstraps, the
/// catalog and a deck are reachable, and a relaunch with no backend still shows
/// what was downloaded.
///
/// Elements are addressed by accessibility identifier, so the test does not
/// depend on the language of the simulator.
@MainActor
final class ContentBrowseUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testBootstrapReachesTheCatalogAndADeck() {
        let app = launch(arguments: ["-reset-store"])

        // Home draws the recommended decks once the bootstrap has applied.
        let homeDeck = app.buttons["home.deck.ALL_COUNTRIES"]
        XCTAssertTrue(homeDeck.waitForExistence(timeout: 30), app.debugDescription)

        app.buttons["home.openCatalog"].tap()

        let catalogDeck = app.buttons["catalog.deck.EUROPE"]
        XCTAssertTrue(catalogDeck.waitForExistence(timeout: 10), app.debugDescription)
        catalogDeck.tap()

        // The deck screen reports its size, which only the stored cards can
        // supply.
        let cardCount = app.staticTexts["deck.cardCount"]
        XCTAssertTrue(cardCount.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(cardCount.label.isEmpty)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(cardCount.label.contains("deck.card_count"))
    }

    /// The offline requirement: everything downloaded stays browsable when the
    /// backend cannot be reached, and the state is explained rather than
    /// blocking navigation.
    func testARelaunchWithNoBackendStillBrowsesTheStoredCatalog() {
        let first = launch(arguments: ["-reset-store"])
        XCTAssertTrue(
            first.buttons["home.deck.ALL_COUNTRIES"].waitForExistence(timeout: 30),
            first.debugDescription
        )
        first.terminate()

        // The same store, no reset, and every content request refused.
        let relaunched = launch(arguments: ["-offline-content"])

        let deck = relaunched.buttons["home.deck.ALL_COUNTRIES"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), relaunched.debugDescription)
        XCTAssertTrue(
            relaunched.staticTexts["content.statusBanner"].waitForExistence(timeout: 10),
            relaunched.debugDescription
        )

        // Navigation still works off the cache.
        deck.tap()
        XCTAssertTrue(
            relaunched.staticTexts["deck.cardCount"].waitForExistence(timeout: 10),
            relaunched.debugDescription
        )
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
