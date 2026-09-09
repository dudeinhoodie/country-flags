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

    func testSwitchingAccountsKeepsTheirProgressIsolated() {
        let first = launch(
            arguments: ["-reset-store", "-fake-signin"] + identity + accountA
        )
        answerOneCard(in: first)
        openAccount(in: first)
        signInWithFixture(in: first)
        XCTAssertTrue(
            element("settings.account.migrationImported", in: first)
                .waitForExistence(timeout: 20),
            first.debugDescription
        )
        signOut(in: first)
        first.terminate()

        let second = launch(arguments: ["-fake-signin"] + identity + accountB)
        openAccount(in: second)
        signInWithFixture(in: second)
        second.navigationBars.buttons.element(boundBy: 0).tap()
        second.tabBars.buttons["Progress"].tap()
        XCTAssertTrue(
            second.staticTexts["progress.empty"].waitForExistence(timeout: 20),
            "Account B must not see Account A's progress\n\(second.debugDescription)"
        )
        XCTAssertFalse(element("progress.deck.ALL.counts", in: second).exists)

        openAccount(in: second)
        signOut(in: second)
        second.terminate()

        let restored = launch(arguments: ["-fake-signin"] + identity + accountA)
        openAccount(in: restored)
        signInWithFixture(in: restored)
        restored.navigationBars.buttons.element(boundBy: 0).tap()
        restored.tabBars.buttons["Progress"].tap()
        XCTAssertTrue(
            element("progress.deck.ALL.counts", in: restored)
                .waitForExistence(timeout: 20),
            "Returning to Account A must restore its own progress\n\(restored.debugDescription)"
        )
        XCTAssertFalse(restored.staticTexts["progress.empty"].exists)
    }

    private func answerOneCard(in app: XCUIApplication) {
        let start = app.buttons["study.start"]
        openHomeDeck(in: app, until: start)
        XCTAssertTrue(start.waitForExistence(timeout: 20), app.debugDescription)
        start.tap()

        let reveal = app.buttons["study.reveal"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
        reveal.tap()
        XCTAssertTrue(
            element("study.answer", in: app).waitForExistence(timeout: 10),
            app.debugDescription
        )
        element("study.card", in: app).swipeRight()
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
        let signOut = app.buttons["settings.account.signOut"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 10), app.debugDescription)
        signOut.tap()

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
