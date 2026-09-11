import XCTest

/// What the app says about work that has not reached the server, and what
/// happens to that work when the server can be reached again.
///
/// The queue grows on the study screen, so the count on Home has to be re-read
/// when the learner comes back. That is the case that was silently stale. The
/// second test is the other end of it: an answer recorded while nothing could
/// take it is still there after a relaunch, and goes up on the first run that
/// can.
@MainActor
final class SyncStatusUITests: XCTestCase {
    /// An unsigned build has no keychain entitlement, so a pinned installation
    /// is what makes a relaunch resume the same learner.
    private let identity = ["-installation-id", "5e7b21c4-90aa-4d33-8b61-0c4f7d2e9a18"]
    private let account = ["-fixture-account-id", "9f000000-0000-4000-8000-00000000000e"]

    func testTheSyncLineReportsWorkQueuedOnAnotherScreen() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store"]
        app.launch()

        XCTAssertTrue(app.buttons["home.deck.ALL"].waitForExistence(timeout: 60))
        // Nothing queued yet, so a healthy device says nothing at all.
        XCTAssertFalse(syncStatus(in: app).exists)

        app.buttons["home.deck.ALL"].tap()
        XCTAssertTrue(app.buttons["study.start"].waitForExistence(timeout: 15))
        app.buttons["study.start"].tap()

        for _ in 0..<2 {
            XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 15))
            app.buttons["study.reveal"].tap()
            XCTAssertTrue(app.staticTexts["study.answer"].waitForExistence(timeout: 10))
            app.descendants(matching: .any).matching(identifier: "study.card")
                .firstMatch.swipeRight()
        }

        // The session screen has no navigation bar any more: the flag is the
        // screen and the way out is the close control on it.
        app.buttons["study.close"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        // Prove we are actually back on Home before blaming the status line.
        // Two cards are answered and the session is still open, so the today
        // pane is in its "continue" state.
        XCTAssertTrue(
            app.buttons["home.continue"].waitForExistence(timeout: 15),
            app.debugDescription
        )

        // The count is re-read once, when Home appears, and that read goes to
        // the same store the first content import is still filling. Thirty
        // seconds is what the rest of this suite gives a cold launch; the line
        // is late here rather than absent, and what makes it late is the size
        // of the release rather than anything about the queue.
        let chip = syncStatus(in: app)
        XCTAssertTrue(chip.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(chip.label.isEmpty)
        // A guest is told their work is saved, not that something failed.
        XCTAssertFalse(chip.label.contains("sync."))
    }

    /// IOS-E2E-SY-02 and SY-12: the network comes back.
    ///
    /// Answers recorded while nothing could take them are the ones most easily
    /// lost — they exist only on the device, and the app has already told the
    /// learner they are safe. So the promise is made in two parts and this
    /// test holds both: the answers survive the process ending, and the first
    /// launch that reaches a server sends them, exactly once, without anybody
    /// asking it to.
    func testAnswersHeldWhileOfflineAreUploadedOnTheNextLaunchThatCan() {
        // Nothing answers `createReviewBatch` on this launch, so the queue can
        // only grow. That is the offline half, and it is the default.
        let offline = launch(
            arguments: ["-reset-store", "-fake-signin"] + identity + account
        )
        // One card as a guest first, so signing in imports real work and the
        // account has server-side progress. Without it the next launch has
        // nothing to draw and waits on a backend that only half answers this
        // fixture — a launch screen, not the queue, would be what this test
        // measured.
        answerCards(1, in: offline)
        signIn(in: offline)
        XCTAssertTrue(
            offline.descendants(matching: .any)["settings.account.migrationImported"]
                .waitForExistence(timeout: 30),
            offline.debugDescription
        )
        leaveScreen(in: offline)
        answerCards(2, in: offline)

        // The warning is the only place the count is visible, and it is the
        // assurance the learner is given.
        openAccount(in: offline)
        requestSignOut(in: offline)
        assertPendingAnswerWarning(count: 2, in: offline)
        tap("settings.account.signOut.cancel", in: offline)
        offline.terminate()

        // Same store, same account, and now a backend that takes a batch.
        let online = launch(
            arguments: ["-fake-signin", "-accept-reviews"] + identity + account
        )
        openAccount(in: online)
        requestSignOut(in: online)
        // Nothing is waiting any more: the queue drained on the sync run this
        // launch started by itself.
        let clean = online.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Everything is synced")
        ).firstMatch
        XCTAssertTrue(
            clean.waitForExistence(timeout: 60),
            "A launch that can reach the server must send what it was holding\n"
                + online.debugDescription
        )
        XCTAssertFalse(
            online.staticTexts.matching(
                NSPredicate(format: "label CONTAINS %@", "not on the server yet")
            ).firstMatch.exists,
            "The queue was reported as drained and must not still be counted\n"
                + online.debugDescription
        )
        tap("settings.account.signOut.cancel", in: online)

        // And the work itself is still the learner's: draining the queue is
        // not the same as losing what was in it.
        leaveScreen(in: online)
        let progress = online.tabBars.buttons["Progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 30), online.debugDescription)
        progress.tap()
        XCTAssertTrue(
            online.descendants(matching: .any)["progress.deck.ALL.counts"]
                .waitForExistence(timeout: 30),
            "Uploaded answers are still progress\n\(online.debugDescription)"
        )
    }

    // MARK: - Helpers

    private func signIn(in app: XCUIApplication) {
        openAccount(in: app)
        let signedIn = app.descendants(matching: .any)["settings.account.signedIn"]
        if signedIn.waitForExistence(timeout: 3) { return }
        let fixture = app.buttons["settings.account.fakeSignIn"]
        XCTAssertTrue(fixture.waitForExistence(timeout: 30), app.debugDescription)
        fixture.tap()
        XCTAssertTrue(signedIn.waitForExistence(timeout: 30), app.debugDescription)
    }

    private func openAccount(in app: XCUIApplication) {
        let account = app.buttons["account.open"]
        XCTAssertTrue(account.waitForExistence(timeout: 30), app.debugDescription)
        account.tap()
    }

    private func requestSignOut(in app: XCUIApplication) {
        let signOut = app.buttons["settings.account.signOut"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 20), app.debugDescription)
        signOut.tap()
    }

    private func assertPendingAnswerWarning(count: Int, in app: XCUIApplication) {
        let warning = app.staticTexts.matching(
            NSPredicate(
                format: "label BEGINSWITH %@",
                "\(count) answers are not on the server yet."
            )
        ).firstMatch
        XCTAssertTrue(
            warning.waitForExistence(timeout: 15),
            "The answers are still on the device and the app must say so\n"
                + app.debugDescription
        )
    }

    /// Through the catalog rather than Home: the all-countries pane yields to
    /// the review queue as soon as the schedule owes anything, and this test
    /// studies after progress already exists.
    private func answerCards(_ count: Int, in app: XCUIApplication) {
        // The shell is still being assembled on a cold launch, and a tap that
        // lands on the outgoing hierarchy is acknowledged without switching
        // tabs. Offering the tap again is what a person does, and it is the
        // same pattern the deck rows already need.
        let catalog = app.tabBars.buttons["Catalog"]
        XCTAssertTrue(catalog.waitForExistence(timeout: 60), app.debugDescription)
        let deck = app.buttons["catalog.deck.ALL"]
        for _ in 0..<3 {
            catalog.tap()
            if deck.waitForExistence(timeout: 20) { break }
        }
        XCTAssertTrue(deck.waitForExistence(timeout: 20), app.debugDescription)

        let start = app.buttons["study.start"]
        for _ in 0..<2 {
            deck.tap()
            if start.waitForExistence(timeout: 10) { break }
        }
        XCTAssertTrue(start.waitForExistence(timeout: 20), app.debugDescription)
        start.tap()

        for _ in 0..<count {
            let reveal = app.buttons["study.reveal"]
            XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
            reveal.tap()
            XCTAssertTrue(
                app.descendants(matching: .any)["study.answer"].waitForExistence(timeout: 10),
                app.debugDescription
            )
            app.descendants(matching: .any)["study.card"].swipeRight()
        }
        app.buttons["study.close"].tap()
        leaveScreen(in: app)
    }

    private func tap(_ identifier: String, in app: XCUIApplication) {
        let button = app.buttons.matching(identifier: identifier).firstMatch
        XCTAssertTrue(
            button.waitForExistence(timeout: 15),
            "\(identifier) is missing\n\(app.debugDescription)"
        )
        button.tap()
    }

    private func leaveScreen(in app: XCUIApplication) {
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }

    /// The chip lives in the navigation bar now, and how SwiftUI renders a
    /// small stack up there is its own business: asking for any descendant
    /// keeps this about the state being reported rather than the element kind
    /// it happens to be reported as.
    private func syncStatus(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["sync.status"]
    }
}
