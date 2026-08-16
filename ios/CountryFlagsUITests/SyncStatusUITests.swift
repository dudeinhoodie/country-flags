import XCTest

/// The queue grows on the study screen, so the count on Home has to be re-read
/// when the learner comes back. This is the case that was silently stale.
@MainActor
final class SyncStatusUITests: XCTestCase {
    func testTheSyncLineReportsWorkQueuedOnAnotherScreen() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store"]
        app.launch()

        XCTAssertTrue(app.buttons["home.deck.ALL"].waitForExistence(timeout: 60))
        // Nothing queued yet, so a healthy device says nothing at all.
        XCTAssertFalse(app.staticTexts["sync.status"].exists)

        app.buttons["home.deck.ALL"].tap()
        XCTAssertTrue(app.buttons["study.start"].waitForExistence(timeout: 15))
        app.buttons["study.start"].tap()

        for _ in 0..<2 {
            XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 15))
            app.buttons["study.reveal"].tap()
            XCTAssertTrue(app.staticTexts["study.answer"].waitForExistence(timeout: 10))
            app.buttons["study.rating.GOOD"].tap()
        }

        // The session screen has no navigation bar any more: the flag is the
        // screen and the way out is the close control on it.
        app.buttons["study.close"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        // Prove we are actually back on Home before blaming the status line.
        XCTAssertTrue(
            app.staticTexts["home.greeting"].waitForExistence(timeout: 15),
            app.debugDescription
        )

        // The count is re-read once, when Home appears, and that read goes to
        // the same store the first content import is still filling. Thirty
        // seconds is what the rest of this suite gives a cold launch; the line
        // is late here rather than absent, and what makes it late is the size
        // of the release rather than anything about the queue.
        let line = app.staticTexts["sync.status"]
        XCTAssertTrue(line.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(line.label.isEmpty)
        // A guest is told their work is saved, not that something failed.
        XCTAssertFalse(line.label.contains("sync."))
    }
}
