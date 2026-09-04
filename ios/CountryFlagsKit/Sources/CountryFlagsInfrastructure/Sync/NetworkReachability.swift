import Foundation
import Network

import CountryFlagsDomain

public actor NetworkReachabilityMonitor: NetworkReachabilityObserving {
    private let monitor: NWPathMonitor
    private let queue = DispatchQueue(label: "app.countryflags.network-monitor")
    private var isSatisfied = false
    private var isObserving = false

    public init() {
        monitor = NWPathMonitor()
    }

    public func startObserving(_ onAvailable: @escaping @Sendable () -> Void) async {
        guard !isObserving else { return }
        isObserving = true

        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { [weak self] in
                await self?.handle(satisfied: satisfied, onAvailable: onAvailable)
            }
        }
        monitor.start(queue: queue)
    }

    public func stopObserving() async {
        guard isObserving else { return }
        isObserving = false
        monitor.cancel()
    }

    /// Only the transition matters. A path that was already satisfied and stays
    /// satisfied would otherwise fire on every unrelated route change and ask
    /// for a sync that has nothing to do.
    private func handle(satisfied: Bool, onAvailable: @Sendable () -> Void) {
        defer { isSatisfied = satisfied }
        guard satisfied, !isSatisfied else { return }
        onAvailable()
    }
}

/// Answers that no device is registered.
///
/// Registration is the auth work package's. Until it lands this is the honest
/// answer: reviews are queued durably and not sent, rather than attributed to a
/// device that does not exist.
public struct UnregisteredDeviceIdentity: DeviceIdentityProviding {
    public init() {}

    public func registeredDeviceID() async -> UUID? { nil }
}
