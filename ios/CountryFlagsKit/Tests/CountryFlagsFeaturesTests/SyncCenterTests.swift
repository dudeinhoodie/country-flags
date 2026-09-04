import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

@MainActor
final class SyncCenterTests: XCTestCase {
    /// A crash mid-request leaves work claimed. Recovery runs before the first
    /// sync and unconditionally, or that work would stay invisible until
    /// something else happened to fix it.
    func testRecoveryRunsBeforeTheFirstSync() async {
        let coordinator = RecordingCoordinator(status: SyncStatus(pendingCount: 2))
        let center = SyncCenter(coordinator: coordinator, scopes: FixedScopeResolver())

        await center.start()

        let calls = await coordinator.calls()
        XCTAssertEqual(calls.first, "recover")
        XCTAssertTrue(calls.contains("sync:launch"))
        XCTAssertEqual(center.status.pendingCount, 2)
    }

    /// The network coming back is a trigger: a run that failed for want of
    /// one is repeated the moment there is one, not at the next launch. The
    /// monitor used to exist with nobody listening.
    func testTheNetworkComingBackStartsARun() async throws {
        let coordinator = RecordingCoordinator(status: SyncStatus())
        let reachability = ScriptedReachability()
        let center = SyncCenter(
            coordinator: coordinator,
            scopes: FixedScopeResolver(),
            reachability: reachability
        )

        await center.start()
        await reachability.networkCameBack()

        // The callback hops to the main actor; give it its turn.
        for _ in 0..<50 {
            if await coordinator.calls().contains("sync:networkAvailable") { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let calls = await coordinator.calls()
        XCTAssertTrue(calls.contains("sync:networkAvailable"), "\(calls)")
    }

    /// The launch has two possible first screens and both call `start()`, so
    /// the second call returns at once. A screen that timed the launch by
    /// that call was timing nothing — which is how the home screen showed the
    /// numbers this device was last told and replaced them two seconds later
    /// with no spinner in between.
    func testTheFirstRunIsNotSettledUntilItComesBack() async {
        let coordinator = RecordingCoordinator(status: SyncStatus())
        let center = SyncCenter(coordinator: coordinator, scopes: FixedScopeResolver())

        XCTAssertFalse(center.hasSettledFirstRun)

        await center.start()

        XCTAssertTrue(center.hasSettledFirstRun)
    }

    func testEveryTriggerReachesTheSharedBoundary() async {
        let coordinator = RecordingCoordinator(status: SyncStatus())
        let center = SyncCenter(coordinator: coordinator, scopes: FixedScopeResolver())

        await center.synchronize(trigger: .foreground)
        await center.synchronize(trigger: .pullToRefresh)
        await center.synchronize(trigger: .sessionCompleted)

        let calls = await coordinator.calls()
        XCTAssertEqual(
            calls,
            ["sync:foreground", "sync:pullToRefresh", "sync:sessionCompleted"]
        )
    }

    /// The scope is asked for on every run rather than resolved once: signing
    /// in changes the answer mid-launch, and a cached guest would keep syncing
    /// as nobody. The resolve-once rule lives where it belongs — a study
    /// session's runner — not here.
    func testTheScopeFollowsTheAccountAcrossRuns() async {
        let scopes = CountingScopeResolver()
        let center = SyncCenter(
            coordinator: RecordingCoordinator(status: SyncStatus()),
            scopes: scopes
        )

        await center.synchronize(trigger: .launch)
        await center.synchronize(trigger: .foreground)

        let resolutions = await scopes.resolutions()
        XCTAssertEqual(resolutions, 2)
    }

    /// A guest is told their work is saved, not that something failed.
    func testAGuestStatusIsReportedWithoutAFailure() async {
        let coordinator = RecordingCoordinator(
            status: SyncStatus(pendingCount: 4, isHeldForGuest: true)
        )
        let center = SyncCenter(coordinator: coordinator, scopes: FixedScopeResolver())

        await center.synchronize(trigger: .launch)

        XCTAssertTrue(center.status.isHeldForGuest)
        XCTAssertNil(center.status.lastFailure)
        XCTAssertTrue(center.status.isWorthReporting)
    }

    /// A healthy device that is up to date says nothing at all.
    func testAnIdleUpToDateStatusIsNotWorthReporting() async {
        let center = SyncCenter(
            coordinator: RecordingCoordinator(status: SyncStatus(lastSuccessAt: Date())),
            scopes: FixedScopeResolver()
        )

        await center.synchronize(trigger: .launch)

        XCTAssertFalse(center.status.isWorthReporting)
    }
}

/// A network monitor the test drives by hand.
actor ScriptedReachability: NetworkReachabilityObserving {
    private var onAvailable: (@Sendable () -> Void)?

    func startObserving(_ onAvailable: @escaping @Sendable () -> Void) async {
        self.onAvailable = onAvailable
    }

    func stopObserving() async {
        onAvailable = nil
    }

    func networkCameBack() {
        onAvailable?()
    }
}

actor RecordingCoordinator: SyncCoordinating {
    private let stored: SyncStatus
    private var recorded: [String] = []

    init(status: SyncStatus) {
        stored = status
    }

    func calls() -> [String] { recorded }

    func status(for scope: AccountScope) async -> SyncStatus { stored }

    func recoverInterruptedWork(for scope: AccountScope) async {
        recorded.append("recover")
    }

    @discardableResult
    func synchronize(scope: AccountScope, trigger: SyncTrigger) async -> SyncStatus {
        recorded.append("sync:\(trigger.rawValue)")
        return stored
    }
}

actor CountingScopeResolver: AccountScopeResolving {
    private var count = 0

    func resolutions() -> Int { count }

    func currentScope() async -> AccountScope {
        count += 1
        return .guest(installationID: UUID())
    }
}
