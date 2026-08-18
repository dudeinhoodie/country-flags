import Foundation

/// What the system has decided about posting reminders.
///
/// Three states rather than a boolean, because "not asked yet" and "asked and
/// refused" lead to different screens: the first can still be asked, the second
/// can only be changed in System Settings, and an app that keeps asking a
/// refusal is an app iOS silently stops answering.
public enum ReminderAuthorization: Hashable, Sendable {
    case notDetermined
    case authorized
    case denied
}

/// One daily reminder, in the device's own local time.
///
/// The time is a device preference rather than an account setting: the
/// contract's `remindersEnabled` says whether the learner wants reminding, and
/// two devices in two timezones asking for "20:00" mean two different instants.
/// The wish syncs; the hour does not.
public struct ReminderSchedule: Hashable, Sendable {
    public let hour: Int
    public let minute: Int

    /// Early evening: after a working day and before it is too late to study.
    /// Nothing here promises the notification arrives at this minute — iOS
    /// decides delivery, and the settings screen says so.
    public static let evening = ReminderSchedule(hour: 19, minute: 0)

    public init(hour: Int, minute: Int) {
        self.hour = hour
        self.minute = minute
    }
}

/// What the reminder says when it arrives.
///
/// Supplied by the caller rather than built by the scheduler: the strings are
/// localized in the feature layer, and the layer that talks to the system must
/// not reach into a bundle it does not own.
public struct ReminderContent: Hashable, Sendable {
    public let title: String
    public let body: String

    public init(title: String, body: String) {
        self.title = title
        self.body = body
    }
}

/// Asks the system for permission and keeps the daily reminder in step with it.
///
/// Declared in the domain so the rules — a refusal is recorded rather than
/// retried, disabling cancels what was scheduled — can be tested without the
/// notification centre, which no test may touch.
public protocol ReminderScheduling: Sendable {
    func authorization() async -> ReminderAuthorization
    /// - Returns: what the system decided. A refusal is an answer rather than
    ///   an error: the app records it and stops offering to schedule.
    func requestAuthorization() async -> ReminderAuthorization
    /// Replaces whatever was scheduled with one repeating daily reminder.
    func schedule(_ schedule: ReminderSchedule, saying content: ReminderContent) async
    func cancel() async
}

/// Where the reminder's hour lives between launches.
public protocol ReminderPreferenceStoring: Sendable {
    func reminderSchedule() -> ReminderSchedule?
    func store(reminderSchedule: ReminderSchedule)
}
