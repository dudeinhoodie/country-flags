import Foundation

/// What the backend decided about one submitted event.
///
/// The raw values are the contract's. A duplicate counts as success for the
/// same reason a duplicate review does: the work reached the server, which is
/// what the queue existed for.
public enum AnalyticsIngestionStatus: String, Hashable, Sendable, CaseIterable {
    case accepted = "ACCEPTED"
    case duplicate = "DUPLICATE"
    case rejected = "REJECTED"

    /// Whether the queue is done with the event.
    ///
    /// A rejection is finished too — asking again would be refused again, and
    /// that is what turns a partial rejection into an infinite retry.
    public var clearsPendingEvent: Bool { true }
}

public struct AnalyticsIngestionResult: Hashable, Sendable {
    public let eventID: UUID
    public let status: AnalyticsIngestionStatus
    /// Registered code, kept for the bounded diagnostics a permanent rejection
    /// is worth. Never shown to anybody.
    public let rejectionCode: String?

    public init(eventID: UUID, status: AnalyticsIngestionStatus, rejectionCode: String?) {
        self.eventID = eventID
        self.status = status
        self.rejectionCode = rejectionCode
    }
}

public struct AnalyticsBatchOutcome: Hashable, Sendable {
    public let results: [AnalyticsIngestionResult]
    public let serverTime: Date

    public init(results: [AnalyticsIngestionResult], serverTime: Date) {
        self.results = results
        self.serverTime = serverTime
    }
}

/// Sends a batch of events. Separated from the queue so the queue's rules can
/// be tested without a socket.
public protocol AnalyticsBatchSending: Sendable {
    func send(_ events: [AnalyticsEnvelope]) async throws -> AnalyticsBatchOutcome
}

/// One event as it goes on the wire.
///
/// It is assembled once, at enqueue time, and stored that way: the context a
/// event happened in — which app version, which locale, which configuration —
/// is the context at that moment, not the one at upload time, which may be days
/// and one update later.
public struct AnalyticsEnvelope: Hashable, Sendable, Codable {
    public let eventId: UUID
    public let eventName: String
    public let schemaVersion: Int
    public let occurredAt: Date
    public let anonymousId: String
    public let sessionId: String
    public let context: Context
    public let properties: [String: AnalyticsValue]

    public struct Context: Hashable, Sendable, Codable {
        public let platform: String
        public let appVersion: String
        public let build: String
        public let locale: String
        public let featureConfigVersion: String?

        public init(
            platform: String,
            appVersion: String,
            build: String,
            locale: String,
            featureConfigVersion: String?
        ) {
            self.platform = platform
            self.appVersion = appVersion
            self.build = build
            self.locale = locale
            self.featureConfigVersion = featureConfigVersion
        }
    }

    public init(
        eventId: UUID,
        eventName: String,
        schemaVersion: Int,
        occurredAt: Date,
        anonymousId: String,
        sessionId: String,
        context: Context,
        properties: [String: AnalyticsValue]
    ) {
        self.eventId = eventId
        self.eventName = eventName
        self.schemaVersion = schemaVersion
        self.occurredAt = occurredAt
        self.anonymousId = anonymousId
        self.sessionId = sessionId
        self.context = context
        self.properties = properties
    }

    /// Builds the envelope for an event that has already passed the consent
    /// filter. The identifier is drawn here, before the event is queued, so a
    /// retry is a duplicate the backend can drop rather than a second event.
    public init(
        event: AnalyticsEvent,
        id: UUID,
        context telemetry: TelemetryContext
    ) {
        self.init(
            eventId: id,
            eventName: event.name.rawValue,
            schemaVersion: event.schemaVersion,
            occurredAt: event.occurredAt,
            anonymousId: telemetry.anonymousID,
            sessionId: telemetry.sessionID,
            context: Context(
                platform: telemetry.platform,
                appVersion: telemetry.appVersion,
                build: telemetry.build,
                locale: telemetry.locale,
                featureConfigVersion: telemetry.featureConfigVersion
            ),
            properties: event.properties
        )
    }
}

/// The limits the queue keeps itself inside.
///
/// A queue without them is a queue that grows until the device notices: a phone
/// offline for a week must not hand the backend a month of history, and an
/// event nobody will ever look at is not worth the storage it sits in.
public struct AnalyticsQueuePolicy: Hashable, Sendable {
    /// The most events one request carries. The batch schema's own ceiling.
    public let batchSize: Int
    /// The most events the device keeps. Oldest go first when it overflows —
    /// the newest are the ones still worth explaining.
    public let maximumStoredEvents: Int
    /// How long an unsent event stays worth sending.
    public let timeToLive: TimeInterval

    public init(
        batchSize: Int = 50,
        maximumStoredEvents: Int = 500,
        timeToLive: TimeInterval = 7 * 24 * 3600
    ) {
        self.batchSize = batchSize
        self.maximumStoredEvents = maximumStoredEvents
        self.timeToLive = timeToLive
    }

    public static let standard = AnalyticsQueuePolicy()
}
