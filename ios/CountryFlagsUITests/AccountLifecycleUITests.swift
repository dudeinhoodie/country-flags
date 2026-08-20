import XCTest

/// The account surface, end to end against the mock backend: what a signed-in
/// person can see about their account, and the one operation that ends it.
@MainActor
final class AccountLifecycleUITests: XCTestCase {
    /// The fixture sign-in and the fixture proof, which is the only way a test
    /// can drive flows that start with a provider sheet. Debug builds only, and
    /// only because the launch asks.
    private let fixtures = ["-fake-signin"]
    /// An unsigned build has no keychain entitlement, so a pinned identity is
    /// what keeps one guest across the relaunch this test makes.
    private let identity = ["-installation-id", "33333333-4444-4555-8666-777777777777"]

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testASignedInAccountListsItsLoginsAndDevices() {
        let app = launch(arguments: ["-reset-store"] + fixtures + identity)
        signIn(in: app)
        openAccount(in: app)

        XCTAssertTrue(
            app.descendants(matching: .any)
                .matching(identifier: "account.identity.APPLE")
                .firstMatch
                .waitForExistence(timeout: 15),
            app.debugDescription
        )
        // The mock account is signed in on this device and one other, so the
        // list proves both that it renders and that this one is named.
        XCTAssertTrue(
            app.buttons["account.revokeDevice.9F000000-0000-4000-8000-0000000000D1"]
                .waitForExistence(timeout: 15),
            app.debugDescription
        )
    }

    /// The whole deletion: the consequences, a fresh proof, and what the app
    /// says afterwards — which has to survive a relaunch, because the account
    /// it belonged to is gone by then.
    func testDeletingTheAccountLeavesAPendingNoticeThatSurvivesARelaunch() {
        let app = launch(arguments: ["-reset-store"] + fixtures + identity)
        signIn(in: app)
        openAccount(in: app)

        let delete = app.buttons["account.delete"]
        XCTAssertTrue(delete.waitForExistence(timeout: 15), app.debugDescription)
        delete.tap()

        // The dialog puts its button in the hierarchy twice — the row and the
        // element inside it — so the query names which one to press.
        let confirm = app.sheets.buttons
            .matching(identifier: "account.delete.confirm")
            .firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), app.debugDescription)
        confirm.tap()

        // The proof sheet: nothing has been deleted until a provider answers.
        let prove = app.buttons["account.prove.fixture"]
        XCTAssertTrue(prove.waitForExistence(timeout: 10), app.debugDescription)
        prove.tap()

        // The deletion signs the device out, so the account screen is gone
        // and the app is back at its guest self — which still studies.
        XCTAssertTrue(
            app.buttons["root.shell.openSettings"].waitForExistence(timeout: 20),
            app.debugDescription
        )
        openSettings(in: app)
        XCTAssertTrue(
            app.buttons["settings.account.signInApple"].waitForExistence(timeout: 15),
            app.debugDescription
        )

        // Relaunching without resetting the store: the notice is what a
        // person sees when they come back, and it has to outlive both the
        // session the deletion ended and the launch after it. It is read
        // without signing in, because after a deletion there is nothing to
        // sign into.
        app.terminate()
        let relaunched = launch(arguments: fixtures + identity)
        openSettings(in: relaunched)

        XCTAssertTrue(
            relaunched.descendants(matching: .any)
                .matching(identifier: "settings.account.deletionPending")
                .firstMatch
                .waitForExistence(timeout: 20),
            relaunched.debugDescription
        )
    }

    // MARK: - Helpers

    private func signIn(in app: XCUIApplication) {
        openSettings(in: app)
        // The settings screen is assembled while the launch is still importing
        // content, and the account section rebuilds itself once its own state
        // has been read. A tap that lands in that moment is dropped, so the
        // wait is for a settled screen and the tap is offered twice before the
        // test calls it a failure.
        let sessionSize = app.buttons["settings.sessionSize.10"]
        XCTAssertTrue(sessionSize.waitForExistence(timeout: 30), app.debugDescription)

        let fixture = app.buttons["settings.account.fakeSignIn"]
        XCTAssertTrue(fixture.waitForExistence(timeout: 30), app.debugDescription)
        fixture.tap()

        let account = app.buttons["account.open"]
        if !account.waitForExistence(timeout: 15), fixture.exists {
            fixture.tap()
        }
        XCTAssertTrue(account.waitForExistence(timeout: 30), app.debugDescription)
    }

    private func openSettings(in app: XCUIApplication) {
        let settings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), app.debugDescription)
        settings.tap()
    }

    private func openAccount(in app: XCUIApplication) {
        let account = app.buttons["account.open"]
        XCTAssertTrue(account.waitForExistence(timeout: 15), app.debugDescription)
        account.tap()
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
