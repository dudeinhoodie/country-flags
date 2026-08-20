import Foundation

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

/// The product's own analytics surface.
///
/// The events it accepts are the registry's — see `AnalyticsEvent`, whose
/// initialiser is private — so this protocol cannot be handed something nobody
/// declared. Implementations decide what happens next: the live one filters by
/// consent and queues; the NoOp one keeps the same rules and drops the result.
public protocol AnalyticsTracking: Sendable {
    func track(_ event: AnalyticsEvent) async
    func setIdentity(_ identity: AnalyticsIdentity?) async
    func flush() async
}

/// The default when nothing is wired: nothing leaves the device, and nothing
/// is stored either.
///
/// It is deliberately not a silent success in disguise — the policy that
/// matters (consent filtering, redaction, the typed registry) lives above this
/// protocol rather than inside an implementation of it, so a build running the
/// NoOp tracker still refuses to collect what it may not collect.
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
/// reports the first use per key, variant and configuration and stays quiet
/// afterwards.
public actor FeatureExposureRecorder {
    private struct Exposure: Hashable {
        let key: String
        let variant: String
        let configVersion: String?
        let surface: String
    }

    private let analytics: any AnalyticsTracking
    private let dates: any DateProviding
    private var reported: Set<Exposure> = []

    public init(analytics: any AnalyticsTracking, dates: any DateProviding) {
        self.analytics = analytics
        self.dates = dates
    }

    /// - Parameter surface: where the variant was shown, so an exposure can be
    ///   read against the screen it happened on.
    /// - Returns: whether an event was sent, which is what the deduplication
    ///   test asserts.
    ///
    /// The experiment identifier is the flag key: this product has no separate
    /// experiment registry, and a flag is the unit an assignment is made
    /// against. The configuration the assignment came from rides in the event
    /// envelope's context rather than in a property.
    @discardableResult
    public func recordExposure(
        of resolution: FeatureFlagResolution,
        surface: String
    ) async -> Bool {
        let exposure = Exposure(
            key: resolution.key,
            variant: resolution.variant,
            configVersion: resolution.configVersion,
            surface: surface
        )
        guard !reported.contains(exposure) else { return false }
        reported.insert(exposure)

        await analytics.track(
            AnalyticsEvent.featureExposed(
                flagKey: resolution.key,
                variant: resolution.variant,
                experimentId: resolution.key,
                surface: surface,
                at: dates.now()
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
