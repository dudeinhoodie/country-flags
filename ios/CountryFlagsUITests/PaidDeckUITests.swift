import XCTest

/// What a paid deck looks like to somebody who has not bought it, and to
/// somebody who has.
///
/// The Mock build sells one deck — `SPECIAL_AREAS` — through a backend that
/// refuses its cards until the account holds the entitlement, so both states
/// are reachable without a server and without a payment sheet. Elements are
/// addressed by accessibility identifier, so nothing here depends on the
/// language of the simulator.
@MainActor
final class PaidDeckUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// The lock is on the row, before anything is opened, and the row opens
    /// the paywall rather than a card list.
    func testALockedDeckShowsItsLockInTheCatalogAndOpensThePaywall() {
        let app = launch(arguments: ["-reset-store"])
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        app.tabBars.buttons["Catalog"].tap()

        let paidRow = app.buttons["catalog.deck.SPECIAL_AREAS"]
        XCTAssertTrue(paidRow.waitForExistence(timeout: 10), app.debugDescription)
        // The row is one accessibility element, so the badge and the price
        // are read as part of it rather than as elements of their own.
        let row = paidRow.label
        XCTAssertTrue(row.contains("Paid"), row)
        // Never a placeholder price: with no StoreKit configuration in this
        // run the store answers with no product, and the row says so.
        XCTAssertTrue(
            row.contains("Purchase temporarily unavailable") || row.contains("Price loading"),
            row
        )

        paidRow.tap()

        XCTAssertTrue(
            app.otherElements["deck.paywall"].waitForExistence(timeout: 10),
            app.debugDescription
        )
        XCTAssertTrue(app.buttons["deck.paid.restore"].exists, app.debugDescription)
        // The full card list is not shown before the deck is bought.
        XCTAssertFalse(app.buttons["study.start"].exists, app.debugDescription)
    }

    /// A free deck is untouched: no badge, no price, and the action it has
    /// always had.
    func testAFreeDeckIsUnchanged() {
        let app = launch(arguments: ["-reset-store"])
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        app.tabBars.buttons["Catalog"].tap()

        let freeRow = app.buttons["catalog.deck.EUROPE"]
        XCTAssertTrue(freeRow.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(freeRow.label.contains("Paid"), freeRow.label)
        freeRow.tap()

        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 10),
            app.debugDescription
        )
        XCTAssertFalse(app.otherElements["deck.paywall"].exists, app.debugDescription)
    }

    /// Owned is a deck: the commerce chrome is gone, the cards arrived, and
    /// the action is the one every other deck has.
    func testAnOwnedDeckShowsItsCardsAndNoCommerceChrome() {
        let app = launch(arguments: ["-reset-store", "-owned-deck"])
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        app.tabBars.buttons["Catalog"].tap()

        let deck = app.buttons["catalog.deck.SPECIAL_AREAS"]
        XCTAssertTrue(deck.waitForExistence(timeout: 10), app.debugDescription)
        // Bought, so the row is an ordinary row again.
        XCTAssertFalse(deck.label.contains("Paid"), deck.label)
        deck.tap()

        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 15),
            app.debugDescription
        )
        XCTAssertFalse(app.otherElements["deck.paywall"].exists, app.debugDescription)
        XCTAssertFalse(app.buttons["deck.paid.restore"].exists, app.debugDescription)
        XCTAssertFalse(app.staticTexts["deck.paid.price"].exists, app.debugDescription)
        // The list is the deck's own cards, each opening the existing sheet.
        XCTAssertTrue(
            app.staticTexts["deck.cardCount"].waitForExistence(timeout: 10),
            app.debugDescription
        )
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
