import Foundation

import CountryFlagsDomain

/// Puts the stored consent to work at launch (#452).
///
/// The collectors start every run at "nobody has been asked", which collects
/// nothing optional, and the stored answer used to reach them only when the
/// person opened the privacy settings. So a person who had agreed to share
/// diagnostics shared none: MetricKit was never subscribed to and nothing
/// waiting was ever sent. A crash loop, the case diagnostics exist for, was
/// the case that could never report itself.
///
/// The order is the point. The stored answer reaches the collectors first,
/// so MetricKit's first delivery, which usually arrives right after the
/// subscription, is judged by it rather than by "not asked" and dropped. Then
/// the subscription, then whatever earlier launches left waiting.
@MainActor
public struct TelemetryLaunch {
    private let privacy: PrivacyStore
    private let startDiagnostics: @MainActor () -> Void
    private let flushDiagnostics: @Sendable () async -> Void

    /// - Parameters:
    ///   - privacy: reads the stored answer and applies it to every collector.
    ///   - startDiagnostics: subscribes to MetricKit. What is delivered is
    ///     stored only under consent; the coordinator decides that.
    ///   - flushDiagnostics: sends what is waiting, again only under consent.
    public init(
        privacy: PrivacyStore,
        startDiagnostics: @escaping @MainActor () -> Void,
        flushDiagnostics: @escaping @Sendable () async -> Void
    ) {
        self.privacy = privacy
        self.startDiagnostics = startDiagnostics
        self.flushDiagnostics = flushDiagnostics
    }

    public func run() async {
        await privacy.load()
        startDiagnostics()
        await flushDiagnostics()
    }
}
