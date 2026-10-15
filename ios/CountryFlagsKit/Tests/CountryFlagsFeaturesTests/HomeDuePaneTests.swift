import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// Home's review pane says what a repeat will do (#503).
///
/// The arithmetic is checked for the promise the lines make — the parts add up
/// to the figure, and a card is never named twice — and the copy for the
/// mechanism that could break it silently: a plural rule not applied, a part
/// printed as a zero, a button promising more than the sitting deals. The
/// wording itself is free to change.
final class HomeDuePaneTests: XCTestCase {
    private let instant = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: - An account's breakdown

    /// The issue's own example: eighteen due, four one answer from learned.
    /// They come out of the review part, where a card two answers in nearly
    /// always stands.
    func testTheLearnableCardsComeOutOfTheReviewPart() {
        let breakdown = DueBreakdown(
            summary: summary(overdue: 9, learning: 7, relearning: 2, learnable: 4)
        )

        XCTAssertEqual(breakdown, DueBreakdown(learnable: 4, waiting: 9, onReview: 5))
        XCTAssertEqual(breakdown.learnable + breakdown.waiting + breakdown.onReview, 18)
    }

    /// A card that missed between its answers, or lapsed, stands on the steps
    /// with two answers behind it. The backend sends one count, so what the
    /// review part cannot cover comes out of the waiting part — and the parts
    /// still add up to the figure.
    func testLearnableCardsBeyondTheReviewPartComeOutOfTheWaitingPart() {
        let breakdown = DueBreakdown(
            summary: summary(overdue: 1, learning: 3, relearning: 1, learnable: 3)
        )

        XCTAssertEqual(breakdown, DueBreakdown(learnable: 3, waiting: 2, onReview: 0))
        XCTAssertEqual(breakdown.learnable + breakdown.waiting + breakdown.onReview, 5)
    }

    /// A count larger than the queue — which the backend never sends — cannot
    /// make the parts overrun the figure.
    func testTheLearnableCountNeverOverrunsTheFigure() {
        let breakdown = DueBreakdown(
            summary: summary(overdue: 1, learning: 1, relearning: 0, learnable: 9)
        )

        XCTAssertEqual(breakdown, DueBreakdown(learnable: 2, waiting: 0, onReview: 0))
    }

    /// A backend that predates the count promises nothing: no green line, and
    /// the rest of the figure is the summary's states as they are.
    func testASummaryWithoutTheCountPromisesNothing() {
        let breakdown = DueBreakdown(
            summary: summary(overdue: 2, learning: 9, relearning: 0, learnable: nil)
        )

        XCTAssertEqual(breakdown, DueBreakdown(learnable: 0, waiting: 9, onReview: 2))
        XCTAssertNil(DuePaneCopy.learnableLine(breakdown))
    }

    // MARK: - A guest's breakdown

    /// The device knows each card's state, so nothing is attributed: the
    /// learnable cards are on the steps, the review part is what is in review,
    /// and the waiting part is the rest.
    func testAGuestsBreakdownIsTheDevicesOwnCount() {
        let breakdown = DueBreakdown(
            local: LocalDeckProgress(
                deckID: UUID(),
                totalCards: 195,
                startedCards: 30,
                learnedCards: 10,
                dueCards: 12,
                dueLearnableCards: 3,
                dueReviewCards: 4
            )
        )

        XCTAssertEqual(breakdown, DueBreakdown(learnable: 3, waiting: 5, onReview: 4))
    }

    // MARK: - The lines

    /// "Новых" and "просрочено" are gone; the two parts are joined, and a part
    /// with nothing in it is left out rather than printed as a zero.
    func testTheQuietLineLeavesOutAnEmptyPart() throws {
        let both = try XCTUnwrap(
            DuePaneCopy.restLine(DueBreakdown(learnable: 4, waiting: 9, onReview: 5))
        )
        let waitingOnly = try XCTUnwrap(
            DuePaneCopy.restLine(DueBreakdown(learnable: 0, waiting: 9, onReview: 0))
        )

        XCTAssertTrue(both.contains("9"), both)
        XCTAssertTrue(both.contains("5"), both)
        XCTAssertTrue(both.contains(" · "), both)
        XCTAssertFalse(both.contains("4"), "the learnable cards are the green line's: \(both)")
        XCTAssertFalse(waitingOnly.contains(" · "), waitingOnly)
        XCTAssertFalse(waitingOnly.contains("0"), waitingOnly)
        XCTAssertNil(DuePaneCopy.restLine(DueBreakdown(learnable: 3, waiting: 0, onReview: 0)))
        XCTAssertNil(DuePaneCopy.restLine(nil))
    }

    /// The green line appears only while something due is one answer away.
    func testTheGreenLineAppearsOnlyWithSomethingToFinish() throws {
        let line = try XCTUnwrap(
            DuePaneCopy.learnableLine(DueBreakdown(learnable: 4, waiting: 0, onReview: 0))
        )

        XCTAssertTrue(line.contains("4"), line)
        XCTAssertNil(DuePaneCopy.learnableLine(DueBreakdown(learnable: 0, waiting: 3, onReview: 1)))
        XCTAssertNil(DuePaneCopy.learnableLine(nil))
    }

    /// "1 станет", "4 станут", "1 ждёт", "9 ждут": declined by the count.
    /// `String(format:)` would format the number into one arbitrary variant.
    func testTheLinesDeclineWithTheirCount() {
        for line in [L10n.homeDueLearnable, L10n.homeDueWaiting] {
            let one = line(1)
            let several = line(5)

            XCTAssertTrue(one.contains("1"), one)
            XCTAssertTrue(several.contains("5"), several)
            XCTAssertFalse(several.contains("%"), "the format reached the screen: \(several)")
            XCTAssertFalse(several.contains("home."), "the key reached the screen: \(several)")
            XCTAssertNotEqual(
                one.replacingOccurrences(of: "1", with: ""),
                several.replacingOccurrences(of: "5", with: ""),
                "the count is formatted in but the plural rule is not applied"
            )
        }
    }

    // MARK: - The button

    /// "Повторить 10 из 18": the sitting takes the stored size, and the button
    /// says so rather than leaving the figure to imply a tap clears it.
    func testTheButtonSaysWhatTheSittingDealsWhenItIsLessThanTheQueue() {
        let dealt = DuePaneCopy.dealtCount(due: 18, sessionSize: 10, dayAllowance: nil)
        let label = DuePaneCopy.action(due: 18, dealt: dealt)

        XCTAssertEqual(dealt, 10)
        XCTAssertEqual(label, L10n.homeReviewSome(10, of: 18))
        XCTAssertTrue(label.contains("10"), label)
        XCTAssertTrue(label.contains("18"), label)
        XCTAssertNotEqual(label, L10n.homeReview)
    }

    /// A sitting that takes the whole queue keeps the plain word.
    func testTheButtonIsPlainWhenTheSittingTakesEverything() {
        let dealt = DuePaneCopy.dealtCount(due: 6, sessionSize: 10, dayAllowance: nil)

        XCTAssertEqual(dealt, 6)
        XCTAssertEqual(DuePaneCopy.action(due: 6, dealt: dealt), L10n.homeReview)
    }

    /// A guest's sitting is composed on the device and stops at the day's
    /// room, which the guest's figure is not cut to.
    func testAGuestsSittingStopsAtTheDaysRoom() {
        XCTAssertEqual(DuePaneCopy.dealtCount(due: 120, sessionSize: 20, dayAllowance: 7), 7)
        XCTAssertEqual(DuePaneCopy.dealtCount(due: 120, sessionSize: 20, dayAllowance: 0), 0)
        // Nothing to deal is no promise of "0 of 120": the plain word stays.
        XCTAssertEqual(DuePaneCopy.action(due: 120, dealt: 0), L10n.homeReview)
    }

    // MARK: - Harness

    private func summary(
        overdue: Int,
        learning: Int,
        relearning: Int,
        learnable: Int?
    ) -> DueSummaryRecord {
        DueSummaryRecord(
            overdue: overdue,
            learning: learning,
            relearning: relearning,
            review: 40,
            newCards: 220,
            totalDue: overdue + learning + relearning,
            learnableCards: learnable,
            serverTime: instant
        )
    }
}
