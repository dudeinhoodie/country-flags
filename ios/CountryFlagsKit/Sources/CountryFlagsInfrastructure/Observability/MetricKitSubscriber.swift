import Foundation

import CountryFlagsDomain

#if canImport(MetricKit)
    import MetricKit
#endif

/// Receives what MetricKit delivers and hands it to the coordinator.
///
/// MetricKit calls back once a day, usually shortly after a launch, with the
/// previous period's metrics and any diagnostics — hangs, crashes, disk writes.
/// The subscriber does nothing with them itself: scrubbing, compression, size
/// limits and consent all live in `DiagnosticsCoordinator`, so this class stays
/// the thin edge that the system framework talks to.
///
/// It is a class rather than a struct because `MXMetricManager` holds its
/// subscribers weakly and calls them back on its own queue.
public final class MetricKitSubscriber: NSObject, Sendable {
    private let coordinator: DiagnosticsCoordinator
    private let dates: any DateProviding

    public init(coordinator: DiagnosticsCoordinator, dates: any DateProviding = SystemDateProvider())
    {
        self.coordinator = coordinator
        self.dates = dates
        super.init()
    }

    /// Starts listening. Safe to call once per launch; the manager keeps a
    /// weak reference, so the caller has to hold this object.
    public func start() {
        #if canImport(MetricKit) && !targetEnvironment(simulator)
            MXMetricManager.shared.add(self)
        #endif
    }

    public func stop() {
        #if canImport(MetricKit) && !targetEnvironment(simulator)
            MXMetricManager.shared.remove(self)
        #endif
    }

    /// The seam the tests use: the same path a real payload takes, without a
    /// framework that only delivers on a device once a day.
    ///
    /// A delivered payload is sent straight away rather than on the next
    /// launch. MetricKit delivers shortly after a launch, which is after the
    /// launch's own flush has run, so waiting for the next flush meant a day's
    /// report left a day late, and a crash loop's report never left at all.
    /// Consent is the coordinator's to check, at both steps.
    public func receive(payloadJSON: String, generatedAt: Date) async {
        guard await coordinator.record(payload: payloadJSON, generatedAt: generatedAt) else {
            return
        }
        await coordinator.flush()
    }
}

#if canImport(MetricKit) && !targetEnvironment(simulator)
    extension MetricKitSubscriber: MXMetricManagerSubscriber {
        public func didReceive(_ payloads: [MXMetricPayload]) {
            handle(payloads.map { ($0.jsonRepresentation(), $0.timeStampEnd) })
        }

        public func didReceive(_ payloads: [MXDiagnosticPayload]) {
            handle(payloads.map { ($0.jsonRepresentation(), $0.timeStampEnd) })
        }

        private func handle(_ payloads: [(Data, Date)]) {
            let texts = payloads.map { (String(decoding: $0.0, as: UTF8.self), $0.1) }
            Task { [self] in
                for (text, generatedAt) in texts {
                    await receive(payloadJSON: text, generatedAt: generatedAt)
                }
            }
        }
    }
#endif
