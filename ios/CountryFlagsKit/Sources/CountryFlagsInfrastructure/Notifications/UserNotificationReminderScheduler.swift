import Foundation
import UserNotifications

import CountryFlagsDomain

/// The daily reminder, as iOS schedules it.
///
/// One request, one identifier: adding a second would leave yesterday's hour
/// firing beside today's, and a repeating calendar trigger is what makes the
/// reminder survive a relaunch without the app rescheduling on every launch.
///
/// Nothing here decides whether a reminder is wanted — that is the settings
/// store's business — and nothing here fails loudly: a notification that could
/// not be scheduled must never interrupt studying, which needs no permission
/// at all.
public struct UserNotificationReminderScheduler: ReminderScheduling {
    /// Stable, so scheduling again replaces the pending request rather than
    /// adding one beside it.
    static let requestIdentifier = "com.countryflags.reminder.daily"

    private let center: any UserNotificationScheduling
    private let logger: any AppLogging

    public init(logger: any AppLogging = NoOpLogger()) {
        self.init(center: SystemNotificationCenter(), logger: logger)
    }

    init(center: any UserNotificationScheduling, logger: any AppLogging = NoOpLogger()) {
        self.center = center
        self.logger = logger
    }

    public func authorization() async -> ReminderAuthorization {
        Self.authorization(from: await center.currentAuthorizationStatus())
    }

    public func requestAuthorization() async -> ReminderAuthorization {
        do {
            // Alerts and sounds only: a badge would claim a number nobody
            // computed, and the queue's size is on the first screen already.
            let granted = try await center.askForAuthorization(options: [.alert, .sound])
            return granted ? .authorized : .denied
        } catch {
            // The system refused to even ask. Treated as a refusal rather than
            // as "not determined", so the screen offers System Settings
            // instead of a button that will do nothing again.
            logger.log(.notice, .study, "The system declined to ask about notifications")
            return .denied
        }
    }

    public func schedule(_ schedule: ReminderSchedule, saying content: ReminderContent) async {
        var components = DateComponents()
        components.hour = schedule.hour
        components.minute = schedule.minute

        let notification = UNMutableNotificationContent()
        notification.title = content.title
        notification.body = content.body
        notification.sound = .default

        let request = UNNotificationRequest(
            identifier: Self.requestIdentifier,
            content: notification,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        )
        do {
            // Replacing rather than cancelling first: adding a request under an
            // existing identifier is itself the replacement, and a cancel in
            // between would leave a window with no reminder at all.
            try await center.addRequest(request)
        } catch {
            logger.log(.notice, .study, "The daily reminder could not be scheduled")
        }
    }

    public func cancel() async {
        await center.removeRequests(identifiers: [Self.requestIdentifier])
    }

    private static func authorization(
        from status: UNAuthorizationStatus
    ) -> ReminderAuthorization {
        switch status {
        case .notDetermined:
            .notDetermined
        // Provisional delivery is quiet but real: a reminder does arrive, so
        // the screen must not offer to ask again.
        case .authorized, .provisional, .ephemeral:
            .authorized
        case .denied:
            .denied
        @unknown default:
            // A state this build does not know is treated as a refusal: the
            // safe reading is the one that does not promise a delivery.
            .denied
        }
    }
}

/// The slice of `UNUserNotificationCenter` this app uses.
///
/// The centre itself cannot be built in a test — it asserts on a bundle
/// identifier the test host does not have — so the scheduler talks to this
/// instead and the tests hand it a double.
/// The names differ from the centre's own so that the conforming type below
/// forwards rather than calls itself.
protocol UserNotificationScheduling: Sendable {
    func currentAuthorizationStatus() async -> UNAuthorizationStatus
    func askForAuthorization(options: UNAuthorizationOptions) async throws -> Bool
    func addRequest(_ request: UNNotificationRequest) async throws
    func removeRequests(identifiers: [String]) async
}

/// The real centre, reached through `current()` at each call rather than held:
/// nothing is stored, so the adapter is `Sendable` without any claim about the
/// centre's own concurrency.
struct SystemNotificationCenter: UserNotificationScheduling {
    func currentAuthorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func askForAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: options)
    }

    func addRequest(_ request: UNNotificationRequest) async throws {
        try await UNUserNotificationCenter.current().add(request)
    }

    func removeRequests(identifiers: [String]) async {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: identifiers)
    }
}

/// Where the reminder's hour lives between launches: a device preference, not
/// account data, so it stays out of the account-scoped store.
public struct UserDefaultsReminderPreferenceStore: ReminderPreferenceStoring, @unchecked Sendable {
    private static let hourKey = "reminder.hour"
    private static let minuteKey = "reminder.minute"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func reminderSchedule() -> ReminderSchedule? {
        // `object(forKey:)` rather than `integer(forKey:)`: midnight is a
        // legitimate hour, and a missing key reads as zero.
        guard let hour = defaults.object(forKey: Self.hourKey) as? Int,
            let minute = defaults.object(forKey: Self.minuteKey) as? Int
        else {
            return nil
        }
        return ReminderSchedule(hour: hour, minute: minute)
    }

    public func store(reminderSchedule: ReminderSchedule) {
        defaults.set(reminderSchedule.hour, forKey: Self.hourKey)
        defaults.set(reminderSchedule.minute, forKey: Self.minuteKey)
    }
}
