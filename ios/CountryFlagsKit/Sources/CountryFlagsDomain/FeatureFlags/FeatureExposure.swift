import Foundation

/// Where a variant was shown. The list is closed so a screen name invented at a
/// call site can never reach telemetry.
public enum FeatureExposureSurface: String, Hashable, Sendable, CaseIterable {
    case onboarding
    case home
    case catalog
    case deckDetails
    case studySession
    case sessionResult
    case progress
    case settings
}

/// The record that a user actually saw a variant.
public struct FeatureExposure: Hashable, Sendable {
    public let flagKey: String
    public let variant: String
    /// Ties the exposure to the configuration that produced it, so an outcome
    /// measured later can be attributed to the same assignment.
    public let configVersion: String
    public let surface: FeatureExposureSurface
    public let occurredAt: Date

    public init(
        flagKey: String,
        variant: String,
        configVersion: String,
        surface: FeatureExposureSurface,
        occurredAt: Date
    ) {
        self.flagKey = flagKey
        self.variant = variant
        self.configVersion = configVersion
        self.surface = surface
        self.occurredAt = occurredAt
    }
}

/// Receives exposures. The delivery pipeline is a later work package; until it
/// exists the default implementation drops them.
public protocol FeatureExposureReporting: Sendable {
    func report(_ exposure: FeatureExposure) async
}

public struct NoOpFeatureExposureReporter: FeatureExposureReporting {
    public init() {}

    public func report(_ exposure: FeatureExposure) async {}
}

/// Turns "this variant was displayed" into at most one exposure.
///
/// Reading a flag is not an exposure: a screen may evaluate the same key on
/// every redraw, and one event per read would drown the experiment in noise and
/// make the denominator meaningless. The recorder therefore keeps the
/// combinations it has already reported for the running configuration and drops
/// the repeats.
public actor FeatureExposureRecorder {
    private struct Reported: Hashable {
        let flagKey: String
        let variant: String
        let configVersion: String
        let surface: FeatureExposureSurface
    }

    private let reporter: any FeatureExposureReporting
    private let dates: any DateProviding
    private var reported: Set<Reported> = []

    public init(reporter: any FeatureExposureReporting, dates: any DateProviding) {
        self.reporter = reporter
        self.dates = dates
    }

    /// Reports the first display of a variant on a surface for the current
    /// configuration version. A later configuration re-arms the exposure,
    /// because the assignment it describes may be a different one.
    public func recordExposure(
        flagKey: String,
        variant: String,
        configVersion: String,
        surface: FeatureExposureSurface
    ) async {
        let candidate = Reported(
            flagKey: flagKey,
            variant: variant,
            configVersion: configVersion,
            surface: surface
        )
        guard reported.insert(candidate).inserted else { return }

        await reporter.report(
            FeatureExposure(
                flagKey: flagKey,
                variant: variant,
                configVersion: configVersion,
                surface: surface,
                occurredAt: dates.now()
            )
        )
    }

    /// Signing out or switching accounts starts a new assignment history.
    public func reset() {
        reported.removeAll()
    }
}
