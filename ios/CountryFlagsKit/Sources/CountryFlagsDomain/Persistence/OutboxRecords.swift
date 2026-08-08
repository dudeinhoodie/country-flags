import Foundation

/// What the outbox is currently doing with an operation.
public enum OutboxState: String, Hashable, Sendable, CaseIterable {
    case pending
    case inFlight
    case synced
    case retryableFailure
    /// The backend refused the operation for good. It stays in the store so it
    /// can be shown in diagnostics; dropping it silently would hide lost work.
    case permanentFailure
}

/// What kind of work is queued.
public enum OutboxOperationKind: String, Hashable, Sendable, CaseIterable {
    case studySession
    case reviewBatch
    case settingsUpdate
    case analyticsBatch
    case guestImport
}

/// One unit of work waiting to reach the backend.
///
/// The payload is stored already encoded: the outbox has to survive an app
/// update that changed the in-memory types, and re-encoding at send time would
/// let a later build change what an earlier build promised to send.
public struct OutboxOperationRecord: Hashable, Sendable {
    public let id: UUID
    public let kind: OutboxOperationKind
    /// Groups operations that must reach the backend in order, such as a
    /// session and the reviews that depend on it.
    public let dependencyID: UUID?
    public let payload: Data
    public let state: OutboxState
    public let attemptCount: Int
    public let lastFailureCode: String?
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUID,
        kind: OutboxOperationKind,
        dependencyID: UUID?,
        payload: Data,
        state: OutboxState,
        attemptCount: Int,
        lastFailureCode: String?,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.kind = kind
        self.dependencyID = dependencyID
        self.payload = payload
        self.state = state
        self.attemptCount = attemptCount
        self.lastFailureCode = lastFailureCode
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Where a feed was last read.
public struct SyncCursorRecord: Hashable, Sendable {
    public enum Feed: String, Hashable, Sendable, CaseIterable {
        case contentChanges
        case userChanges
    }

    public let feed: Feed
    public let cursor: String
    public let updatedAt: Date

    public init(feed: Feed, cursor: String, updatedAt: Date) {
        self.feed = feed
        self.cursor = cursor
        self.updatedAt = updatedAt
    }
}

/// A product analytics event waiting for its batch.
public struct AnalyticsEventRecord: Hashable, Sendable {
    public let id: UUID
    public let name: String
    public let schemaVersion: Int
    public let payload: Data
    /// Optional events are dropped when consent is withdrawn; a required one
    /// is not.
    public let isOptional: Bool
    public let occurredAt: Date

    public init(
        id: UUID,
        name: String,
        schemaVersion: Int,
        payload: Data,
        isOptional: Bool,
        occurredAt: Date
    ) {
        self.id = id
        self.name = name
        self.schemaVersion = schemaVersion
        self.payload = payload
        self.isOptional = isOptional
        self.occurredAt = occurredAt
    }
}

public struct PrivacySettingsRecord: Hashable, Sendable {
    public let productAnalyticsStatus: String
    public let diagnosticsStatus: String
    public let policyVersion: String
    public let version: Int
    public let updatedAt: Date

    public init(
        productAnalyticsStatus: String,
        diagnosticsStatus: String,
        policyVersion: String,
        version: Int,
        updatedAt: Date
    ) {
        self.productAnalyticsStatus = productAnalyticsStatus
        self.diagnosticsStatus = diagnosticsStatus
        self.policyVersion = policyVersion
        self.version = version
        self.updatedAt = updatedAt
    }
}

/// A diagnostic report captured on device and not yet delivered.
public struct PendingDiagnosticReportRecord: Hashable, Sendable {
    public let id: UUID
    public let kind: String
    public let payload: Data
    public let capturedAt: Date

    public init(id: UUID, kind: String, payload: Data, capturedAt: Date) {
        self.id = id
        self.kind = kind
        self.payload = payload
        self.capturedAt = capturedAt
    }
}
