import Foundation

/// How many owed cards a day still has room for (backend spec §7.4, #438).
///
/// The server deals no more due cards in a day than fifty distinct cards
/// answered leaves room for, oldest debt first, and new cards on top of that.
/// A guest's sessions are composed on the device and nothing asks the server,
/// so the device keeps the same count; Home reads it too, to know when the day
/// is done.
///
/// A card has a state only once it has been answered, so a state written on
/// the day is a card answered that day. It is an approximation in one place: a
/// server-side replay that rewrites states (a scheduler migration) makes them
/// all look answered on the day it ran.
public enum DailyReviewAllowance {
    /// Distinct cards a learner may review in a day before owed cards stop
    /// being dealt.
    public static let limit = 50

    /// Distinct cards answered on the day `now` falls in.
    public static func answeredToday(
        _ states: [CardStateRecord],
        now: Date,
        calendar: Calendar = .current
    ) -> Int {
        states.count { calendar.isDate($0.updatedAt, inSameDayAs: now) }
    }

    /// Owed cards the day still has room for; zero once the limit is reached.
    public static func remaining(
        _ states: [CardStateRecord],
        now: Date,
        calendar: Calendar = .current
    ) -> Int {
        max(0, limit - answeredToday(states, now: now, calendar: calendar))
    }
}
