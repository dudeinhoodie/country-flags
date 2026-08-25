import Foundation
import SwiftData

import CountryFlagsDomain

@ModelActor
actor SwiftDataOutboxRepository: OutboxRepository {
    func enqueue(_ operation: OutboxOperationRecord, for scope: AccountScope) async throws {
        let key = scope.key
        try transaction {
            modelContext.insert(
                StoredOutboxOperation(
                    scopeKey: key,
                    id: operation.id,
                    kind: operation.kind.rawValue,
                    dependencyID: operation.dependencyID,
                    payload: operation.payload,
                    state: operation.state.rawValue,
                    attemptCount: operation.attemptCount,
                    lastFailureCode: operation.lastFailureCode,
                    createdAt: operation.createdAt,
                    updatedAt: operation.updatedAt
                )
            )
        }
    }

    /// Everything still owed to the backend, oldest first, so operations reach
    /// it in the order the user produced them.
    func pendingOperations(for scope: AccountScope) async throws -> [OutboxOperationRecord] {
        let key = scope.key
        let synced = OutboxState.synced.rawValue
        let permanent = OutboxState.permanentFailure.rawValue
        let descriptor = FetchDescriptor<StoredOutboxOperation>(
            predicate: #Predicate {
                $0.scopeKey == key && $0.state != synced && $0.state != permanent
            },
            sortBy: [SortDescriptor(\.createdAt), SortDescriptor(\.id)]
        )
        return try modelContext.fetch(descriptor).compactMap(Self.record)
    }

    func updateState(
        of operationID: UUID,
        to state: OutboxState,
        failureCode: String?,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        try transaction {
            var descriptor = FetchDescriptor<StoredOutboxOperation>(
                predicate: #Predicate { $0.scopeKey == key && $0.id == operationID }
            )
            descriptor.fetchLimit = 1
            guard let stored = try modelContext.fetch(descriptor).first else {
                throw PersistenceError.notFound
            }
            stored.state = state.rawValue
            stored.lastFailureCode = failureCode
            stored.updatedAt = Date()
            if state == .inFlight {
                stored.attemptCount += 1
            }
        }
    }

    /// A process that died mid-upload leaves work claimed. Without this the
    /// operation would sit in the store forever, never retried and never
    /// reported.
    func requeueInterruptedOperations(for scope: AccountScope) async throws -> Int {
        let key = scope.key
        let inFlight = OutboxState.inFlight.rawValue
        var requeued = 0
        try transaction {
            let stranded = try modelContext.fetch(
                FetchDescriptor<StoredOutboxOperation>(
                    predicate: #Predicate { $0.scopeKey == key && $0.state == inFlight }
                )
            )
            for operation in stranded {
                operation.state = OutboxState.pending.rawValue
                operation.updatedAt = Date()
            }
            requeued = stranded.count
        }
        return requeued
    }

    /// The refusals that share one code, oldest first, so a cure that knows
    /// the code replays them in the order the user produced them.
    func operations(
        failedWith code: String,
        for scope: AccountScope
    ) async throws -> [OutboxOperationRecord] {
        let key = scope.key
        let permanent = OutboxState.permanentFailure.rawValue
        let descriptor = FetchDescriptor<StoredOutboxOperation>(
            predicate: #Predicate {
                $0.scopeKey == key && $0.state == permanent && $0.lastFailureCode == code
            },
            sortBy: [SortDescriptor(\.createdAt), SortDescriptor(\.id)]
        )
        return try modelContext.fetch(descriptor).compactMap(Self.record)
    }

    func requeue(
        _ operationID: UUID,
        withPayload payload: Data,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        try transaction {
            var descriptor = FetchDescriptor<StoredOutboxOperation>(
                predicate: #Predicate { $0.scopeKey == key && $0.id == operationID }
            )
            descriptor.fetchLimit = 1
            guard let stored = try modelContext.fetch(descriptor).first else {
                throw PersistenceError.notFound
            }
            stored.payload = payload
            stored.state = OutboxState.pending.rawValue
            stored.lastFailureCode = nil
            stored.updatedAt = Date()
        }
    }

    func cursor(
        _ feed: SyncCursorRecord.Feed,
        for scope: AccountScope
    ) async throws -> SyncCursorRecord? {
        let key = scope.key
        let feedKey = feed.rawValue
        var descriptor = FetchDescriptor<StoredSyncCursor>(
            predicate: #Predicate { $0.scopeKey == key && $0.feed == feedKey }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first.flatMap { stored in
            SyncCursorRecord.Feed(rawValue: stored.feed).map {
                SyncCursorRecord(feed: $0, cursor: stored.cursor, updatedAt: stored.updatedAt)
            }
        }
    }

    func saveCursor(_ cursor: SyncCursorRecord, for scope: AccountScope) async throws {
        let key = scope.key
        let feedKey = cursor.feed.rawValue
        try transaction {
            var descriptor = FetchDescriptor<StoredSyncCursor>(
                predicate: #Predicate { $0.scopeKey == key && $0.feed == feedKey }
            )
            descriptor.fetchLimit = 1
            if let stored = try modelContext.fetch(descriptor).first {
                stored.cursor = cursor.cursor
                stored.updatedAt = cursor.updatedAt
            } else {
                modelContext.insert(
                    StoredSyncCursor(
                        scopeKey: key,
                        feed: feedKey,
                        cursor: cursor.cursor,
                        updatedAt: cursor.updatedAt
                    )
                )
            }
        }
    }

    /// Drops the queue and the cursors together, in one transaction: a device
    /// that kept its cursor would resume a stream the account has rotated, and
    /// a device that kept its queue would upload answers to sessions the
    /// backend has just deleted.
    func discardQueuedWork(for scope: AccountScope) async throws {
        let key = scope.key
        try transaction {
            for stored in try modelContext.fetch(FetchDescriptor<StoredOutboxOperation>())
            where stored.scopeKey == key {
                modelContext.delete(stored)
            }
            for stored in try modelContext.fetch(FetchDescriptor<StoredSyncCursor>())
            where stored.scopeKey == key {
                modelContext.delete(stored)
            }
        }
    }

    /// An operation whose kind or state this build does not recognize is
    /// skipped rather than crashed on: a downgrade must not take the queue
    /// with it.
    private static func record(_ stored: StoredOutboxOperation) -> OutboxOperationRecord? {
        guard
            let kind = OutboxOperationKind(rawValue: stored.kind),
            let state = OutboxState(rawValue: stored.state)
        else {
            return nil
        }
        return OutboxOperationRecord(
            id: stored.id,
            kind: kind,
            dependencyID: stored.dependencyID,
            payload: stored.payload,
            state: state,
            attemptCount: stored.attemptCount,
            lastFailureCode: stored.lastFailureCode,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt
        )
    }
}
