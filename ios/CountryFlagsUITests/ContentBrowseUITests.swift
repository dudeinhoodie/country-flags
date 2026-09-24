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

    /// IOS-E2E-CO-06: the same search, one level down.
    ///
    /// A deck is a list of countries and the field above it filters that list.
    /// The copy is the deck's own — "No country here goes by that" rather than
    /// the catalog's — because a person searching inside Europe for a country
    /// that is not in it has made a different mistake from one who mistyped a
    /// deck name, and being told which is the whole value of saying anything.
    func testSearchingInsideADeckFiltersItsCountriesAndSaysWhenNothingMatches() {
        let app = launch(arguments: ["-reset-store"])

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 60), app.debugDescription)
        deck.tap()
        XCTAssertTrue(
            app.staticTexts["deck.cardCount"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        let rows = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "deck.country.")
        )
        XCTAssertGreaterThan(rows.count, 1, app.debugDescription)

        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), app.debugDescription)
        field.tap()
        field.typeText("Belg")

        // Narrowed, not emptied: a country that is in this deck is still
        // findable. The row count is not asserted on — the list renders
        // lazily, so what is on screen is never the size of the deck.
        XCTAssertTrue(
            rows.firstMatch.waitForExistence(timeout: 15),
            "A country that exists must still be findable\n\(app.debugDescription)"
        )
        XCTAssertFalse(
            app.staticTexts["deck.noMatches"].exists,
            "Something matched, so the deck must not claim nothing did\n"
                + app.debugDescription
        )

        field.typeText("zzzzzz")
        XCTAssertTrue(
            app.staticTexts["deck.noMatches"].waitForExistence(timeout: 15),
            "A deck search with no matches must say so in the deck's own words\n"
                + app.debugDescription
        )
    }

    /// IOS-E2E-CO-07: a country opens, and what it shows is the release's.
    ///
    /// The list is a door. Behind it are the facts this release published and
    /// a map that opens and closes again — the closing matters, because a
    /// sheet that traps somebody on a map is a dead end in a screen whose
    /// whole job is browsing.
    func testACountryOpensFromTheDeckListAndItsMapCanBeClosed() {
        let app = launch(arguments: ["-reset-store"])

        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 60), app.debugDescription)
        deck.tap()
        XCTAssertTrue(
            app.staticTexts["deck.cardCount"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        // Addressed by what the row is — a country — rather than by which one:
        // the release decides the order, and this test is not about that.
        let country = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "deck.country.")
        ).firstMatch
        XCTAssertTrue(country.waitForExistence(timeout: 30), app.debugDescription)
        country.tap()

        XCTAssertTrue(
            app.descendants(matching: .any)["details.facts"].waitForExistence(timeout: 20),
            "Opening a country shows what the release says about it\n"
                + app.debugDescription
        )

        let map = app.descendants(matching: .any)["study.details.map"]
        XCTAssertTrue(map.waitForExistence(timeout: 15), app.debugDescription)
        map.tap()

        // Back out of the map and then out of the country: neither is a place
        // the browser can be stranded in.
        app.swipeDown()
        XCTAssertTrue(
            app.descendants(matching: .any)["details.facts"].waitForExistence(timeout: 15),
            "Closing the map returns to the country rather than dismissing it\n"
                + app.debugDescription
        )
        app.swipeDown()
        XCTAssertTrue(
            app.staticTexts["deck.cardCount"].waitForExistence(timeout: 15),
            "Closing the country returns to the deck it was opened from\n"
                + app.debugDescription
        )
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
