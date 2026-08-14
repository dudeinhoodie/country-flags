import Foundation

/// The work a guest import hands to the account: every session and every
/// review this device made before it had anybody to attribute them to.
///
/// The records go as they are — the same UUIDs, the same timestamps — because
/// an import is the same work changing owner, not new work. The backend
/// recognises repeats by those identifiers, which is what makes the request
/// safe to send twice.
public struct GuestImportPayload: Sendable {
    public let migrationID: UUID
    /// The guest installation this work was made under. The backend uses it to
    /// recognise a replay of the same archive.
    public let sourceInstallID: String
    public let sessions: [StudySessionRecord]
    public let reviews: [ReviewEventRecord]

    public init(
        migrationID: UUID,
        sourceInstallID: String,
        sessions: [StudySessionRecord],
        reviews: [ReviewEventRecord]
    ) {
        self.migrationID = migrationID
        self.sourceInstallID = sourceInstallID
        self.sessions = sessions
        self.reviews = reviews
    }
}

/// Where the backend stands with an import. The raw values are the contract's.
public enum GuestImportStatus: String, Hashable, Sendable, CaseIterable {
    case pending = "PENDING"
    case applied = "APPLIED"
    /// Some events were rejected — retired cards, unknown revisions — and the
    /// rest were taken. The rejected work cannot become importable by asking
    /// again, so a partial import is a finished one.
    case partial = "PARTIAL"
    case failed = "FAILED"

    /// Whether the backend is done with the archive, whichever way.
    public var isSettled: Bool { self != .pending }
}

/// The backend's answer about one import.
public struct GuestImportResultRecord: Hashable, Sendable {
    public let migrationID: UUID
    public let status: GuestImportStatus
    public let acceptedEventCount: Int
    public let duplicateEventCount: Int
    public let rejectedEventCount: Int
    public let completedAt: Date?

    public init(
        migrationID: UUID,
        status: GuestImportStatus,
        acceptedEventCount: Int,
        duplicateEventCount: Int,
        rejectedEventCount: Int,
        completedAt: Date?
    ) {
        self.migrationID = migrationID
        self.status = status
        self.acceptedEventCount = acceptedEventCount
        self.duplicateEventCount = duplicateEventCount
        self.rejectedEventCount = rejectedEventCount
        self.completedAt = completedAt
    }
}

/// The two calls an import is made of, separated from the transport so the
/// migration rules can be tested without a socket.
public protocol GuestImportSubmitting: Sendable {
    func submit(_ payload: GuestImportPayload) async throws -> GuestImportResultRecord
    func status(migrationID: UUID) async throws -> GuestImportResultRecord
}

/// Remembers what happened to a guest archive, across launches.
///
/// The record is what keeps the migration identifier stable through retries,
/// and what proves — on a shared device — that this archive already belongs
/// to somebody, so a second account cannot quietly inherit it.
public protocol GuestMigrationRecordStoring: Sendable {
    func record(forScopeKey scopeKey: String) async -> GuestMigrationRecord?
    func save(_ record: GuestMigrationRecord) async
}

/// How one attempt to move the guest's work ended.
public enum GuestMigrationOutcome: Hashable, Sendable {
    /// The backend has the work. The local archive has been cleaned up.
    case imported(GuestImportResultRecord)
    /// Submitted, not yet settled; the next attempt will ask again.
    case pending
    /// There was nothing to move — a clean install signing in.
    case nothingToImport
    /// The archive belongs to a different account and was left alone.
    case refused
    /// The backend looked at the archive and refused it. Retrying the same
    /// archive cannot change the answer.
    case failed(GuestImportResultRecord)
    /// The network failed mid-flight. The record is unchanged and the same
    /// request will be repeated later.
    case unavailable
}

/// Runs the import for whoever just signed in. Safe to call repeatedly: the
/// same archive submits under the same identifier until the backend settles.
public protocol GuestMigrationRunning: Sendable {
    func importGuestWork(into userID: UUID) async -> GuestMigrationOutcome
}
