import Foundation

/// Why an event may be collected. A `DENIED` category stops an event from ever
/// being queued rather than from being uploaded later.
public enum AnalyticsConsentCategory: String, Hashable, Sendable, CaseIterable {
    case essentialOperations = "essential_operations"
    case productAnalytics = "product_analytics"
    case crashDiagnostics = "crash_diagnostics"
    case experiments
}

/// The registered event names.
///
/// The list mirrors `contracts/registries/analytics-events.json`. An event that
/// is not here cannot be constructed, which is what keeps an arbitrary screen
/// or error name out of the pipeline.
public enum AnalyticsEventName: String, Hashable, Sendable, CaseIterable {
    case onboardingCompleted = "onboarding.completed"
    case deckOpened = "deck.opened"
    case studySessionStarted = "study.session_started"
    case studySessionCompleted = "study.session_completed"
    case studySessionAbandoned = "study.session_abandoned"
    case achievementEarned = "achievement.earned"
    case featureExposed = "feature.exposed"
    case authCompleted = "auth.completed"
    case syncCompleted = "sync.completed"
    case contentUpdateCompleted = "content.update_completed"

    public var consentCategory: AnalyticsConsentCategory {
        switch self {
        case .syncCompleted, .contentUpdateCompleted: .essentialOperations
        default: .productAnalytics
        }
    }

    /// Operational events must not end up in a product funnel by accident.
    public var isOperational: Bool {
        consentCategory == .essentialOperations
    }
}

public enum AnalyticsPropertyValue: Hashable, Sendable {
    case string(String)
    case integer(Int)
    case double(Double)
    case boolean(Bool)
}

/// One product or operational event.
///
/// The identifier is assigned here, before anything is queued, so a retry that
/// the device cannot see the outcome of stays one event for the backend.
public struct AnalyticsEvent: Hashable, Sendable {
    public let id: UUID
    public let name: AnalyticsEventName
    public let schemaVersion: Int
    public let occurredAt: Date
    public let properties: [String: AnalyticsPropertyValue]

    public init(
        id: UUID,
        name: AnalyticsEventName,
        schemaVersion: Int = 1,
        occurredAt: Date,
        properties: [String: AnalyticsPropertyValue] = [:]
    ) {
        self.id = id
        self.name = name
        self.schemaVersion = schemaVersion
        self.occurredAt = occurredAt
        self.properties = properties
    }

    public var consentCategory: AnalyticsConsentCategory { name.consentCategory }
}

/// Who the events belong to.
///
/// The identifier is a UUID generated on the device. Making it a `UUID` rather
/// than a `String` is deliberate: an email, a provider subject or an internal
/// user identifier cannot be put here even by mistake.
public struct AnalyticsIdentity: Hashable, Sendable {
    public let analyticsSubjectID: UUID

    public init(analyticsSubjectID: UUID) {
        self.analyticsSubjectID = analyticsSubjectID
    }
}

public protocol AnalyticsTracking: Sendable {
    func track(_ event: AnalyticsEvent) async
    /// `nil` on sign-out: the next events belong to a new anonymous session.
    func setIdentity(_ identity: AnalyticsIdentity?) async
    func flush() async
}

/// The default. No provider is integrated, and analytics must never be the
/// reason a card does not advance or a session does not finish.
public struct NoOpAnalyticsTracker: AnalyticsTracking {
    public init() {}

    public func track(_ event: AnalyticsEvent) async {}
    public func setIdentity(_ identity: AnalyticsIdentity?) async {}
    public func flush() async {}
}
