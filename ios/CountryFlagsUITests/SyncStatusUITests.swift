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
        XCTAssertFalse(syncStatus(in: app).exists)

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

    /// The chip lives in the navigation bar now, and how SwiftUI renders a
    /// small stack up there is its own business: asking for any descendant
    /// keeps this about the state being reported rather than the element kind
    /// it happens to be reported as.
    private func syncStatus(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["sync.status"]
    }
}
