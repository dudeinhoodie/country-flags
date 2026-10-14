/// When coming back to the app is worth a check (#506).
///
/// The scene turns active far more often than anyone comes back to the app.
/// It goes inactive under Notification Centre, Control Centre, a Face ID
/// prompt or a peek at the app switcher, and is active again the moment that
/// is let go. Each of those used to run the whole foreground pass. Only a
/// return from the background counts now, and only after long enough away
/// for the answer to have moved.
///
/// A rule of its own, apart from the view that applies it, so the decision
/// can be tested without a scene.
enum ForegroundCheck {
    /// The shortest time in the background that makes coming back check.
    ///
    /// A minute. What the check looks for moves on a scale of hours: cards
    /// come due again hours after they were answered, the day's allowance
    /// resets at midnight, and an answer given on another device takes
    /// picking that device up. A minute is enough to read a message, take a
    /// call or look something up in another app and come back, and none of
    /// that changes anything here. A learner who wants the answer sooner
    /// still has the pull.
    static let minimumAway: Duration = .seconds(60)

    /// Whether this return to `.active` runs the foreground check.
    ///
    /// - Parameters:
    ///   - wentToBackground: Whether the scene reached `.background` since it
    ///     was last active. Without it the return is from an `.inactive`
    ///     spell, which leaves the app on screen the whole time.
    ///   - away: How long ago the scene went to the background.
    ///   - threshold: The shortest absence that counts.
    static func isDue(
        wentToBackground: Bool,
        away: Duration,
        threshold: Duration = minimumAway
    ) -> Bool {
        wentToBackground && away >= threshold
    }
}
