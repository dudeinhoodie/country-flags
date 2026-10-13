import Foundation

import CountryFlagsDomain

/// What the day's queue is made of, in the words Home's review pane uses
/// (#503).
///
/// Three parts that add up to the figure over them: the cards one correct
/// answer from learned, the cards still on their steps waiting for the next
/// answer, and the cards on review. New cards are not a part. The repeat deals
/// none of them, and the pane used to count every untouched card in the
/// account under a figure they were no part of, so the line did not add up.
///
/// The learnable cards are said apart, in green, because they are what a
/// repeat can finish; the other two parts are the rest of the figure, so a
/// card is never named twice.
public struct DueBreakdown: Hashable, Sendable {
    /// Due cards that one more correct answer makes learned.
    public let learnable: Int
    /// Due cards on their learning or relearning steps, less the learnable.
    public let waiting: Int
    /// Due cards on review, less the learnable.
    public let onReview: Int

    public init(learnable: Int, waiting: Int, onReview: Int) {
        self.learnable = learnable
        self.waiting = waiting
        self.onReview = onReview
    }

    /// An account's, from the backend's summary: learned there is three
    /// correct answers, and the backend counts the due cards two answers in.
    ///
    /// It sends one count, not one per state, so the learnable cards are taken
    /// out of the review part first. That is where nearly all of them stand:
    /// two correct answers in a row graduate a new card to review (ADR-026).
    /// One that missed in between, or lapsed after graduating, can stand on
    /// the steps with two answers behind it, and whatever the review part
    /// cannot cover comes out of the waiting part instead. Either way the
    /// three parts add up to the figure, which is the promise the line makes.
    ///
    /// A backend that does not send the count promises nothing: the green
    /// line is absent, and the breakdown is the summary's states as they are.
    init(summary: DueSummaryRecord) {
        let steps = max(0, summary.learning + summary.relearning)
        let review = max(0, summary.overdue)
        let learnable = max(0, summary.learnableCards ?? 0)
        let fromReview = min(learnable, review)
        let fromSteps = min(learnable - fromReview, steps)
        self.init(
            learnable: fromReview + fromSteps,
            waiting: steps - fromSteps,
            onReview: review - fromReview
        )
    }

    /// A guest's, from the device's own projection of one deck: learned there
    /// is reaching review on the device's ladder, so the learnable cards are
    /// the due ones a correct answer carries into review — a learning card
    /// one rung up, or a card relearning after a lapse — and never one
    /// already in review. The device knows each card's state, so nothing has
    /// to be attributed: the waiting part is what is left of the figure.
    init(local deck: LocalDeckProgress) {
        let learnable = max(0, deck.dueLearnableCards)
        let review = max(0, deck.dueReviewCards)
        self.init(
            learnable: learnable,
            waiting: max(0, deck.dueCards - learnable - review),
            onReview: review
        )
    }
}
