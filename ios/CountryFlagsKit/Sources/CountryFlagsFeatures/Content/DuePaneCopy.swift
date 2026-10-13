import Foundation

import CountryFlagsDomain

/// The words of Home's review pane (#503), kept out of the view so the rules
/// that could break them without a sound — a part printed as a zero, a button
/// promising more cards than the sitting deals — can be pinned without
/// drawing the screen.
enum DuePaneCopy {
    /// The green line, while anything due is one correct answer from learned:
    /// what a repeat started now can finish.
    static func learnableLine(_ breakdown: DueBreakdown?) -> String? {
        guard let breakdown, breakdown.learnable > 0 else { return nil }
        return L10n.homeDueLearnable(breakdown.learnable)
    }

    /// The quiet line: the rest of the figure, in the words of the model —
    /// the cards waiting for their next answer and the cards on review.
    ///
    /// Never new cards: a repeat deals none of them, and counting every
    /// untouched card under the figure made a line that did not add up to it.
    /// Never "overdue" either: the line names the stages a card goes through
    /// on its way to learned, not the scheduler's bookkeeping.
    static func restLine(_ breakdown: DueBreakdown?) -> String? {
        guard let breakdown else { return nil }
        var parts: [String] = []
        if breakdown.waiting > 0 { parts.append(L10n.homeDueWaiting(breakdown.waiting)) }
        if breakdown.onReview > 0 { parts.append(L10n.homeDueOnReview(breakdown.onReview)) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// How many cards a repeat started now deals: the stored size of one
    /// sitting, and no more than the queue holds.
    ///
    /// - Parameter dayAllowance: owed cards the day still has room for, when
    ///   the device composes the sitting and the figure is not already cut to
    ///   the day — a guest's. An account's figure is the backend's, counted
    ///   against the day's ceiling already, so it passes nil.
    static func dealtCount(due: Int, sessionSize: Int, dayAllowance: Int?) -> Int {
        max(0, min(due, sessionSize, dayAllowance ?? Int.max))
    }

    /// The button says what it deals: "Повторить 10 из 18" when the sitting
    /// takes fewer than the figure over it, so the figure is not read as what
    /// a tap clears. A sitting that takes everything, or one the day has no
    /// room left for, keeps the plain word.
    static func action(due: Int, dealt: Int) -> String {
        dealt > 0 && dealt < due ? L10n.homeReviewSome(dealt, of: due) : L10n.homeReview
    }
}
