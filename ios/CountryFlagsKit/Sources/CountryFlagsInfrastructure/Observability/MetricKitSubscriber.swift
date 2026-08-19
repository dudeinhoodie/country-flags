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
    public func receive(payloadJSON: String, generatedAt: Date) async {
        await coordinator.record(payload: payloadJSON, generatedAt: generatedAt)
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
            for (json, generatedAt) in payloads {
                let text = String(decoding: json, as: UTF8.self)
                Task { [coordinator] in
                    await coordinator.record(payload: text, generatedAt: generatedAt)
                }
            }
        }
    }
#endif
