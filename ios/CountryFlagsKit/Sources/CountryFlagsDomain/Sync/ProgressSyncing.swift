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
    /// What the server says is waiting right now, or nil when this release of
    /// the backend did not answer. Optional rather than zeroed: a queue nobody
    /// counted is not an empty queue.
    public let dueSummary: DueSummaryRecord?

    public init(
        decks: [DeckProgressRecord],
        achievements: [AchievementRecord],
        settings: UserSettingsRecord?,
        dueSummary: DueSummaryRecord? = nil
    ) {
        self.decks = decks
        self.achievements = achievements
        self.settings = settings
        self.dueSummary = dueSummary
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

/// What the backend did with a request to delete an account's progress.
///
/// The status is the contract's: the deletion may be finished by the time the
/// call returns, or accepted and still running. Either way it has been decided
/// — which is what lets the device clear its own copy.
public struct ProgressDeletionOutcome: Hashable, Sendable {
    public enum Status: String, Hashable, Sendable {
        case pending = "PENDING"
        case completed = "COMPLETED"
    }

    public let operationID: UUID
    public let status: Status
    public let requestedAt: Date

    public init(operationID: UUID, status: Status, requestedAt: Date) {
        self.operationID = operationID
        self.status = status
        self.requestedAt = requestedAt
    }
}

/// Deletes an account's learning progress, keeping the account itself.
///
/// The signed-in session is the whole gate: the fresh per-operation proof
/// this used to carry dead-ended the flow on devices where reauthentication
/// could not complete, and progress — unlike the account — is recoverable
/// by studying again.
public protocol ProgressClearing: Sendable {
    func clearProgress() async throws -> ProgressDeletionOutcome
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
