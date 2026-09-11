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

    /// The whole deletion: the consequences, and what the app says afterwards
    /// — which has to survive a relaunch, because the account it belonged to
    /// is gone by then. The signed-in session is the proof; no provider sheet
    /// stands between the confirmation and the deletion any more.
    func testDeletingTheAccountLeavesAPendingNoticeThatSurvivesARelaunch() {
        let app = launch(arguments: ["-reset-store"] + fixtures + identity)
        signIn(in: app)

        let delete = scrollTo(app.buttons["account.delete"], in: app)
        XCTAssertTrue(delete.waitForExistence(timeout: 15), app.debugDescription)
        delete.tap()

        // The dialog puts its button in the hierarchy twice — the row and the
        // element inside it — so the query names which one to press.
        let confirm = app.sheets.buttons
            .matching(identifier: "account.delete.confirm")
            .firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), app.debugDescription)
        confirm.tap()

        // The deletion signs the device out, so the account screen is gone
        // and the app is back at its guest self — which still studies.
        XCTAssertTrue(
            app.buttons["root.shell.openSettings"].waitForExistence(timeout: 20),
            app.debugDescription
        )
        openAccount(in: app)
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
        openAccount(in: relaunched)

        XCTAssertTrue(
            relaunched.descendants(matching: .any)
                .matching(identifier: "settings.account.deletionPending")
                .firstMatch
                .waitForExistence(timeout: 20),
            relaunched.debugDescription
        )
    }

    /// Backing out. An account is the one thing in this app that cannot be
    /// recovered by studying again, so the dialog has to be a question rather
    /// than a formality: the way out is an explicit button on every size
    /// class, and taking it leaves the account exactly as it was — signed in,
    /// still deletable, and with nothing reported as having happened.
    func testCancellingTheDeletionLeavesTheAccountUntouched() {
        let app = launch(arguments: ["-reset-store"] + fixtures + identity)
        signIn(in: app)

        let delete = scrollTo(app.buttons["account.delete"], in: app)
        XCTAssertTrue(delete.waitForExistence(timeout: 15), app.debugDescription)
        delete.tap()

        // The consequences are named before anything is asked of the person.
        for copy in [
            "Delete this account?",
            "Your progress, awards, settings and every way in are gone. "
                + "The app stays — you just start from nothing.",
        ] {
            let text = app.staticTexts.matching(
                NSPredicate(format: "label == %@", copy)
            ).firstMatch
            XCTAssertTrue(
                text.waitForExistence(timeout: 10),
                "Ending an account must state its consequences\n\(app.debugDescription)"
            )
        }

        let cancel = app.buttons
            .matching(identifier: "account.delete.cancel")
            .firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 10), app.debugDescription)
        cancel.tap()

        // Nothing ran, so nothing is reported: a status line here would be the
        // app telling somebody it did something they declined.
        XCTAssertFalse(
            app.descendants(matching: .any)
                .matching(identifier: "account.delete.status")
                .firstMatch
                .exists,
            "Cancelling must not report an outcome\n\(app.debugDescription)"
        )
        XCTAssertFalse(
            app.descendants(matching: .any)
                .matching(identifier: "account.deletionPending")
                .firstMatch
                .exists,
            "Cancelling must not leave a deletion notice\n\(app.debugDescription)"
        )
        XCTAssertTrue(
            app.descendants(matching: .any)
                .matching(identifier: "settings.account.signedIn")
                .firstMatch
                .exists,
            "Cancelling must not end the session\n\(app.debugDescription)"
        )
        // Still offered, so the decision stays the person's to make later.
        XCTAssertTrue(
            scrollTo(app.buttons["account.delete"], in: app).exists,
            app.debugDescription
        )

        // A relaunch reads the session and the notice from storage, which is
        // where a cancelled deletion could still have left a mark.
        app.terminate()
        let relaunched = launch(arguments: fixtures + identity)
        openAccount(in: relaunched)
        XCTAssertTrue(
            relaunched.descendants(matching: .any)
                .matching(identifier: "settings.account.signedIn")
                .firstMatch
                .waitForExistence(timeout: 20),
            relaunched.debugDescription
        )
        XCTAssertFalse(
            relaunched.descendants(matching: .any)
                .matching(identifier: "settings.account.deletionPending")
                .firstMatch
                .exists,
            "A cancelled deletion is not a pending one\n\(relaunched.debugDescription)"
        )
    }

    // MARK: - Helpers

    /// Signs in and leaves the app on the account screen, which is where both
    /// the offer and everything it unlocks now live.
    private func signIn(in app: XCUIApplication) {
        openAccount(in: app)

        let signedIn = app.descendants(matching: .any)
            .matching(identifier: "settings.account.signedIn")
            .firstMatch
        // A session outlives the store the launch resets — it is in the
        // keychain, which belongs to the device rather than to the app's
        // documents — so a device that signed in for an earlier test arrives
        // here already signed in. That is a legitimate starting state, not a
        // failure: what this helper promises is an account, not a tap.
        if signedIn.waitForExistence(timeout: 5) { return }

        // The screen is assembled while the launch is still importing content,
        // and the account section rebuilds itself once its own state has been
        // read. A tap that lands in that moment is dropped, so the tap is
        // offered twice before the test calls it a failure.
        let fixture = app.buttons["settings.account.fakeSignIn"]
        XCTAssertTrue(fixture.waitForExistence(timeout: 30), app.debugDescription)
        fixture.tap()

        if !signedIn.waitForExistence(timeout: 15), fixture.exists {
            fixture.tap()
        }
        XCTAssertTrue(signedIn.waitForExistence(timeout: 30), app.debugDescription)
    }

    /// Brings an element into the hierarchy by scrolling to it. A form's rows
    /// are built as they come into view, so ending an account is not simply
    /// waiting to be found — the screen has to be walked to the bottom first.
    @discardableResult
    private func scrollTo(
        _ element: XCUIElement,
        in app: XCUIApplication,
        swipes: Int = 6
    ) -> XCUIElement {
        var remaining = swipes
        while !element.exists, remaining > 0 {
            app.swipeUp()
            remaining -= 1
        }
        return element
    }

    /// The avatar in the corner of the first screen. It is the only way in,
    /// so a test that is somewhere else has to come back first.
    private func openAccount(in app: XCUIApplication) {
        let account = app.buttons["account.open"]
        XCTAssertTrue(account.waitForExistence(timeout: 60), app.debugDescription)

        // The launch wait is a screen rather than an overlay, so the shell is
        // built only after it and the first interactive frame replaces the
        // hierarchy. A tap that lands in that moment is acknowledged and does
        // nothing — the button is there either way, so the answer is to offer
        // the tap again rather than to wait longer for a screen that is never
        // coming. Section 8 of the plan records why.
        //
        // Arrival is read off the account section in whichever state it is in:
        // signed in, signed out, mid-sign-in or expired. Waiting for one of
        // those in particular would make this helper care which test called it.
        let arrived = app.descendants(matching: .any).matching(
            NSPredicate(
                format: "identifier IN %@",
                [
                    "settings.account.signedIn",
                    "settings.account.signInApple",
                    "settings.account.signingIn",
                    "settings.account.expired",
                ]
            )
        ).firstMatch

        for _ in 0..<3 {
            account.tap()
            if arrived.waitForExistence(timeout: 15) { return }
        }
        XCTFail("The account screen never opened\n\(app.debugDescription)")
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
