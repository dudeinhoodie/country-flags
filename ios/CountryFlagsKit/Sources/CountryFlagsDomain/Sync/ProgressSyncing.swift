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

/// One account-scoped change from the backend's stream.
///
/// The stream is the canonical card states in arrival order: every review on
/// any device appends one. A tombstone is contractual but never published
/// today — clearing progress rotates the whole stream instead.
public struct CardStateChange: Hashable, Sendable {
    public enum Operation: Hashable, Sendable {
        case upsert
        case tombstone
    }

    public let operation: Operation
    public let cardID: UUID
    /// The canonical state; absent on a tombstone.
    public let state: CardStateRecord?

    public init(operation: Operation, cardID: UUID, state: CardStateRecord?) {
        self.operation = operation
        self.cardID = cardID
        self.state = state
    }
}

/// One page of the stream, with the cursor that names the next.
public struct UserChangesPage: Hashable, Sendable {
    public let changes: [CardStateChange]
    public let nextCursor: String
    public let hasMore: Bool

    public init(changes: [CardStateChange], nextCursor: String, hasMore: Bool) {
        self.changes = changes
        self.nextCursor = nextCursor
        self.hasMore = hasMore
    }
}

/// Reads the account's change stream. A nil cursor asks from the beginning,
/// which is how a fresh device inherits everything an account already knows.
public protocol UserChangesDownloading: Sendable {
    func changes(after cursor: String?, limit: Int) async throws -> UserChangesPage
}
