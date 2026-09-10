import XCTest

/// Erasing a learner's history, from the side that matters: what they are told
/// before it happens, and what is still there afterwards.
///
/// The two branches are separate tests on purpose. Backing out and going
/// through are different promises — one keeps everything, the other keeps the
/// account, the settings and the purchases while taking the answers — and a
/// single test that walked both would prove neither in isolation.
///
/// The fixture credential drives the same session the provider sheets do, so
/// this runs on `CountryFlags-Mock` without contacting Apple or Google.
@MainActor
final class AccountProgressUITests: XCTestCase {
    /// A guest identity of this suite's own. An unsigned build has no keychain
    /// entitlement, so the pinned installation is what makes a relaunch resume
    /// the same guest — and keeping it distinct from the other suites' is what
    /// keeps these tests independent of the order they run in.
    private let identity = [
        "-installation-id", "4c9d0f21-7b3e-4a56-8d10-2fe6a4b8c703",
    ]
    private let account = [
        "-fixture-account-id", "9f000000-0000-4000-8000-00000000000c",
    ]

    /// What the dialog says before anything is deleted. Read from the screen
    /// rather than from the app's own catalogue: a test that asked the code
    /// what it renders would agree with any copy at all, including none.
    private let confirmationTitle = "Clear all progress?"
    private let confirmationBody =
        "Answers, cards, sessions and awards are deleted on every device. "
        + "The account, its settings and the catalog stay."
    private let clearedStatus = "Done — the progress is cleared."

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    // MARK: - IOS-E2E-AC-06

    /// Backing out of the dialog is a decision to keep everything: the
    /// history, the unsent answers, the session and the settings — including
    /// after the app is closed and opened again.
    func testCancellingClearProgressLeavesEverythingWhereItWas() {
        let app = launch(arguments: ["-reset-store", "-fake-signin"] + identity + account)
        answerCards(1, in: app)
        openAccount(in: app)
        signInWithFixture(in: app)
        assertGuestWorkWasImported(in: app)
        leaveScreen(in: app)

        selectSessionSize(20, in: app)
        answerCards(2, in: app)
        let counted = progressCounts(in: app)

        openAccount(in: app)
        requestClearProgress(in: app)
        assertTheConsequencesAreStated(in: app)
        cancelClearProgress(in: app)

        // Nothing ran, so nothing is reported: a status line here would be the
        // app telling a learner it did something they declined.
        XCTAssertFalse(
            element("settings.clearProgress.status", in: app).exists,
            "Cancelling must not report an outcome\n\(app.debugDescription)"
        )
        XCTAssertTrue(
            element("settings.account.signedIn", in: app).exists,
            "Cancelling must not touch the session\n\(app.debugDescription)"
        )

        // The queue is only visible through what sign-out says about it, which
        // is exactly the assurance a learner gets.
        requestSignOut(in: app)
        assertPendingAnswerWarning(count: 2, in: app)
        tap("settings.account.signOut.cancel", in: app)

        leaveScreen(in: app)
        XCTAssertEqual(progressCounts(in: app), counted)
        assertSessionSize(20, in: app)

        app.terminate()
        let relaunched = launch(arguments: ["-fake-signin"] + identity + account)
        XCTAssertEqual(progressCounts(in: relaunched), counted)
        openAccount(in: relaunched)
        XCTAssertTrue(
            element("settings.account.signedIn", in: relaunched)
                .waitForExistence(timeout: 20),
            relaunched.debugDescription
        )
    }

    // MARK: - IOS-E2E-AC-07

    /// Going through takes the answers and nothing else. The account is still
    /// signed in, the settings are still chosen, the paid deck is still owned
    /// — and the deleted history does not come back on the next launch or on
    /// the next sign-in.
    func testConfirmingClearProgressErasesTheHistoryAndKeepsTheAccount() {
        let app = launch(
            arguments: ["-reset-store", "-fake-signin", "-owned-deck"] + identity + account
        )
        answerCards(2, in: app)
        openAccount(in: app)
        signInWithFixture(in: app)
        assertGuestWorkWasImported(in: app)
        leaveScreen(in: app)

        selectSessionSize(20, in: app)
        answerCards(2, in: app)
        XCTAssertFalse(progressCounts(in: app).isEmpty)

        openAccount(in: app)
        requestClearProgress(in: app)
        assertTheConsequencesAreStated(in: app)
        tap("settings.clearProgress.confirm", in: app)

        let status = element("settings.clearProgress.status", in: app)
        XCTAssertTrue(status.waitForExistence(timeout: 30), app.debugDescription)
        // Compared rather than merely found: the failure copy carries the same
        // identifier, and "the progress is still here" would satisfy any test
        // that only asked whether a status appeared.
        XCTAssertEqual(status.label, clearedStatus, app.debugDescription)
        XCTAssertTrue(
            element("settings.account.signedIn", in: app).exists,
            "Clearing progress must not sign the learner out\n\(app.debugDescription)"
        )

        // The queue went with the history it belonged to, so sign-out has
        // nothing left to warn about.
        requestSignOut(in: app)
        assertNothingIsWaitingToBeSent(in: app)
        tap("settings.account.signOut.cancel", in: app)

        leaveScreen(in: app)
        assertProgressIsEmpty(in: app)
        assertSessionSize(20, in: app)
        assertPaidDeckIsOwned(in: app)

        app.terminate()
        let relaunched = launch(
            arguments: ["-fake-signin", "-owned-deck"] + identity + account
        )
        assertProgressIsEmpty(in: relaunched)
        assertSessionSize(20, in: relaunched)

        // Out and back in: the deletion is the account's, so neither the guest
        // scope nor a fresh sign-in may produce the answers again.
        openAccount(in: relaunched)
        signOut(in: relaunched)
        leaveScreen(in: relaunched)
        assertProgressIsEmpty(in: relaunched)

        openAccount(in: relaunched)
        signInWithFixture(in: relaunched)
        leaveScreen(in: relaunched)
        assertProgressIsEmpty(in: relaunched)
    }

    // MARK: - Clearing progress

    private func requestClearProgress(in app: XCUIApplication) {
        let clear = app.buttons["settings.clearProgress"]
        XCTAssertTrue(
            clear.waitForExistence(timeout: 20),
            "A signed-in account is offered the operation\n\(app.debugDescription)"
        )
        clear.tap()
    }

    /// The dialog names the operation and says what it costs. Both lines are
    /// checked: a title alone does not tell anybody that the awards go too.
    private func assertTheConsequencesAreStated(in app: XCUIApplication) {
        for copy in [confirmationTitle, confirmationBody] {
            let text = app.staticTexts.matching(
                NSPredicate(format: "label == %@", copy)
            ).firstMatch
            XCTAssertTrue(
                text.waitForExistence(timeout: 10),
                "Clearing progress must state its consequences\n\(app.debugDescription)"
            )
        }
    }

    private func cancelClearProgress(in app: XCUIApplication) {
        tap("settings.clearProgress.cancel", in: app)
        XCTAssertTrue(
            app.buttons["settings.clearProgress"].waitForExistence(timeout: 10),
            "Cancelling returns to the account screen\n\(app.debugDescription)"
        )
    }

    // MARK: - Progress

    /// The whole-catalogue counts as the screen draws them, waited for rather
    /// than sampled: the numbers are the backend's and arrive with a sync run.
    private func progressCounts(in app: XCUIApplication) -> String {
        openProgress(in: app)
        let counts = element("progress.deck.ALL.counts", in: app)
        XCTAssertTrue(counts.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(counts.label.isEmpty)
        return counts.label
    }

    private func assertProgressIsEmpty(in app: XCUIApplication) {
        openProgress(in: app)
        XCTAssertTrue(
            app.staticTexts["progress.empty"].waitForExistence(timeout: 30),
            "The cleared account has nothing left to show\n\(app.debugDescription)"
        )
        XCTAssertFalse(
            element("progress.deck.ALL.counts", in: app).exists,
            app.debugDescription
        )
    }

    private func openProgress(in app: XCUIApplication) {
        let progress = app.tabBars.buttons["Progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 30), app.debugDescription)
        progress.tap()
    }

    // MARK: - Studying

    /// Always through the catalog, never through Home.
    ///
    /// Home leads with whatever today asks for: the all-countries pane stands
    /// there only while nothing is due, and yields to the review queue the
    /// moment the schedule owes anything. These tests deliberately build
    /// progress and then study again, so the row would be there for the first
    /// sitting and gone for the second. The catalog offers the whole deck
    /// whatever the queue says, and a session of the chosen size is what this
    /// needs — the queue would hand back only the cards that are due.
    private func answerCards(_ count: Int, in app: XCUIApplication) {
        let start = app.buttons["study.start"]
        openCatalogDeck(in: app, until: start)
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
        leaveScreen(in: app)
    }

    /// The bundled catalogue and the refreshed one can replace the hierarchy a
    /// moment after launch, and a tap that lands on the outgoing row is
    /// acknowledged without navigating. Re-acquiring the row once mirrors a
    /// person tapping again.
    private func openCatalogDeck(in app: XCUIApplication, until destination: XCUIElement) {
        openCatalog(in: app)
        for _ in 0..<2 {
            let deck = app.buttons["catalog.deck.ALL"]
            XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
            deck.tap()
            if destination.waitForExistence(timeout: 8) { return }
        }
    }

    private func openCatalog(in app: XCUIApplication) {
        let catalog = app.tabBars.buttons["Catalog"]
        XCTAssertTrue(catalog.waitForExistence(timeout: 30), app.debugDescription)
        catalog.tap()
    }

    // MARK: - Account

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

    private func assertGuestWorkWasImported(in app: XCUIApplication) {
        XCTAssertTrue(
            element("settings.account.migrationImported", in: app)
                .waitForExistence(timeout: 20),
            "The account has to start from the guest's work\n\(app.debugDescription)"
        )
    }

    private func requestSignOut(in app: XCUIApplication) {
        let signOut = app.buttons["settings.account.signOut"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 10), app.debugDescription)
        signOut.tap()
    }

    private func signOut(in app: XCUIApplication) {
        requestSignOut(in: app)
        tap("settings.account.signOut.confirm", in: app)
        XCTAssertTrue(
            app.buttons["settings.account.signInApple"].waitForExistence(timeout: 20),
            app.debugDescription
        )
    }

    private func assertPendingAnswerWarning(count: Int, in app: XCUIApplication) {
        XCTAssertTrue(
            pendingAnswerWarning(count: count, in: app).waitForExistence(timeout: 10),
            "Sign-out must say how many answers are still waiting\n\(app.debugDescription)"
        )
    }

    /// Read once the dialog is up, so this is the absence of a warning rather
    /// than the absence of a dialog.
    private func assertNothingIsWaitingToBeSent(in app: XCUIApplication) {
        let clean = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Everything is synced")
        ).firstMatch
        XCTAssertTrue(clean.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(
            pendingAnswerWarning(count: 2, in: app).exists,
            "The queue was deleted with the history it belonged to\n\(app.debugDescription)"
        )
    }

    private func pendingAnswerWarning(count: Int, in app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(
            NSPredicate(
                format: "label BEGINSWITH %@",
                "\(count) answers are not on the server yet."
            )
        ).firstMatch
    }

    // MARK: - Settings and purchases

    private func selectSessionSize(_ size: Int, in app: XCUIApplication) {
        openSettings(in: app)
        let option = app.buttons["settings.sessionSize.\(size)"]
        XCTAssertTrue(option.waitForExistence(timeout: 15), app.debugDescription)
        option.tap()
        XCTAssertTrue(option.isSelected, app.debugDescription)
        // The choice is stored by a task the tap starts; leaving the screen the
        // way a person would is what gives that write its turn.
        leaveScreen(in: app)
        XCTAssertTrue(
            app.buttons["root.shell.openSettings"].waitForExistence(timeout: 30),
            app.debugDescription
        )
    }

    private func assertSessionSize(_ size: Int, in app: XCUIApplication) {
        openSettings(in: app)
        let option = app.buttons["settings.sessionSize.\(size)"]
        XCTAssertTrue(option.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(
            option.isSelected,
            "Clearing progress is not a settings reset\n\(app.debugDescription)"
        )
        leaveScreen(in: app)
    }

    private func openSettings(in app: XCUIApplication) {
        let settings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), app.debugDescription)
        settings.tap()
    }

    private func assertPaidDeckIsOwned(in app: XCUIApplication) {
        openCatalog(in: app)
        let deck = app.buttons["catalog.deck.SPECIAL_AREAS"]
        XCTAssertTrue(deck.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(deck.label.contains("Paid"), deck.label)
        deck.tap()
        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 15),
            "A purchase is not progress and must survive it\n\(app.debugDescription)"
        )
        XCTAssertFalse(element("deck.paywall", in: app).exists)
        leaveScreen(in: app)
    }

    // MARK: - Plumbing

    private func tap(_ identifier: String, in app: XCUIApplication) {
        let button = app.buttons.matching(identifier: identifier).firstMatch
        XCTAssertTrue(
            button.waitForExistence(timeout: 10),
            "\(identifier) is missing\n\(app.debugDescription)"
        )
        button.tap()
    }

    private func leaveScreen(in app: XCUIApplication) {
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
