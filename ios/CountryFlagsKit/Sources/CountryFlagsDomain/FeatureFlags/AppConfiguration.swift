import Foundation

/// The evaluated configuration of one refresh: the flags and the advertising
/// policy arrive together, because the backend evaluates them against the same
/// context and version.
public struct AppConfiguration: Hashable, Sendable {
    public let snapshot: FeatureFlagSnapshot
    public let advertising: AdvertisingPolicy

    public init(snapshot: FeatureFlagSnapshot, advertising: AdvertisingPolicy) {
        self.snapshot = snapshot
        self.advertising = advertising
    }
}

public enum AppConfigurationFetchResult: Hashable, Sendable {
    case updated(AppConfiguration)
    /// The backend answered `304`. The values already on the device are current
    /// and only their freshness window moves.
    case notModified(revalidatedUntil: Date)
}

/// Fetches the evaluated configuration. Implemented against the generated
/// client in the infrastructure module, substituted in tests.
public protocol AppConfigurationFetching: Sendable {
    func fetch(
        context: FeatureFlagContext,
        entityTag: String?
    ) async throws -> AppConfigurationFetchResult
}

/// Keeps the last snapshot across launches.
///
/// The read is synchronous because it happens while the first screen is being
/// built: waiting for storage would be waiting for something the app already
/// has.
public protocol FeatureFlagSnapshotCaching: Sendable {
    func snapshot(forContextKey contextKey: String) -> FeatureFlagSnapshot?
    func store(_ snapshot: FeatureFlagSnapshot)
    func removeSnapshot(forContextKey contextKey: String)
}
