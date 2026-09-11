import XCTest

/// The guest study flow end to end: start a session from a deck, answer every
/// card, see the result, and resume in the middle after a relaunch.
@MainActor
final class StudySessionUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testAGuestAnswersEveryCardAndSeesTheResult() {
        let app = launch(arguments: ["-reset-store"])
        openDeck(in: app)

        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 10), app.debugDescription)
        start.tap()

        // Answer until the session ends. The count is not hard-coded: the mock
        // release decides how many cards a deck has, and a test that pinned it
        // would break every time the mock gains a country. The result screen
        // is recognised by its exit button — the redesigned screen carries no
        // title.
        let result = app.buttons["study.result.done"]
        var answered = 0
        while !result.exists && answered < 30 {
            let reveal = app.buttons["study.reveal"]
            // The deck is the published release, so selecting a session is real
            // work; this waits as long as a bootstrap does.
            XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
            // The answer must not be on screen before the flip.
            XCTAssertFalse(app.staticTexts["study.answer"].exists)
            reveal.tap()

            XCTAssertTrue(
                app.staticTexts["study.answer"].waitForExistence(timeout: 5),
                app.debugDescription
            )
            app.descendants(matching: .any).matching(identifier: "study.card")
                .firstMatch.swipeRight()
            answered += 1
        }

        XCTAssertGreaterThan(answered, 0)
        XCTAssertTrue(result.waitForExistence(timeout: 10), app.debugDescription)
        // Matched by identifier across every element type: how SwiftUI
        // classifies the combined score element is its business.
        let score = app.descendants(matching: .any)
            .matching(identifier: "study.result.answered")
            .firstMatch
        XCTAssertTrue(score.exists)
        XCTAssertFalse(score.label.isEmpty)
        // A string catalog key must never reach the interface.
        XCTAssertFalse(score.label.contains("study.result"))
    }

    /// The durability requirement: an answer that was saved survives a
    /// relaunch, and the session continues where it stopped rather than
    /// starting over.
    func testARelaunchResumesTheSessionInPlace() {
        // The guest identity is pinned for this test. An unsigned build has no
        // keychain entitlement, so the installation identifier the scope is
        // built from would not survive the relaunch, and every launch would
        // study as a different guest.
        let identity = ["-installation-id", "11111111-2222-4333-8444-555555555555"]
        let app = launch(arguments: ["-reset-store"] + identity)
        openDeck(in: app)
        app.buttons["study.start"].tap()

        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 10))
        let firstPosition = app.staticTexts["study.progress"].label
        app.buttons["study.reveal"].tap()
        app.descendants(matching: .any).matching(identifier: "study.card")
            .firstMatch.swipeRight()

        // The second card is up, which means the first answer committed.
        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 10))
        let secondPosition = app.staticTexts["study.progress"].label
        XCTAssertNotEqual(firstPosition, secondPosition)
        app.terminate()

        // The same store and the same guest, so the session is still open —
        // and Home leads with it: the today pane stands in its "continue"
        // state, which is the product's own way back into the run. The deck
        // pane is not rendered while a session is waiting.
        let relaunched = launch(arguments: identity)
        let resume = relaunched.buttons["home.continue"]
        XCTAssertTrue(resume.waitForExistence(timeout: 30), relaunched.debugDescription)
        resume.tap()

        XCTAssertTrue(relaunched.buttons["study.reveal"].waitForExistence(timeout: 15))
        XCTAssertEqual(
            relaunched.staticTexts["study.progress"].label,
            secondPosition,
            relaunched.debugDescription
        )
    }

    /// The gesture the deck exists for: a card that has been turned over is
    /// answered by throwing it, and the session moves on. The buttons are
    /// tested above; this is the path a hand actually takes.
    func testARevealedCardIsAnsweredBySwipingIt() {
        let app = launch(arguments: ["-reset-store"])
        openDeck(in: app)
        app.buttons["study.start"].tap()

        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 30), app.debugDescription)
        let firstPosition = app.staticTexts["study.progress"].label

        // Matched by identifier across every element type: how SwiftUI
        // classifies an accessibility container is its business, not a promise
        // the product makes.
        let card = app.descendants(matching: .any)
            .matching(identifier: "study.card")
            .firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10), app.debugDescription)
        // Answering without turning the card over is the case the deck exists
        // for: a flag recognised on sight is thrown away, not read.
        card.swipeRight()

        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertNotEqual(
            app.staticTexts["study.progress"].label,
            firstPosition,
            app.debugDescription
        )
    }

    /// Opens the hero deck and waits for the screen behind it to be drawable.
    ///
    /// The wait is on the deck screen rather than on the row: the catalogue is
    /// on screen from the first frame now that the app seeds itself from the
    /// bundle, so a tap can land before the deck's own screen has read its
    /// cards. Tapping `study.start` without waiting for it used to work only
    /// because nothing was tappable until the whole release had downloaded.
    /// IOS-E2E-ST-01: the size chosen in the settings is the size studied.
    ///
    /// A preference that is stored, shown back, and then ignored by the one
    /// thing it exists to govern is worse than no preference: the learner
    /// asked for a short sitting and got a long one, and nothing on screen
    /// admits it. The counter is where the sitting says how long it is, so
    /// that is where this is checked.
    func testTheSessionSizeChosenInSettingsIsTheSizeOfTheSitting() {
        let identity = ["-installation-id", "0d63f7a2-b418-4e59-9c27-5a80e6d14b73"]
        let app = launch(arguments: ["-reset-store"] + identity)

        let settings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 60), app.debugDescription)
        settings.tap()
        let five = app.buttons["settings.sessionSize.5"]
        XCTAssertTrue(five.waitForExistence(timeout: 20), app.debugDescription)
        five.tap()
        XCTAssertTrue(five.isSelected, app.debugDescription)
        app.navigationBars.buttons.element(boundBy: 0).tap()

        openDeck(in: app)
        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 30), app.debugDescription)
        start.tap()

        // "1 / 5": the second half is the sitting's own account of its length.
        let counter = app.staticTexts["study.progress"]
        XCTAssertTrue(counter.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(
            counter.label.hasSuffix("5"),
            "A sitting asked for five cards must be five long, not \(counter.label)\n"
                + app.debugDescription
        )
    }

    /// IOS-E2E-ST-14: a sitting nobody got right is not a success.
    ///
    /// Every card is thrown `Again`, which is the learner saying they knew
    /// none of them. Congratulating that would be the app lying to somebody
    /// about their own work — the most expensive kind of encouragement,
    /// because it is the kind they will believe.
    func testASittingAnsweredEntirelyWithAgainIsNotCongratulated() {
        let app = launch(arguments: ["-reset-store"])
        openDeck(in: app)
        XCTAssertTrue(app.buttons["study.start"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["study.start"].tap()

        // Thrown left until the sitting gives up asking. `Again` puts a card
        // back, so this ends when the session decides it has, not when a
        // count says so.
        let result = app.staticTexts["study.result.title"]
        var thrown = 0
        while !result.exists && thrown < 60 {
            guard app.buttons["study.reveal"].waitForExistence(timeout: 20) else { break }
            app.buttons["study.reveal"].tap()
            guard app.staticTexts["study.answer"].waitForExistence(timeout: 10) else { break }
            card(in: app).swipeLeft()
            thrown += 1
        }

        XCTAssertTrue(result.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(
            app.staticTexts["Excellent!"].exists,
            "Nothing was remembered, so nothing may be celebrated\n\(app.debugDescription)"
        )
        let remembered = app.staticTexts["study.result.answered"]
        XCTAssertTrue(remembered.exists, app.debugDescription)
        XCTAssertTrue(
            remembered.label.hasPrefix("0 "),
            "A sitting with no correct answers must report none: \(remembered.label)\n"
                + app.debugDescription
        )
    }

    /// IOS-E2E-ST-03: a short deck is short, not padded.
    ///
    /// The special areas deck holds fewer cards than the largest sitting, so
    /// asking for twenty from it is asking for something that does not exist.
    /// The honest answer is every card it has, once. Repeating one to reach a
    /// number would quietly tell the learner they had studied twenty things.
    func testADeckSmallerThanTheSessionSizeIsNotPaddedWithRepeats() {
        let app = launch(
            arguments: [
                "-reset-store", "-owned-deck",
                "-feature-flag", "commerce.paid_decks.discovery.enabled=true",
            ]
        )

        let settings = app.buttons["root.shell.openSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 60), app.debugDescription)
        settings.tap()
        let twenty = app.buttons["settings.sessionSize.20"]
        XCTAssertTrue(twenty.waitForExistence(timeout: 20), app.debugDescription)
        twenty.tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()

        let catalog = app.tabBars.buttons["Catalog"]
        XCTAssertTrue(catalog.waitForExistence(timeout: 30), app.debugDescription)
        let deck = app.buttons["catalog.deck.SPECIAL_AREAS"]
        for _ in 0..<3 {
            catalog.tap()
            if deck.waitForExistence(timeout: 20) { break }
        }
        XCTAssertTrue(deck.waitForExistence(timeout: 20), app.debugDescription)
        deck.tap()

        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 30), app.debugDescription)
        start.tap()

        // Every card accepted, so each one is asked exactly once and the
        // sitting is over when the deck is.
        var answers: [String] = []
        let result = app.staticTexts["study.result.title"]
        while !result.exists && answers.count < 30 {
            guard app.buttons["study.reveal"].waitForExistence(timeout: 20) else { break }
            app.buttons["study.reveal"].tap()
            guard app.staticTexts["study.answer"].waitForExistence(timeout: 10) else { break }
            answers.append(app.staticTexts["study.answer"].label)
            card(in: app).swipeRight()
        }

        XCTAssertTrue(result.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertEqual(
            answers.count,
            Set(answers).count,
            "A deck shorter than the sitting must not repeat a card to fill it: \(answers)\n"
                + app.debugDescription
        )
        XCTAssertLessThan(
            answers.count,
            20,
            "The sitting cannot be longer than the deck it was drawn from\n"
                + app.debugDescription
        )
    }

    /// IOS-E2E-ST-10: opening a sitting and walking away is not studying.
    ///
    /// Nothing was answered, so there is nothing to count and nothing to send.
    /// The second half matters more than the first: a device that reported
    /// work it never did would tell the learner their answers were safe on a
    /// server that had never heard of them, and the sync line is where that
    /// lie would be told.
    func testASittingClosedBeforeTheFirstAnswerLeavesNothingBehind() {
        let app = launch(arguments: ["-reset-store"])
        openDeck(in: app)
        XCTAssertTrue(app.buttons["study.start"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["study.start"].tap()

        // On the first card, and away again without answering it.
        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["study.close"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()

        let progress = app.tabBars.buttons["Progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 30), app.debugDescription)
        progress.tap()
        XCTAssertTrue(
            app.staticTexts["progress.empty"].waitForExistence(timeout: 30),
            "An unanswered sitting is not progress\n\(app.debugDescription)"
        )
        XCTAssertFalse(
            app.descendants(matching: .any)["sync.status"].exists,
            "Nothing was answered, so nothing may be reported as queued or sent\n"
                + app.debugDescription
        )
    }

    /// IOS-E2E-ST-11: the deck screen keeps its own way back in.
    ///
    /// Somebody who walked in through the catalog should not have to go to
    /// Home to pick up where they left off, and the offer has to be the same
    /// sitting rather than a fresh one — the button changes what it says for
    /// exactly that reason.
    func testTheDeckScreenOffersTheUnfinishedSittingRatherThanANewOne() {
        let identity = ["-installation-id", "2f5a8c31-7e94-4b06-8d52-a1c3e70f6482"]
        let app = launch(arguments: ["-reset-store"] + identity)
        openDeck(in: app)

        let start = app.buttons["study.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertEqual(start.label, "Start studying", app.debugDescription)
        start.tap()

        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["study.reveal"].tap()
        XCTAssertTrue(
            app.staticTexts["study.answer"].waitForExistence(timeout: 10),
            app.debugDescription
        )
        card(in: app).swipeRight()

        // The second card is up, so the first answer committed and the sitting
        // is unfinished.
        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 15), app.debugDescription)
        let position = app.staticTexts["study.progress"].label
        app.buttons["study.close"].tap()

        // Back on the deck screen the same button now offers the sitting.
        XCTAssertTrue(start.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertEqual(
            start.label,
            "Continue",
            "An unfinished sitting must be offered as itself, not as a new one\n"
                + app.debugDescription
        )
        start.tap()

        XCTAssertTrue(app.buttons["study.reveal"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertEqual(
            app.staticTexts["study.progress"].label,
            position,
            "Continuing must resume the position it left\n\(app.debugDescription)"
        )
    }

    /// IOS-E2E-ST-07: `Again` is a promise that the card comes back.
    ///
    /// It is the one rating that says "I did not know this", and the sitting
    /// answers it by asking again before it ends. A card thrown left and never
    /// seen again would quietly turn the honest answer into the expensive one:
    /// the learner admits they do not know a flag and the app moves on.
    ///
    /// Identity is read off the revealed answer rather than off a position,
    /// because what has to come back is the country, not a slot.
    func testAThrownAgainCardIsAskedBeforeTheSittingEnds() {
        let identity = ["-installation-id", "7d2e9b14-3c60-4a85-9f27-1b8de5a0c934"]
        let app = launch(arguments: ["-reset-store"] + identity)
        openDeck(in: app)
        XCTAssertTrue(app.buttons["study.start"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["study.start"].tap()

        // The first card, refused. Left is `Again`; the hints beside the card
        // say so, and the gesture is the answer.
        let refused = revealAnswer(in: app)
        card(in: app).swipeLeft()

        // Everything after it is accepted, so the only reason the sitting can
        // still be running is the card that was thrown back.
        var seenAgain = false
        let result = app.staticTexts["study.result.title"]
        var answered = 0
        while !result.exists && answered < 40 {
            guard app.buttons["study.reveal"].waitForExistence(timeout: 20) else { break }
            let name = revealAnswer(in: app)
            if name == refused { seenAgain = true }
            card(in: app).swipeRight()
            answered += 1
        }

        XCTAssertTrue(
            seenAgain,
            "A card thrown Again must be asked again before the sitting ends\n"
                + app.debugDescription
        )
    }

    /// Turns the card over and returns the country it was about.
    private func revealAnswer(in app: XCUIApplication) -> String {
        let reveal = app.buttons["study.reveal"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 30), app.debugDescription)
        reveal.tap()
        let answer = app.staticTexts["study.answer"]
        XCTAssertTrue(answer.waitForExistence(timeout: 10), app.debugDescription)
        return answer.label
    }

    private func card(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "study.card").firstMatch
    }

    private func openDeck(in app: XCUIApplication) {
        let deck = app.buttons["home.deck.ALL"]
        XCTAssertTrue(deck.waitForExistence(timeout: 30), app.debugDescription)
        deck.tap()
        XCTAssertTrue(
            app.buttons["study.start"].waitForExistence(timeout: 30),
            app.debugDescription
        )
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }
}
