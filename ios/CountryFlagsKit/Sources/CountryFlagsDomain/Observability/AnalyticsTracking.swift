import Foundation

/// The events this build is allowed to send.
///
/// Product analytics is a registry, not a free-form string: an event nobody
/// declared cannot be measured, and an event assembled at a call site is how
/// personal data ends up in a funnel. The rest of the registry arrives with the
/// analytics work package; feature exposure is here because a flag that is used
/// without being measured makes an experiment unreadable.
public enum AnalyticsEventName: String, Hashable, Sendable, CaseIterable {
    case featureExposed = "feature_exposed"
}

/// The value types an event parameter may hold.
public enum AnalyticsValue: Hashable, Sendable, Codable {
    case string(String)
    case number(Double)
    case boolean(Bool)
}

public struct AnalyticsEvent: Hashable, Sendable {
    public let name: AnalyticsEventName
    public let parameters: [String: AnalyticsValue]
    public let occurredAt: Date

    public init(
        name: AnalyticsEventName,
        parameters: [String: AnalyticsValue] = [:],
        occurredAt: Date
    ) {
        self.name = name
        self.parameters = parameters
        self.occurredAt = occurredAt
    }
}

/// Who the events belong to.
///
/// The opaque targeting key and nothing else: an analytics backend has no use
/// for an email or a provider subject, and asking it to hold one makes every
/// later deletion request harder.
public struct AnalyticsIdentity: Hashable, Sendable {
    public let targetingKey: String
    public let isAuthenticated: Bool

    public init(targetingKey: String, isAuthenticated: Bool) {
        self.targetingKey = targetingKey
        self.isAuthenticated = isAuthenticated
    }
}

public protocol AnalyticsTracking: Sendable {
    func track(_ event: AnalyticsEvent) async
    func setIdentity(_ identity: AnalyticsIdentity?) async
    func flush() async
}

/// The default until a provider is chosen. Nothing leaves the device.
public struct NoOpAnalyticsTracker: AnalyticsTracking {
    public init() {}

    public func track(_ event: AnalyticsEvent) async {}
    public func setIdentity(_ identity: AnalyticsIdentity?) async {}
    public func flush() async {}
}

/// Reports that a person actually saw a flagged feature.
///
/// Reading a flag is not exposure. A screen asks for `study.multiple_choice`
/// on every render, and counting those would drown the one moment that matters
/// — the session that really started in that mode. The recorder therefore
/// reports the first use per key and configuration and stays quiet afterwards.
public actor FeatureExposureRecorder {
    private struct Exposure: Hashable {
        let key: String
        let variant: String
        let configVersion: String?
    }

    private let analytics: any AnalyticsTracking
    private let dates: any DateProviding
    private var reported: Set<Exposure> = []

    public init(analytics: any AnalyticsTracking, dates: any DateProviding) {
        self.analytics = analytics
        self.dates = dates
    }

    /// - Returns: whether an event was sent, which is what the deduplication
    ///   test asserts.
    @discardableResult
    public func recordExposure(of resolution: FeatureFlagResolution) async -> Bool {
        let exposure = Exposure(
            key: resolution.key,
            variant: resolution.variant,
            configVersion: resolution.configVersion
        )
        guard !reported.contains(exposure) else { return false }
        reported.insert(exposure)

        var parameters: [String: AnalyticsValue] = [
            "flag_key": .string(resolution.key),
            "variant": .string(resolution.variant),
            "source": .string(resolution.source.rawValue),
        ]
        if let configVersion = resolution.configVersion {
            parameters["config_version"] = .string(configVersion)
        }
        await analytics.track(
            AnalyticsEvent(
                name: .featureExposed,
                parameters: parameters,
                occurredAt: dates.now()
            )
        )
        return true
    }

    /// A new account is a new assignment, so the memory of what was already
    /// reported does not carry over.
    public func reset() {
        reported.removeAll()
    }
}
