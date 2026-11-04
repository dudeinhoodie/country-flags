import Foundation

import CountryFlagsDomain

/// The words of Home's review card (#503, #510), kept out of the view so the
/// rule that could break them without a sound — a button promising more cards
/// than the sitting deals — can be pinned without drawing the screen.
enum DuePaneCopy {
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

    /// The button says what it deals: "Повторить первые 10" when the
    /// sitting takes fewer than the count beside the title (#510), so the
    /// count is not read as what a tap clears. A sitting that takes
    /// everything, or one the day has no room left for, keeps the plain word.
    static func action(due: Int, dealt: Int) -> String {
        dealt > 0 && dealt < due ? L10n.homeReviewFirst(dealt) : L10n.homeReview
    }
}
