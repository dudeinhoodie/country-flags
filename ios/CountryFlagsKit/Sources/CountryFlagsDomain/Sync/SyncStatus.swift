import Foundation

/// What asked for a synchronisation.
///
/// The trigger is carried through so a status line can explain itself and a
/// test can prove that two of them coalesce into one run rather than racing.
public enum SyncTrigger: String, Hashable, Sendable, CaseIterable {
    case launch
    case foreground
    /// The network monitor saw a path come back. It is a hint that a request is
    /// worth trying, never proof that the API is reachable.
    case networkAvailable
    case pullToRefresh
    case sessionCompleted
    /// The system granted background time. Nothing promises when, or whether,
    /// this arrives.
    case background
}

public enum SyncPhase: Hashable, Sendable {
    case idle
    case syncing
}

/// Why a synchronisation did not finish.
public enum SyncFailure: Hashable, Sendable {
    case offline
    /// The backend answered but refused. Retrying is meaningful.
    case recoverable(code: String)
    /// The account is not allowed to sync, so retrying cannot help.
    case unauthorized
    /// The device was told to slow down. The delay is honoured before the next
    /// attempt rather than ignored.
    case throttled(retryAfter: TimeInterval?)

    public var isRetryable: Bool {
        switch self {
        case .offline, .recoverable, .throttled: true
        case .unauthorized: false
        }
    }
}

/// The compact status the UI is allowed to show.
///
/// The coordinator publishes this and writes canonical data into the
/// repositories; it never owns view state, so a screen reads the store for
/// content and this only to explain what the device is doing.
public struct SyncStatus: Hashable, Sendable {
    public let phase: SyncPhase
    public let lastSuccessAt: Date?
    public let lastFailure: SyncFailure?
    /// How much work is still waiting to reach the backend. A guest always has
    /// a number here and never a failure: their work is stored and simply not
    /// sent yet.
    public let pendingCount: Int
    /// True while nothing can be sent because the device is a guest. Sign-in
    /// and import own the transition.
    public let isHeldForGuest: Bool

    public init(
        phase: SyncPhase = .idle,
        lastSuccessAt: Date? = nil,
        lastFailure: SyncFailure? = nil,
        pendingCount: Int = 0,
        isHeldForGuest: Bool = false
    ) {
        self.phase = phase
        self.lastSuccessAt = lastSuccessAt
        self.lastFailure = lastFailure
        self.pendingCount = pendingCount
        self.isHeldForGuest = isHeldForGuest
    }

    /// Whether a screen should say anything at all. A healthy device that is up
    /// to date says nothing.
    public var isWorthReporting: Bool {
        lastFailure != nil || pendingCount > 0
    }
}

/// What the app may ask of synchronisation.
///
/// Declared in the domain so a view model can trigger a sync without importing
/// the layer that owns the HTTP client and the store.
public protocol SyncCoordinating: Sendable {
    func status(for scope: AccountScope) async -> SyncStatus
    /// Runs, or joins, a synchronisation of one scope.
    @discardableResult
    func synchronize(scope: AccountScope, trigger: SyncTrigger) async -> SyncStatus
    /// Puts work claimed by a run that died back in the queue.
    func recoverInterruptedWork(for scope: AccountScope) async
}
