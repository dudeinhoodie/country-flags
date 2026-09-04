import Foundation

/// Tells the app when a network path has come back.
///
/// It is a trigger, never proof: a satisfied path means a request is worth
/// trying, not that the API is reachable. Nothing here decides whether the app
/// is "online" — the request that follows decides that. Only the transition
/// is reported: a run that failed for want of a network is what the listener
/// wants to repeat, and the moment the path is satisfied again is the one
/// time repeating it is worth the request.
public protocol NetworkReachabilityObserving: Sendable {
    /// Calls back each time a usable path appears, having been unavailable.
    func startObserving(_ onAvailable: @escaping @Sendable () -> Void) async
    func stopObserving() async
}
