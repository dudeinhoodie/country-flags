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

    private let learning: any LearningRepository
    private let scopes: any AccountScopeResolving
    private let sync: (any SettingsSyncing)?
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
        dates: any DateProviding = SystemDateProvider()
    ) {
        self.learning = learning
        self.scopes = scopes
        self.sync = sync
        self.dates = dates
        settings = Self.defaults(now: dates.now())
    }

    public func load() async {
        let scope = await scopes.currentScope()
        if let stored = try? await learning.settings(for: scope) {
            settings = stored
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

    /// Reminders are a preference, not a promise: turning them on records the
    /// wish, and the permission and the schedule belong to the notification
    /// work that has not landed. Nothing here claims a delivery time.
    public func setRemindersEnabled(_ isEnabled: Bool) async {
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
