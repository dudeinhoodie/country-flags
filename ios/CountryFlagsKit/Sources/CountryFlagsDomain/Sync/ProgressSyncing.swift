import Foundation

/// What one download of the canonical progress brought back.
///
/// The three documents travel together because they are read together: a
/// screen that showed new deck numbers beside yesterday's achievements would be
/// reporting two different moments as one.
public struct ProgressSnapshot: Sendable, Equatable {
    public let decks: [DeckProgressRecord]
    public let achievements: [AchievementRecord]
    public let settings: UserSettingsRecord?

    public init(
        decks: [DeckProgressRecord],
        achievements: [AchievementRecord],
        settings: UserSettingsRecord?
    ) {
        self.decks = decks
        self.achievements = achievements
        self.settings = settings
    }
}

/// Brings the server's view of a learner's progress back to the device.
public protocol ProgressDownloading: Sendable {
    func download() async throws -> ProgressSnapshot
}

/// What the server did with a settings change.
public enum SettingsUpdateOutcome: Sendable, Equatable {
    case updated(UserSettingsRecord)
    /// The version this device based its change on is no longer current. The
    /// server's settings come back with it, so the caller can reload rather
    /// than retry blindly and overwrite whatever the other device wrote.
    case conflict(UserSettingsRecord?)
}

/// Offers a settings change to the server under optimistic concurrency.
///
/// Declared here rather than beside its implementation so a screen can depend
/// on the rule without depending on the transport that carries it.
public protocol SettingsSyncing: Sendable {
    func update(_ settings: UserSettingsRecord) async throws -> SettingsUpdateOutcome
}
