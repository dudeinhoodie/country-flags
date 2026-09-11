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

    /// IOS-E2E-PD-16: signing the owner out takes their deck with them.
    ///
    /// This is the leak worth testing for, because it is the one nobody would
    /// see: a device handed back to a guest — sold, lent, returned — with
    /// somebody else's purchase still open on it. The same shape already
    /// produced a real bug on this branch, where a deleted account's unlocked
    /// deck outlived the account until the next launch.
    ///
    /// Discovery is on so the row is in the catalogue in both states. That is
    /// the other half of the row: what the storefront says about a deck is
    /// public, and only the cards behind it are the owner's.
    func testSigningTheOwnerOutLocksTheDeckAndLeavesItsListingAlone() {
        let app = launch(
            arguments: ["-reset-store", "-owned-deck"] + fixtures + identity + discovery
        )
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 60),
            app.debugDescription
        )
        signIn(in: app)

        // Owned first, so the test is about losing access rather than never
        // having had it.
        openPaidDeck(in: app)
        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 20),
            "The owner must reach the deck before signing out proves anything\n"
                + app.debugDescription
        )
        XCTAssertFalse(paywall(in: app).exists, app.debugDescription)
        app.navigationBars.buttons.element(boundBy: 0).tap()

        signOutOfThisDevice(in: app)

        // The listing survives: a storefront tells everybody what is for sale.
        let deck = openPaidDeck(in: app)
        XCTAssertTrue(
            deck.label.contains("Paid"),
            "A deck nobody here owns is listed as paid again: \(deck.label)\n"
                + app.debugDescription
        )

        // The cards do not. This is the assertion the scenario exists for.
        XCTAssertTrue(
            paywall(in: app).waitForExistence(timeout: 20),
            "A guest must meet the paywall, not the previous owner's cards\n"
                + app.debugDescription
        )
        XCTAssertFalse(
            app.buttons["study.start"].exists,
            "The deck must not be studiable by whoever holds the device now\n"
                + app.debugDescription
        )

        // And it stays that way: access that came back on the next launch
        // would be the same leak one relaunch later.
        app.terminate()
        let relaunched = launch(arguments: ["-owned-deck"] + fixtures + identity + discovery)
        let again = openPaidDeck(in: relaunched)
        XCTAssertTrue(again.label.contains("Paid"), again.label)
        XCTAssertTrue(
            paywall(in: relaunched).waitForExistence(timeout: 20),
            relaunched.debugDescription
        )
    }

    /// IOS-E2E-PD-17: a deck already downloaded opens with no network.
    ///
    /// Somebody who paid for a deck and then boarded a plane has bought
    /// nothing if the app needs a server to show it to them. `-offline-content`
    /// is the launch this case was written for: content requests fail while
    /// the store stays intact, so what opens the deck can only be what the
    /// device already holds.
    ///
    /// The session is restored rather than signed in again — it lives in the
    /// keychain and outlives the launch — which is also what keeps this
    /// scenario from contradicting `PD-16`: a sign-out is what clears the
    /// private scope, and this case never asks for one.
    ///
    /// What this cannot prove with the arguments that exist: the entitlement
    /// itself is still answered by the mock store, because `-offline-content`
    /// takes the content endpoints and leaves commerce. Proving the
    /// entitlement snapshot alone would need a launch where the store is
    /// unreachable too, and there is no argument for that yet. Recorded in
    /// section 9 of the plan rather than faked here.
    func testADownloadedPaidDeckOpensOnALaunchWithNoContentBackend() {
        let app = launch(
            arguments: ["-reset-store", "-owned-deck"] + fixtures + identity + discovery
        )
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 60),
            app.debugDescription
        )
        signIn(in: app)

        // Downloaded: the cards are on the device before the network goes.
        openPaidDeck(in: app)
        XCTAssertTrue(
            app.staticTexts["deck.cardCount"].waitForExistence(timeout: 20),
            app.debugDescription
        )
        let downloaded = app.staticTexts["deck.cardCount"].label
        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 20),
            app.debugDescription
        )
        app.terminate()

        let offline = launch(
            arguments: ["-owned-deck", "-offline-content"] + fixtures + identity + discovery
        )
        let deck = openPaidDeck(in: offline)
        XCTAssertFalse(
            deck.label.contains("Paid"),
            "The owner still owns it with the network gone: \(deck.label)\n"
                + offline.debugDescription
        )
        XCTAssertFalse(
            paywall(in: offline).exists,
            "A deck already paid for must not ask to be bought again offline\n"
                + offline.debugDescription
        )
        XCTAssertTrue(
            offline.buttons["study.start"].waitForExistence(timeout: 30),
            "A downloaded deck is studiable without a backend\n"
                + offline.debugDescription
        )
        XCTAssertEqual(
            offline.staticTexts["deck.cardCount"].label,
            downloaded,
            "Offline shows the deck that was downloaded, not a shorter one\n"
                + offline.debugDescription
        )
    }

    /// Walks to the paid deck's own screen and returns the catalogue row it
    /// was opened from, so a caller can ask what the listing said.
    ///
    /// The catalogue tab is offered again if the first tap is swallowed: the
    /// launch wait is a screen, so the shell is built only after it and the
    /// first interactive frame replaces the hierarchy.
    @discardableResult
    private func openPaidDeck(in app: XCUIApplication) -> XCUIElement {
        let catalog = app.tabBars.buttons["Catalog"]
        XCTAssertTrue(catalog.waitForExistence(timeout: 60), app.debugDescription)
        let deck = app.buttons["catalog.deck.SPECIAL_AREAS"]
        for _ in 0..<3 {
            catalog.tap()
            if deck.waitForExistence(timeout: 20) { break }
        }
        XCTAssertTrue(deck.waitForExistence(timeout: 20), app.debugDescription)
        let listing = deck.label
        deck.tap()
        // The row is gone from the hierarchy once its screen is up, so what it
        // said is captured before the tap and handed back as a static element.
        return app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", listing)
        ).firstMatch
    }

    /// Ends the session on this device only, and waits for the guest state.
    private func signOutOfThisDevice(in app: XCUIApplication) {
        let account = app.buttons["account.open"]
        XCTAssertTrue(account.waitForExistence(timeout: 60), app.debugDescription)
        account.tap()

        let signOut = app.buttons["settings.account.signOut"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 30), app.debugDescription)
        signOut.tap()
        let confirm = app.buttons["settings.account.signOut.confirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 15), app.debugDescription)
        confirm.tap()

        XCTAssertTrue(
            app.buttons["settings.account.signInApple"].waitForExistence(timeout: 30),
            "Signing out must leave this device a guest\n" + app.debugDescription
        )
        app.tabBars.buttons["Home"].tap()
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
