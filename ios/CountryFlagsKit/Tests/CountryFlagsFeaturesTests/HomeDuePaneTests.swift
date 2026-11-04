import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// Home's review card (#503, #510).
///
/// The breakdown's arithmetic is checked for the promise it makes — the parts
/// add up to the figure, and a card is never named twice — and the button for
/// the mechanism that could break it silently: promising more than the sitting
/// deals. The wording itself is free to change. The lines that printed the
/// breakdown under the figure left Home on 2026-11-04 (#510); the breakdown
/// stays in the progress store.
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

    /// A backend that predates the count promises nothing: no card counts as
    /// learnable, and the rest of the figure is the summary's states as they
    /// are.
    func testASummaryWithoutTheCountPromisesNothing() {
        let breakdown = DueBreakdown(
            summary: summary(overdue: 2, learning: 9, relearning: 0, learnable: nil)
        )

        XCTAssertEqual(breakdown, DueBreakdown(learnable: 0, waiting: 9, onReview: 2))
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

    // MARK: - The button

    /// "Повторить первые 10": the sitting takes the stored size, and the
    /// button says so rather than leaving the count beside the title to imply
    /// a tap clears it.
    func testTheButtonSaysWhatTheSittingDealsWhenItIsLessThanTheQueue() {
        let dealt = DuePaneCopy.dealtCount(due: 18, sessionSize: 10, dayAllowance: nil)
        let label = DuePaneCopy.action(due: 18, dealt: dealt)

        XCTAssertEqual(dealt, 10)
        XCTAssertEqual(label, L10n.homeReviewFirst(10))
        XCTAssertTrue(label.contains("10"), label)
        XCTAssertFalse(label.contains("%"), "the format reached the screen: \(label)")
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
        // Nothing to deal is no promise of "the first 0": the plain word stays.
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
