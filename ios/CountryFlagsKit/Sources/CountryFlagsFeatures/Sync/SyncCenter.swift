import Foundation
import Observation

import CountryFlagsDomain

/// A store that re-reads itself once new canonical data has landed.
///
/// The one signal screens used to have to guess at. A view that watched for
/// the right moments needed a list of them — appeared, returned, sync moved,
/// came back from the background — and every new path meant another entry.
@MainActor
public protocol CanonicalDataObserving: AnyObject {
    /// A run has finished and whatever it brought home is in the
    /// repositories. `succeeded` is the difference between "the backend
    /// answered, and this is the answer" and "the backend did not answer" —
    /// which a store cannot tell from an empty result on its own.
    func canonicalDataDidLand(succeeded: Bool) async
}

/// The app's single entry point into synchronisation.
///
/// Screens ask this to sync and read its status; the coordinator underneath
/// owns the queue and writes canonical data into the repositories. Keeping the
/// two apart is what stops a view from holding sync state that the store should
/// be the source of.
@MainActor
@Observable
public final class SyncCenter {
    public private(set) var status = SyncStatus()

    private let coordinator: any SyncCoordinating
    private let scopes: any AccountScopeResolving
    private let analytics: (any AnalyticsTracking)?
    private let dates: any DateProviding
    /// Told once, after each run, that the canonical data moved. This is the
    /// single "the numbers changed" signal in the app: one publisher, and no
    /// screen deciding for itself when to read again.
    private var observers: [any CanonicalDataObserving] = []
    /// Whether the launch's recovery and first run have already happened.
    private var hasStarted = false

    public init(
        coordinator: any SyncCoordinating,
        scopes: any AccountScopeResolving,
        analytics: (any AnalyticsTracking)? = nil,
        dates: any DateProviding = SystemDateProvider()
    ) {
        self.coordinator = coordinator
        self.scopes = scopes
        self.analytics = analytics
        self.dates = dates
    }

    /// Registered by the composition root, not by a view: what needs
    /// refreshing is a property of the app, not of whichever screen happens
    /// to be visible when a run finishes.
    public func observe(_ observer: any CanonicalDataObserving) {
        observers.append(observer)
    }

    /// Re-reads every registered store. Called after a sync run, and directly
    /// after work that changes the numbers without touching the network — a
    /// finished session for a guest, whose answers are never uploaded.
    public func refreshObservers(succeeded: Bool = true) async {
        for observer in observers {
            await observer.canonicalDataDidLand(succeeded: succeeded)
        }
    }

    /// Puts work claimed by a run that died back in the queue, then syncs.
    ///
    /// Recovery comes first and unconditionally: a crash mid-request leaves
    /// operations in flight, and a launch that synced without requeueing them
    /// would leave that work invisible until something else happened to fix it.
    ///
    /// Idempotent: the launch has two possible first screens — the wait for
    /// an account's numbers and the app itself — and moving between them
    /// must not recover the same interrupted work twice.
    public func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        let scope = await resolvedScope()
        await coordinator.recoverInterruptedWork(for: scope)
        status = await coordinator.status(for: scope)
        await synchronize(trigger: .launch)
    }

    public func synchronize(trigger: SyncTrigger) async {
        let scope = await resolvedScope()
        let startedAt = dates.now()
        status = await coordinator.synchronize(scope: scope, trigger: trigger)
        // After the run, never during it: the canonical counts land in the
        // repositories as the last step of a run, so reading earlier is
        // reading the world the run was about to replace.
        await refreshObservers(succeeded: status.lastFailure == nil)
        await reportCompletion(startedAt: startedAt)
    }

    /// An operational event: how a sync that keeps failing becomes visible to
    /// the people who have to fix it. It carries an outcome and a duration
    /// bucket and nothing about the person or their answers, which is why it
    /// is collected without asking — see `AnalyticsConsentCategory`.
    ///
    /// The flush rides on the same moment: a sync that just finished is the
    /// one time the network is known to have worked.
    private func reportCompletion(startedAt: Date) async {
        guard let analytics else { return }
        let result: AnalyticsSyncResult =
            switch status.lastFailure {
            case .none: .success
            // Work still waiting after a run that did not fail outright is a
            // partial delivery rather than a failure: some of it landed.
            case .some where status.pendingCount > 0: .partial
            default: .failed
            }
        await analytics.track(
            .syncCompleted(
                result: result,
                duration: AnalyticsSyncDurationBucket(
                    seconds: dates.now().timeIntervalSince(startedAt)
                ),
                at: dates.now()
            )
        )
        await analytics.flush()
    }

    /// Re-reads the status without asking for a sync, for a screen that appears
    /// while one is already running.
    public func refreshStatus() async {
        status = await coordinator.status(for: await resolvedScope())
    }

    /// Asked every time rather than cached: signing in changes the answer
    /// mid-launch, and a cached guest would keep syncing as nobody.
    private func resolvedScope() async -> AccountScope {
        await scopes.currentScope()
    }
}
