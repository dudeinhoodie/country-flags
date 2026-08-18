import Foundation
import Observation

import CountryFlagsDomain

/// Reads and writes the learner's settings.
///
/// Every change is stored on the device first and only then offered to the
/// server: a setting that waited for a network round trip would not survive a
/// launch in a tunnel, and a guest — the only kind of account this build has —
/// has no server to offer it to at all.
///
/// The server owns the version. A change is sent as a base version, and a
/// refusal means another device wrote first: the answer is to take what the
/// server has rather than to retry and overwrite it, which is why a conflict
/// reloads instead of looping.
@MainActor
@Observable
public final class SettingsStore {
    public private(set) var settings: UserSettingsRecord
    /// Set when a change was refused because another device had written. The
    /// screen already shows the server's values by then; this is what explains
    /// why they are not what was just chosen.
    public private(set) var didReloadAfterConflict = false
    public private(set) var isLoaded = false
    /// What the system has decided about reminders. The stored preference says
    /// what the learner wants; this says whether iOS will honour it, and the
    /// two are shown together rather than collapsed into one switch.
    public private(set) var reminderAuthorization: ReminderAuthorization = .notDetermined
    /// The hour the reminder fires, in this device's local time. A device
    /// preference: the wish syncs with the account, the hour does not.
    public private(set) var reminderTime: ReminderSchedule = .evening

    private let learning: any LearningRepository
    private let scopes: any AccountScopeResolving
    private let sync: (any SettingsSyncing)?
    private let reminders: (any ReminderScheduling)?
    private let reminderPreferences: (any ReminderPreferenceStoring)?
    private let dates: any DateProviding

    /// The defaults a device starts from, which are also what a guest keeps
    /// until an account exists. They match the contract's own defaults so the
    /// first server answer is not seen as a change.
    public static func defaults(now: Date) -> UserSettingsRecord {
        UserSettingsRecord(
            sessionSize: 10,
            contentLocale: "en",
            defaultAnswerMode: StudyAnswerMode.selfRated.rawValue,
            extraFactTypes: [],
            soundEnabled: true,
            hapticsEnabled: true,
            remindersEnabled: false,
            version: 1,
            updatedAt: now
        )
    }

    public init(
        learning: any LearningRepository,
        scopes: any AccountScopeResolving,
        sync: (any SettingsSyncing)? = nil,
        reminders: (any ReminderScheduling)? = nil,
        reminderPreferences: (any ReminderPreferenceStoring)? = nil,
        dates: any DateProviding = SystemDateProvider()
    ) {
        self.learning = learning
        self.scopes = scopes
        self.sync = sync
        self.reminders = reminders
        self.reminderPreferences = reminderPreferences
        self.dates = dates
        settings = Self.defaults(now: dates.now())
    }

    public func load() async {
        let scope = await scopes.currentScope()
        if let stored = try? await learning.settings(for: scope) {
            settings = stored
        }
        reminderTime = reminderPreferences?.reminderSchedule() ?? .evening
        if let reminders {
            reminderAuthorization = await reminders.authorization()
            // The schedule is put back in step on every visit rather than only
            // when a switch moves: permission can be taken away in System
            // Settings, and the device that comes back from that must stop
            // claiming a reminder it can no longer deliver.
            await reconcileReminder()
        }
        isLoaded = true
    }

    public func setSessionSize(_ size: Int) async {
        await apply { current in
            UserSettingsRecord(
                sessionSize: size,
                contentLocale: current.contentLocale,
                defaultAnswerMode: current.defaultAnswerMode,
                extraFactTypes: current.extraFactTypes,
                soundEnabled: current.soundEnabled,
                hapticsEnabled: current.hapticsEnabled,
                remindersEnabled: current.remindersEnabled,
                version: current.version,
                updatedAt: current.updatedAt
            )
        }
    }

    public func setSoundEnabled(_ isEnabled: Bool) async {
        await apply { current in
            UserSettingsRecord(
                sessionSize: current.sessionSize,
                contentLocale: current.contentLocale,
                defaultAnswerMode: current.defaultAnswerMode,
                extraFactTypes: current.extraFactTypes,
                soundEnabled: isEnabled,
                hapticsEnabled: current.hapticsEnabled,
                remindersEnabled: current.remindersEnabled,
                version: current.version,
                updatedAt: current.updatedAt
            )
        }
    }

    public func setHapticsEnabled(_ isEnabled: Bool) async {
        await apply { current in
            UserSettingsRecord(
                sessionSize: current.sessionSize,
                contentLocale: current.contentLocale,
                defaultAnswerMode: current.defaultAnswerMode,
                extraFactTypes: current.extraFactTypes,
                soundEnabled: current.soundEnabled,
                hapticsEnabled: isEnabled,
                remindersEnabled: current.remindersEnabled,
                version: current.version,
                updatedAt: current.updatedAt
            )
        }
    }

    /// Turning reminders on asks the system first, and records the wish only
    /// if the system agreed.
    ///
    /// A refusal is not stored as "on": a switch left standing over a
    /// permission iOS has denied promises a reminder that will never arrive.
    /// The screen shows the refusal and the way to System Settings instead.
    /// Nothing here — granted or refused — changes what a learner may study.
    public func setRemindersEnabled(_ isEnabled: Bool) async {
        if isEnabled, let reminders {
            let authorization =
                switch reminderAuthorization {
                case .notDetermined: await reminders.requestAuthorization()
                // Asking again after a refusal is a request iOS answers
                // without showing anyone anything.
                case .denied, .authorized: reminderAuthorization
                }
            reminderAuthorization = authorization
            guard authorization == .authorized else { return }
        }

        await apply { current in
            UserSettingsRecord(
                sessionSize: current.sessionSize,
                contentLocale: current.contentLocale,
                defaultAnswerMode: current.defaultAnswerMode,
                extraFactTypes: current.extraFactTypes,
                soundEnabled: current.soundEnabled,
                hapticsEnabled: current.hapticsEnabled,
                remindersEnabled: isEnabled,
                version: current.version,
                updatedAt: current.updatedAt
            )
        }
        await reconcileReminder()
    }

    /// Asks the system, for a preference that arrived already switched on.
    ///
    /// Settings sync between devices; permission does not. A phone that reads
    /// `remindersEnabled` from the account has a wish without a permission,
    /// and the contract is explicit that the one may never be taken for the
    /// other — so the ask stays an action someone takes, never something a
    /// downloaded setting triggers on its own.
    public func requestReminderPermission() async {
        guard let reminders, reminderAuthorization == .notDetermined else { return }
        reminderAuthorization = await reminders.requestAuthorization()
        await reconcileReminder()
    }

    /// The hour is stored on the device and applied at once: a picker that
    /// moved but changed nothing until some later sync would be a lie about
    /// what was scheduled.
    public func setReminderTime(_ schedule: ReminderSchedule) async {
        guard schedule != reminderTime else { return }
        reminderTime = schedule
        reminderPreferences?.store(reminderSchedule: schedule)
        await reconcileReminder()
    }

    /// Brings what iOS holds in line with what the settings say: one daily
    /// reminder when it is both wanted and permitted, nothing otherwise.
    private func reconcileReminder() async {
        guard let reminders else { return }
        guard settings.remindersEnabled, reminderAuthorization == .authorized else {
            await reminders.cancel()
            return
        }
        await reminders.schedule(
            reminderTime,
            saying: ReminderContent(title: L10n.reminderTitle, body: L10n.reminderBody)
        )
    }

    private func apply(_ change: (UserSettingsRecord) -> UserSettingsRecord) async {
        let scope = await scopes.currentScope()
        let updated = change(settings)
        guard updated != settings else { return }
        settings = updated
        didReloadAfterConflict = false
        try? await learning.saveSettings(updated, for: scope)

        // A guest has nothing to synchronise with. The version stays where it
        // is so the first account write starts from what the server knows
        // rather than from a number this device invented.
        guard let sync, !scope.isGuest else { return }
        switch try? await sync.update(updated) {
        case .updated(let accepted):
            settings = accepted
            try? await learning.saveSettings(accepted, for: scope)
        case .conflict(let server):
            if let server {
                settings = server
                try? await learning.saveSettings(server, for: scope)
            }
            didReloadAfterConflict = true
        case nil:
            // The change is stored and will be offered again by the next sync;
            // a failed round trip must not cost the choice the user made.
            break
        }
    }

    public static let sessionSizes = [5, 10, 20]
}
