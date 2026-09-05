import Foundation

import CountryFlagsDomain

/// Keeps the device's copy of "what this account may open" current.
///
/// The snapshot is the server's answer and is replaced whole: a refund arrives
/// the same way a purchase does, so merging keys would leave a device holding
/// a right the server has taken back. One row, one write, no window in which
/// half of one answer sits beside half of another.
///
/// The entity tag is held in memory rather than on disk. It buys the thing
/// §7.4 asks for — a foreground check that costs a `304` and no body — and the
/// foregrounds a device does are all inside one process lifetime. A launch
/// asks in full, which is once, and paying for that once is cheaper than a
/// schema version to store a cache header in.
public actor EntitlementRefresher {
    private let repository: any CommerceRepository
    private let backend: any CommerceBackend
    private let logger: any AppLogging

    private var entityTags: [String: String] = [:]
    /// One refresh per scope. Launch, foreground and a login routinely land
    /// together on a cold start.
    private var running: [String: Task<EntitlementSnapshotRecord, Never>] = [:]

    public init(
        repository: any CommerceRepository,
        backend: any CommerceBackend,
        logger: any AppLogging = NoOpLogger()
    ) {
        self.repository = repository
        self.backend = backend
        self.logger = logger
    }

    /// What the device holds now, without asking anybody.
    public func snapshot(for scope: AccountScope) async -> EntitlementSnapshotRecord {
        ((try? await repository.entitlementSnapshot(for: scope)) ?? nil)
            ?? .empty(checkedAt: .distantPast)
    }

    /// Asks the server, and writes down whatever it says.
    ///
    /// - Returns: the snapshot in force afterwards. A failure is not an error
    ///   here: the held snapshot stands, the app keeps working offline, and
    ///   the next trigger asks again.
    @discardableResult
    public func refresh(
        for scope: AccountScope,
        trigger: EntitlementRefreshTrigger
    ) async -> EntitlementSnapshotRecord {
        // A guest owns nothing on the server, and asking would be an
        // unauthenticated call to an endpoint that requires a session.
        guard !scope.isGuest else { return await snapshot(for: scope) }

        if let running = running[scope.key] {
            return await running.value
        }
        let task = Task<EntitlementSnapshotRecord, Never> { [self] in
            let snapshot = await ask(for: scope, trigger: trigger)
            running[scope.key] = nil
            return snapshot
        }
        running[scope.key] = task
        return await task.value
    }

    /// Drops the cached tag so the next refresh asks in full.
    ///
    /// Called when the account changes: a tag issued for one account says
    /// nothing about another, and replaying it would answer `304` about
    /// somebody else's rights.
    public func forget(scope: AccountScope) {
        entityTags[scope.key] = nil
    }

    private func ask(
        for scope: AccountScope,
        trigger: EntitlementRefreshTrigger
    ) async -> EntitlementSnapshotRecord {
        do {
            switch try await backend.entitlements(entityTag: entityTags[scope.key]) {
            case .unchanged:
                return await snapshot(for: scope)
            case .snapshot(let fresh, let entityTag):
                entityTags[scope.key] = entityTag
                try await repository.replaceEntitlementSnapshot(fresh, for: scope)
                logger.log(
                    .info,
                    .commerce,
                    "The server answered what this account may open",
                    [
                        "trigger": .safe(trigger.rawValue),
                        "count": .count(fresh.entitlementKeys.count),
                    ]
                )
                return fresh
            }
        } catch {
            let apiError = APIError.from(error)
            logger.log(
                .notice,
                .commerce,
                "Could not refresh what this account may open; the held answer stands",
                [
                    "trigger": .safe(trigger.rawValue),
                    "code": .safe(apiError.details?.code ?? "TRANSPORT"),
                ]
            )
            return await snapshot(for: scope)
        }
    }
}
