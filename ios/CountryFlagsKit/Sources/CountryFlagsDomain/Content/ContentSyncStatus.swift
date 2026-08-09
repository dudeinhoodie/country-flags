import Foundation

/// Why a content sync did not finish, in terms a screen can act on.
///
/// The distinction that matters to the user is whether waiting helps. Being
/// offline is not an error to apologise for when the catalog is already on the
/// device; a refused response is something they can retry.
public enum ContentSyncFailure: Hashable, Sendable {
    /// The device could not reach the backend.
    case offline
    /// The backend answered, but not with content. Retrying is meaningful.
    case recoverable(code: String)
    /// This build is older than the release the manifest requires. Retrying
    /// cannot help; the user has to update.
    case clientTooOld(minimumVersion: String)

    public var isRetryable: Bool {
        switch self {
        case .offline, .recoverable: true
        case .clientTooOld: false
        }
    }
}

/// What a screen may ask of the content sync.
///
/// The protocol lives here so the feature layer can drive a sync without
/// importing the layer that owns the HTTP client: a view model that could see
/// a generated DTO is a view model that will eventually render one.
public protocol ContentSynchronizing: Sendable {
    func currentStatus() async -> ContentSyncStatus
    /// Publishes what the stored release already implies, before any request.
    func restoreStatus() async
    @discardableResult
    func synchronize(locale: String) async -> ContentSyncStatus
}

public enum ContentSyncPhase: Hashable, Sendable {
    case idle
    /// The first release is being downloaded; there is nothing to show yet
    /// unless a previous version is already stored.
    case bootstrapping
    /// A release is already stored and is being brought up to date.
    case refreshing
}

/// What the app knows about the freshness of its content.
public struct ContentSyncStatus: Hashable, Sendable {
    public let phase: ContentSyncPhase
    public let lastSuccessAt: Date?
    public let lastFailure: ContentSyncFailure?
    public let contentVersion: String?

    public init(
        phase: ContentSyncPhase = .idle,
        lastSuccessAt: Date? = nil,
        lastFailure: ContentSyncFailure? = nil,
        contentVersion: String? = nil
    ) {
        self.phase = phase
        self.lastSuccessAt = lastSuccessAt
        self.lastFailure = lastFailure
        self.contentVersion = contentVersion
    }

    /// Content older than this is shown with a stale marker. It is deliberately
    /// generous: the catalog changes when the product publishes a release, not
    /// on a schedule, so nagging about a day-old catalog would be noise.
    public static let stalenessThreshold: TimeInterval = 7 * 24 * 60 * 60

    public func isStale(now: Date) -> Bool {
        guard let lastSuccessAt else { return true }
        return now.timeIntervalSince(lastSuccessAt) > Self.stalenessThreshold
    }
}

/// What a content screen draws.
///
/// The states are derived here rather than in each view so "offline with a
/// cached catalog still shows the catalog" is one rule with one test, instead
/// of a condition repeated on Home, Catalog and Deck Details.
public enum ContentViewState<Value: Sendable>: Sendable {
    /// Nothing stored yet and a sync is running.
    case loading
    /// A sync finished and the release genuinely contains nothing.
    case empty
    /// Content is available. `isStale` marks it as possibly outdated, and
    /// `failure` is set when the latest refresh did not land — neither blocks
    /// navigation.
    case ready(Value, isStale: Bool, failure: ContentSyncFailure?)
    /// Nothing stored and the sync failed, so there is nothing to navigate.
    case failed(ContentSyncFailure)

    /// - Parameter isEmpty: whether the stored value has anything to show.
    ///   Passed in because only the caller knows what "empty" means for its own
    ///   value type.
    public static func resolve(
        value: Value,
        isEmpty: Bool,
        status: ContentSyncStatus,
        now: Date
    ) -> ContentViewState<Value> {
        guard isEmpty else {
            return .ready(value, isStale: status.isStale(now: now), failure: status.lastFailure)
        }

        if let failure = status.lastFailure {
            return .failed(failure)
        }
        // Nothing stored, nothing failed: either a sync is running or one has
        // never been asked for, and both are a wait rather than an empty
        // catalog the user should believe.
        return status.lastSuccessAt == nil ? .loading : .empty
    }
}

extension ContentViewState: Equatable where Value: Equatable {}
