import XCTest

/// Launch smoke: the app starts, shows the localized home screen and can follow
/// a typed route. The test addresses elements by accessibility identifier, so it
/// does not depend on the simulator language.
///
/// The class is `@MainActor` because XCUITest API is main-actor isolated under
/// the Swift 6 language mode.
@MainActor
final class LaunchSmokeUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testLaunchShowsLocalizedShell() {
        let app = XCUIApplication()
        // A fresh store, like every other suite: the deck pane this test
        // anchors on is only rendered when nothing is due and no session is
        // open, and leftover state from an earlier run must not decide that.
        app.launchArguments += ["-reset-store"]
        app.launch()

        // Home is the root screen; the hero deck pane is its localized entry.
        let hero = app.buttons["home.deck.ALL"]
        XCTAssertTrue(hero.waitForExistence(timeout: 10))
        XCTAssertFalse(hero.label.isEmpty)
        // A string catalog key must never reach the interface. The button's
        // label is its action title, so a broken catalog would surface the
        // raw "study." key there — never the identifier string.
        XCTAssertFalse(hero.label.contains("study."), app.debugDescription)
    }

    /// The claim of #301, demonstrated rather than argued: an install that has
    /// never reached a backend opens on a catalogue it can study.
    ///
    /// Nothing in the store and every content request refused — a fresh phone
    /// on a plane, and what a reviewer sees when the host is not answering.
    /// Before the app carried a catalogue this ran out the request timeout on
    /// a blocking screen and landed on "you are offline" over three empty
    /// tabs, which is the guideline 2.1 reading of an app that does not work.
    func testAFirstLaunchWithNoBackendOpensOnTheBundledCatalog() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store", "-offline-content"]
        app.launch()

        let hero = app.buttons["home.deck.ALL"]
        XCTAssertTrue(hero.waitForExistence(timeout: 60), app.debugDescription)
        // Neither of the two screens this replaces: the blocking wait and the
        // empty state behind it.
        XCTAssertFalse(
            app.descendants(matching: .any)
                .matching(identifier: "root.launchWait").firstMatch.exists,
            app.debugDescription
        )
        XCTAssertFalse(
            app.staticTexts["content.placeholder.title"].exists,
            app.debugDescription
        )
        // And it says what it is rather than pretending to be up to date: a
        // catalogue on the device with no connection behind it.
        XCTAssertTrue(
            app.staticTexts["content.statusBanner"].waitForExistence(timeout: 30),
            app.debugDescription
        )

        // A catalogue that can be opened and studied, not a list of names: the
        // deck reports the cards it holds and offers to start.
        hero.tap()
        let cardCount = app.staticTexts["deck.cardCount"]
        XCTAssertTrue(cardCount.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(cardCount.label.isEmpty)
        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 20),
            app.debugDescription
        )
    }

    /// The owner's path, and the claim of #404: work done before the first
    /// successful sync survives it.
    ///
    /// The first leg is the app on a plane — the catalogue is the one the
    /// build ships, stored under identifiers no server issued (ADR-021). The
    /// second is the same device with a backend answering, which replaces that
    /// catalogue whole and renumbers every card in it. Progress is keyed by
    /// card, so this used to end with an empty Progress tab: the owner
    /// studied, signed in, and the work was gone without a word.
    ///
    /// The renumbering is watched rather than assumed. The deck screen lists
    /// its countries by card identifier, so the first row's identifier
    /// changing is the supersession itself happening, and the tab is only read
    /// once it has.
    func testWorkDoneBeforeTheFirstSyncSurvivesIt() {
        // The guest is pinned. An unsigned build has no keychain entitlement,
        // so without this the second launch is a different person and the work
        // would be missing for a reason that has nothing to do with #404.
        let identity = ["-installation-id", "66666666-7777-4888-8999-999999999999"]

        let offline = launch(["-reset-store", "-offline-content"] + identity)
        openEuropeDeck(in: offline)
        let seededRow = firstCountryIdentifier(in: offline)
        answerTwoCards(in: offline)
        offline.buttons["study.close"].tap()
        offline.navigationBars.buttons.element(boundBy: 0).tap()

        // A guest with no network can see their own work. This is the number
        // the owner watched disappear.
        openProgress(in: offline)
        let seededCounts = counts(in: offline)
        XCTAssertTrue(seededCounts.waitForExistence(timeout: 30), offline.debugDescription)
        XCTAssertFalse(offline.staticTexts["progress.empty"].exists, offline.debugDescription)
        offline.terminate()

        // The same device, the same guest, and a backend that answers: the
        // seeded catalogue is replaced by the release the server publishes.
        let online = launch(identity)
        var currentRow = seededRow
        for _ in 0..<10 where currentRow == seededRow {
            openEuropeDeck(in: online)
            currentRow = firstCountryIdentifier(in: online)
            online.navigationBars.buttons.element(boundBy: 0).tap()
            _ = online.buttons["catalog.deck.EUROPE"].waitForExistence(timeout: 30)
        }
        XCTAssertNotEqual(
            currentRow,
            seededRow,
            "The release that renumbers every card never landed: \(online.debugDescription)"
        )

        openProgress(in: online)
        XCTAssertTrue(counts(in: online).waitForExistence(timeout: 30), online.debugDescription)
        // The failure this test exists for: an empty Progress tab over a store
        // that still holds every answer.
        XCTAssertFalse(online.staticTexts["progress.empty"].exists, online.debugDescription)
    }

    func testTypedRouteOpensAndReturns() {
        let app = XCUIApplication()
        app.launchArguments += ["-reset-store"]
        app.launch()

        let openSettings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(openSettings.waitForExistence(timeout: 10))
        openSettings.tap()

        // Settings is a real screen, so the route is proved by a control the
        // screen owns rather than by a placeholder title.
        // The hierarchy is attached to the failure: this suite is verified
        // on CI as well, where the xcresult bundle is the only artifact.
        let reminders = app.switches["settings.reminders"]
        XCTAssertTrue(reminders.waitForExistence(timeout: 10), app.debugDescription)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(reminders.label.contains("settings."), app.debugDescription)

        // The Mock build says which build it is; Prod must not. It says it
        // here rather than on the first screen, whose corner belongs to the
        // account now — at the foot of the form, under the About row. A list
        // materialises only the rows on screen, so the form is scrolled to
        // its end before the badge is asked for; on a phone it starts below
        // the fold.
        let badge = app.staticTexts["root.shell.environmentBadge"]
        for _ in 0..<4 where !badge.exists {
            app.swipeUp()
        }
        XCTAssertTrue(badge.waitForExistence(timeout: 10), app.debugDescription)

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["home.deck.ALL"].waitForExistence(timeout: 5))
    }

    // MARK: - Helpers

    /// The catalogue rather than the home hero: the hero pane is replaced by
    /// the resume row while a session is open, and the second leg below has
    /// one open.
    private func openEuropeDeck(in app: XCUIApplication) {
        let catalog = app.tabBars.buttons["Catalog"]
        XCTAssertTrue(catalog.waitForExistence(timeout: 60), app.debugDescription)
        catalog.tap()
        let deck = app.buttons["catalog.deck.EUROPE"]
        XCTAssertTrue(deck.waitForExistence(timeout: 60), app.debugDescription)
        deck.tap()
        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 60),
            app.debugDescription
        )
    }

    /// The identifier of the first country the open deck lists, which is the
    /// identifier the current release gives that card.
    private func firstCountryIdentifier(in app: XCUIApplication) -> String {
        let rows = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'deck.country.'"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        return rows.firstMatch.identifier
    }

    private func answerTwoCards(in app: XCUIApplication) {
        app.buttons["study.start"].tap()
        for _ in 0..<2 {
            let reveal = app.buttons["study.reveal"]
            XCTAssertTrue(reveal.waitForExistence(timeout: 60), app.debugDescription)
            reveal.tap()
            XCTAssertTrue(
                app.staticTexts["study.answer"].waitForExistence(timeout: 10),
                app.debugDescription
            )
            app.descendants(matching: .any).matching(identifier: "study.card")
                .firstMatch.swipeRight()
        }
        XCTAssertTrue(
            app.buttons["study.close"].waitForExistence(timeout: 15),
            app.debugDescription
        )
    }

    private func openProgress(in app: XCUIApplication) {
        let progress = app.tabBars.buttons["Progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 30), app.debugDescription)
        progress.tap()
    }

    /// The whole-picture counts, which are a combined element: how SwiftUI
    /// classifies one is its business, not a promise the product makes.
    private func counts(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(identifier: "progress.deck.ALL.counts")
            .firstMatch
    }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
