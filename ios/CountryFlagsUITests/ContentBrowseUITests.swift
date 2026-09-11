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
        let homeDeck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(homeDeck.waitForExistence(timeout: 30), app.debugDescription)

        // The catalog lives on the tab bar now.
        app.tabBars.buttons["Catalog"].tap()

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
            first.buttons["home.deck.ALL"].waitForExistence(timeout: 30),
            first.debugDescription
        )
        first.terminate()

        // The same store, no reset, and every content request refused.
        let relaunched = launch(arguments: ["-offline-content"])

        let deck = relaunched.buttons["home.deck.ALL"]
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

    /// IOS-E2E-CO-04 and CO-05: searching narrows the catalog and gives it
    /// back.
    ///
    /// A filter that cannot be undone is a filter that ate the catalog. The
    /// interesting half is the return: a search with no matches has to say so
    /// rather than show an empty screen that reads as a load that failed, and
    /// clearing it has to restore the decks that were there all along.
    func testSearchingNarrowsTheCatalogAndClearingItGivesTheCatalogBack() {
        let app = launch(arguments: ["-reset-store"])

        let catalog = app.tabBars.buttons["Catalog"]
        XCTAssertTrue(catalog.waitForExistence(timeout: 60), app.debugDescription)
        let europe = app.buttons["catalog.deck.EUROPE"]
        // The shell is replaced as the launch settles, so a tap that lands in
        // that frame does nothing and is offered again.
        for _ in 0..<3 {
            catalog.tap()
            if europe.waitForExistence(timeout: 20) { break }
        }
        XCTAssertTrue(europe.waitForExistence(timeout: 20), app.debugDescription)
        let africa = app.buttons["catalog.deck.AFRICA"]
        XCTAssertTrue(africa.exists, app.debugDescription)

        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), app.debugDescription)
        field.tap()
        field.typeText("Euro")

        XCTAssertTrue(europe.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(
            africa.exists,
            "A search that matches one deck must not leave the others standing\n"
                + app.debugDescription
        )

        // Nothing at all: said in words rather than shown as an empty list.
        field.typeText("zzzzzz")
        XCTAssertTrue(
            app.staticTexts["catalog.noMatches"].waitForExistence(timeout: 15),
            "A search with no matches must say so\n\(app.debugDescription)"
        )

        // And the catalog comes back whole.
        let clear = app.buttons["Clear text"]
        if clear.waitForExistence(timeout: 5) {
            clear.tap()
        } else {
            field.buttons.firstMatch.tap()
        }
        XCTAssertTrue(europe.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(
            africa.waitForExistence(timeout: 15),
            "Clearing the search restores every deck it hid\n\(app.debugDescription)"
        )
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
