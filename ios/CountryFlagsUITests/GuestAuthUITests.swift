import XCTest

/// The account boundary as a learner meets it: work first, sign in later, and
/// leave without carrying one account's private state into the guest scope.
///
/// Provider sheets are deliberately outside ordinary CI. The Mock target's
/// fixture credential drives the same session exchange, guest import, scope
/// transition, and sign-out code without contacting Apple or Google.
@MainActor
final class GuestAuthUITests: XCTestCase {
    private let identity = [
        "-installation-id", "7a8ef513-a7be-4cc8-9ee8-8e852acb3659",
    ]
    private let accountA = [
        "-fixture-account-id", "9f000000-0000-4000-8000-00000000000a",
    ]
    private let accountB = [
        "-fixture-account-id", "9f000000-0000-4000-8000-00000000000b",
    ]
    private let paidDeckDiscovery = [
        "-feature-flag", "commerce.paid_decks.discovery.enabled=true",
    ]

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testGuestWorkIsImportedAfterSigningIn() {
        let app = launch(arguments: ["-reset-store", "-fake-signin"] + identity)
        answerOneCard(in: app)

        openAccount(in: app)
        signInWithFixture(in: app)

        XCTAssertTrue(
            element("settings.account.migrationImported", in: app)
                .waitForExistence(timeout: 20),
            app.debugDescription
        )

        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Progress"].tap()
        let counts = element("progress.deck.ALL.counts", in: app)
        XCTAssertTrue(counts.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(counts.label.isEmpty)

        app.terminate()
        let relaunched = launch(arguments: ["-fake-signin"] + identity)
        openAccount(in: relaunched)
        XCTAssertTrue(
            element("settings.account.signedIn", in: relaunched)
                .waitForExistence(timeout: 20),
            relaunched.debugDescription
        )
        XCTAssertFalse(
            element("settings.account.migrationImported", in: relaunched).exists,
            "A completed guest import must not be offered or reported again"
        )
    }

    func testSigningOutReturnsToAGuestWithoutAccountChrome() {
        let app = launch(arguments: ["-reset-store", "-fake-signin"] + identity)
        openAccount(in: app)
        signInWithFixture(in: app)
        signOut(in: app)
        XCTAssertFalse(element("settings.account.signedIn", in: app).exists)

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(
            app.buttons["home.deck.ALL"].waitForExistence(timeout: 20),
            "Signing out must leave the guest learning flow available\n\(app.debugDescription)"
        )
    }

    func testSwitchingAccountsKeepsPrivateStateIsolated() {
        let first = launch(
            arguments: ["-reset-store", "-fake-signin", "-owned-deck"]
                + identity + accountA
        )
        answerOneCard(in: first)
        openAccount(in: first)
        signInWithFixture(in: first)
        XCTAssertTrue(
            element("settings.account.migrationImported", in: first)
                .waitForExistence(timeout: 20),
            first.debugDescription
        )
        first.navigationBars.buttons.element(boundBy: 0).tap()
        selectSessionSize(20, in: first)
        assertPaidDeckIsOwned(in: first)
        openAccount(in: first)
        signOut(in: first)
        first.terminate()

        let second = launch(
            arguments: ["-fake-signin"] + identity + accountB + paidDeckDiscovery
        )
        openAccount(in: second)
        signInWithFixture(in: second)
        second.navigationBars.buttons.element(boundBy: 0).tap()
        assertSessionSize(10, in: second)
        second.tabBars.buttons["Progress"].tap()
        XCTAssertTrue(
            second.staticTexts["progress.empty"].waitForExistence(timeout: 20),
            "Account B must not see Account A's progress\n\(second.debugDescription)"
        )
        XCTAssertFalse(element("progress.deck.ALL.counts", in: second).exists)
        assertPaidDeckIsLocked(in: second)

        second.tabBars.buttons["Home"].tap()
        openAccount(in: second)
        signOut(in: second)
        second.terminate()

        let restored = launch(
            arguments: ["-fake-signin", "-owned-deck"] + identity + accountA
        )
        openAccount(in: restored)
        signInWithFixture(in: restored)
        restored.navigationBars.buttons.element(boundBy: 0).tap()
        assertSessionSize(20, in: restored)
        restored.tabBars.buttons["Progress"].tap()
        XCTAssertTrue(
            element("progress.deck.ALL.counts", in: restored)
                .waitForExistence(timeout: 20),
            "Returning to Account A must restore its own progress\n\(restored.debugDescription)"
        )
        XCTAssertFalse(restored.staticTexts["progress.empty"].exists)
        assertPaidDeckIsOwned(in: restored)
    }

    func testPendingAnswersSurviveCancelledAndConfirmedSignOut() {
        let app = launch(
            arguments: ["-reset-store", "-fake-signin"] + identity + accountA
        )
        openAccount(in: app)
        signInWithFixture(in: app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        answerCards(2, in: app)

        openAccount(in: app)
        requestSignOut(in: app)
        assertPendingAnswerWarning(count: 2, in: app)

        let cancel = app.buttons.matching(
            identifier: "settings.account.signOut.cancel"
        ).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 10), app.debugDescription)
        cancel.tap()
        XCTAssertTrue(
            element("settings.account.signedIn", in: app).waitForExistence(timeout: 10),
            "Cancelling sign-out must keep the account session\n\(app.debugDescription)"
        )

        requestSignOut(in: app)
        assertPendingAnswerWarning(count: 2, in: app)
        confirmSignOut(in: app)

        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Progress"].tap()
        XCTAssertTrue(
            app.staticTexts["progress.empty"].waitForExistence(timeout: 20),
            "Account progress must not leak into the guest scope\n\(app.debugDescription)"
        )

        openAccount(in: app)
        signInWithFixture(in: app)
        requestSignOut(in: app)
        assertPendingAnswerWarning(count: 2, in: app)
        app.buttons.matching(identifier: "settings.account.signOut.cancel").firstMatch.tap()
    }

    /// IOS-E2E-AC-04: signing out everywhere ends this device too.
    ///
    /// It is the button somebody reaches for after losing a phone, so the
    /// thing that must not happen is the one that would be hardest to notice:
    /// this device quietly staying signed in while the person believes every
    /// session is closed.
    func testSigningOutEverywhereLeavesThisDeviceAGuestToo() {
        let app = launch(
            arguments: ["-reset-store", "-fake-signin"] + identity + accountA
        )
        openAccount(in: app)
        signInWithFixture(in: app)

        requestSignOut(in: app)
        let everywhere = app.buttons.matching(
            identifier: "settings.account.signOutEverywhere.confirm"
        ).firstMatch
        XCTAssertTrue(everywhere.waitForExistence(timeout: 15), app.debugDescription)
        everywhere.tap()

        XCTAssertTrue(
            app.buttons["settings.account.signInApple"].waitForExistence(timeout: 30),
            "Signing out everywhere includes the device it was asked from\n"
                + app.debugDescription
        )
        XCTAssertFalse(
            element("settings.account.signedIn", in: app).exists,
            app.debugDescription
        )

        // And it stays out: a session that came back on the next launch would
        // be the same failure one relaunch later.
        app.terminate()
        let relaunched = launch(arguments: ["-fake-signin"] + identity + accountA)
        openAccount(in: relaunched)
        XCTAssertTrue(
            relaunched.buttons["settings.account.signInApple"].waitForExistence(timeout: 30),
            relaunched.debugDescription
        )
    }

    private func answerOneCard(in app: XCUIApplication) {
        answerCards(1, in: app)
    }

    private func answerCards(_ count: Int, in app: XCUIApplication) {
        let start = app.buttons["study.start"]
        openHomeDeck(in: app, until: start)
        XCTAssertTrue(start.waitForExistence(timeout: 20), app.debugDescription)
        start.tap()

        for _ in 0..<count {
            let reveal = app.buttons["study.reveal"]
            XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
            reveal.tap()
            XCTAssertTrue(
                element("study.answer", in: app).waitForExistence(timeout: 10),
                app.debugDescription
            )
            element("study.card", in: app).swipeRight()
        }
        app.buttons["study.close"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    /// The bundled catalogue and the refreshed catalogue can replace the Home
    /// hierarchy a moment after launch. A tap that lands on the outgoing row
    /// is acknowledged by XCTest but cannot navigate. Re-acquiring the row
    /// once mirrors a person tapping again and keeps this account test focused
    /// on the guest-to-account boundary rather than launch timing.
    private func openHomeDeck(in app: XCUIApplication, until destination: XCUIElement) {
        for _ in 0..<2 {
            let deck = app.buttons["home.deck.ALL"]
            XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
            deck.tap()
            if destination.waitForExistence(timeout: 8) { return }
        }
    }

    private func openAccount(in app: XCUIApplication) {
        let account = app.buttons["account.open"]
        XCTAssertTrue(account.waitForExistence(timeout: 30), app.debugDescription)
        account.tap()
    }

    private func signInWithFixture(in app: XCUIApplication) {
        let signedIn = element("settings.account.signedIn", in: app)
        if signedIn.waitForExistence(timeout: 3) { return }

        let signIn = app.buttons["settings.account.fakeSignIn"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 20), app.debugDescription)
        signIn.tap()
        XCTAssertTrue(signedIn.waitForExistence(timeout: 30), app.debugDescription)
    }

    private func signOut(in app: XCUIApplication) {
        requestSignOut(in: app)
        confirmSignOut(in: app)
    }

    private func requestSignOut(in app: XCUIApplication) {
        let signOut = app.buttons["settings.account.signOut"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 10), app.debugDescription)
        signOut.tap()
    }

    private func confirmSignOut(in app: XCUIApplication) {
        let confirmation = app.buttons.matching(
            identifier: "settings.account.signOut.confirm"
        ).firstMatch
        XCTAssertTrue(confirmation.waitForExistence(timeout: 10), app.debugDescription)
        confirmation.tap()
        XCTAssertTrue(
            app.buttons["settings.account.signInApple"].waitForExistence(timeout: 20),
            app.debugDescription
        )
    }

    private func assertPendingAnswerWarning(count: Int, in app: XCUIApplication) {
        let warning = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "\(count) answers are not on the server yet.")
        ).firstMatch
        XCTAssertTrue(
            warning.waitForExistence(timeout: 10),
            "Sign-out must explain how many answers are pending\n\(app.debugDescription)"
        )
    }

    private func selectSessionSize(_ size: Int, in app: XCUIApplication) {
        openSettings(in: app)
        let option = app.buttons["settings.sessionSize.\(size)"]
        XCTAssertTrue(option.waitForExistence(timeout: 15), app.debugDescription)
        option.tap()
        XCTAssertTrue(option.isSelected, app.debugDescription)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(
            app.buttons["root.shell.openSettings"].waitForExistence(timeout: 30),
            app.debugDescription
        )
    }

    private func assertSessionSize(_ size: Int, in app: XCUIApplication) {
        openSettings(in: app)
        let option = app.buttons["settings.sessionSize.\(size)"]
        XCTAssertTrue(option.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(option.isSelected, app.debugDescription)
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    private func openSettings(in app: XCUIApplication) {
        let settings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), app.debugDescription)
        settings.tap()
    }

    private func assertPaidDeckIsOwned(in app: XCUIApplication) {
        app.tabBars.buttons["Catalog"].tap()
        let deck = app.buttons["catalog.deck.SPECIAL_AREAS"]
        XCTAssertTrue(deck.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(deck.label.contains("Paid"), deck.label)
        deck.tap()
        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 15),
            "Account A must keep its paid entitlement\n\(app.debugDescription)"
        )
        XCTAssertFalse(element("deck.paywall", in: app).exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    private func assertPaidDeckIsLocked(in app: XCUIApplication) {
        app.tabBars.buttons["Catalog"].tap()
        let deck = app.buttons["catalog.deck.SPECIAL_AREAS"]
        XCTAssertTrue(deck.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(deck.label.contains("Paid"), deck.label)
        deck.tap()
        XCTAssertTrue(
            element("deck.paywall", in: app).waitForExistence(timeout: 15),
            "Account B must not inherit Account A's paid entitlement\n\(app.debugDescription)"
        )
        XCTAssertFalse(app.buttons["study.start"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
