import Foundation
import Observation

import CountryFlagsDomain

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
    private var scope: AccountScope?

    public init(coordinator: any SyncCoordinating, scopes: any AccountScopeResolving) {
        self.coordinator = coordinator
        self.scopes = scopes
    }

    /// Puts work claimed by a run that died back in the queue, then syncs.
    ///
    /// Recovery comes first and unconditionally: a crash mid-request leaves
    /// operations in flight, and a launch that synced without requeueing them
    /// would leave that work invisible until something else happened to fix it.
    public func start() async {
        let scope = await resolvedScope()
        await coordinator.recoverInterruptedWork(for: scope)
        status = await coordinator.status(for: scope)
        await synchronize(trigger: .launch)
    }

    public func synchronize(trigger: SyncTrigger) async {
        let scope = await resolvedScope()
        status = await coordinator.synchronize(scope: scope, trigger: trigger)
    }

    /// Re-reads the status without asking for a sync, for a screen that appears
    /// while one is already running.
    public func refreshStatus() async {
        status = await coordinator.status(for: await resolvedScope())
    }

    private func resolvedScope() async -> AccountScope {
        if let scope { return scope }
        let resolved = await scopes.currentScope()
        scope = resolved
        return resolved
    }
}
