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

    /// The scope is resolved once. A session belongs to the account that began
    /// it, and re-resolving mid-run could attribute work to another.
    func testTheScopeIsResolvedOnce() async {
        let scopes = CountingScopeResolver()
        let center = SyncCenter(
            coordinator: RecordingCoordinator(status: SyncStatus()),
            scopes: scopes
        )

        await center.synchronize(trigger: .launch)
        await center.synchronize(trigger: .foreground)

        let resolutions = await scopes.resolutions()
        XCTAssertEqual(resolutions, 1)
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
