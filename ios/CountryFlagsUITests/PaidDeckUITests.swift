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
    /// The fixture sign-in, which is the only way a test can get past a
    /// provider sheet. Debug builds only, and only because the launch asks.
    private let fixtures = ["-fake-signin"]
    /// An unsigned build has no keychain entitlement, so a pinned identity is
    /// what keeps one guest across a relaunch.
    private let identity = ["-installation-id", "44444444-5555-4666-8777-888888888888"]
    /// `commerce.paid_decks.discovery.enabled`, which is off by default and is
    /// what puts a deck nobody here has bought in the catalogue at all. It is
    /// stated only where a locked deck has to be visible; the owned test below
    /// deliberately runs without it.
    private let discovery = ["-feature-flag", "commerce.paid_decks.discovery.enabled=true"]

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// The lock is on the row, before anything is opened, and the row opens
    /// the paywall rather than a card list.
    func testALockedDeckShowsItsLockInTheCatalogAndOpensThePaywall() {
        let app = launch(arguments: ["-reset-store"] + discovery)
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

        // The identifier sits on the screen's scroll view, so the query names
        // no element type: what matters is that the paywall is what opened.
        XCTAssertTrue(paywall(in: app).waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(
            app.buttons["deck.paid.restore"].waitForExistence(timeout: 5),
            app.debugDescription
        )
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
        XCTAssertFalse(paywall(in: app).exists, app.debugDescription)
    }

    /// Owned is a deck: the commerce chrome is gone, the cards arrived, and
    /// the action is the one every other deck has.
    ///
    /// It signs in first, and that is not a convenience. A purchase needs an
    /// account to be granted to, so a guest holds no entitlement however much
    /// the store has been asked — which is exactly what the locked test above
    /// shows. Owning anything starts with an account.
    ///
    /// It also runs with `commerce.paid_decks.discovery.enabled` at its
    /// default of false, which is the rule PD-21 names: a storefront switched
    /// off hides what is for sale and never what somebody already holds.
    func testAnOwnedDeckShowsItsCardsAndNoCommerceChrome() {
        let app = launch(arguments: ["-reset-store", "-owned-deck"] + fixtures + identity)
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 30),
            app.debugDescription
        )
        signIn(in: app)

        app.tabBars.buttons["Home"].tap()
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
        XCTAssertFalse(paywall(in: app).exists, app.debugDescription)
        XCTAssertFalse(app.buttons["deck.paid.restore"].exists, app.debugDescription)
        XCTAssertFalse(app.staticTexts["deck.paid.price"].exists, app.debugDescription)
        // The list is the deck's own cards, each opening the existing sheet.
        XCTAssertTrue(
            app.staticTexts["deck.cardCount"].waitForExistence(timeout: 10),
            app.debugDescription
        )
    }

    private func paywall(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "deck.paywall").firstMatch
    }

    /// Signs in through the fixture and comes back out of the account screen.
    private func signIn(in app: XCUIApplication) {
        let account = app.buttons["account.open"]
        XCTAssertTrue(account.waitForExistence(timeout: 30), app.debugDescription)
        account.tap()

        let signedIn = app.descendants(matching: .any)
            .matching(identifier: "settings.account.signedIn")
            .firstMatch
        // A session lives in the keychain, which outlives the store the launch
        // resets, so a device that signed in for an earlier test arrives here
        // already signed in. That is a starting state, not a failure.
        if signedIn.waitForExistence(timeout: 5) { return }

        // The screen is assembled while the launch is still importing content
        // and rebuilds once its own state has been read, so a tap that lands
        // in that moment is dropped. It is offered twice before this fails.
        let fixture = app.buttons["settings.account.fakeSignIn"]
        XCTAssertTrue(fixture.waitForExistence(timeout: 30), app.debugDescription)
        fixture.tap()
        if !signedIn.waitForExistence(timeout: 15), fixture.exists {
            fixture.tap()
        }
        XCTAssertTrue(signedIn.waitForExistence(timeout: 30), app.debugDescription)
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
