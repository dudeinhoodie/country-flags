import Foundation
import SwiftData

import CountryFlagsDomain

@ModelActor
actor SwiftDataTelemetryRepository: TelemetryRepository {
    func privacySettings(for scope: AccountScope) async throws -> PrivacySettingsRecord? {
        let key = scope.key
        var descriptor = FetchDescriptor<StoredPrivacySettings>(
            predicate: #Predicate { $0.scopeKey == key }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first.map {
            PrivacySettingsRecord(
                productAnalyticsStatus: $0.productAnalyticsStatus,
                diagnosticsStatus: $0.diagnosticsStatus,
                policyVersion: $0.policyVersion,
                version: $0.version,
                updatedAt: $0.updatedAt
            )
        }
    }

    func savePrivacySettings(
        _ settings: PrivacySettingsRecord,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        try transaction {
            var descriptor = FetchDescriptor<StoredPrivacySettings>(
                predicate: #Predicate { $0.scopeKey == key }
            )
            descriptor.fetchLimit = 1
            if let stored = try modelContext.fetch(descriptor).first {
                stored.productAnalyticsStatus = settings.productAnalyticsStatus
                stored.diagnosticsStatus = settings.diagnosticsStatus
                stored.policyVersion = settings.policyVersion
                stored.version = settings.version
                stored.updatedAt = settings.updatedAt
            } else {
                modelContext.insert(
                    StoredPrivacySettings(
                        scopeKey: key,
                        productAnalyticsStatus: settings.productAnalyticsStatus,
                        diagnosticsStatus: settings.diagnosticsStatus,
                        policyVersion: settings.policyVersion,
                        version: settings.version,
                        updatedAt: settings.updatedAt
                    )
                )
            }
        }
    }

    func enqueueAnalyticsEvent(
        _ event: AnalyticsEventRecord,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        try transaction {
            modelContext.insert(
                StoredAnalyticsEvent(
                    scopeKey: key,
                    id: event.id,
                    name: event.name,
                    schemaVersion: event.schemaVersion,
                    payload: event.payload,
                    isOptional: event.isOptional,
                    occurredAt: event.occurredAt
                )
            )
        }
    }

    func pendingAnalyticsEvents(for scope: AccountScope) async throws -> [AnalyticsEventRecord] {
        let key = scope.key
        let descriptor = FetchDescriptor<StoredAnalyticsEvent>(
            predicate: #Predicate { $0.scopeKey == key },
            sortBy: [SortDescriptor(\.occurredAt)]
        )
        return try modelContext.fetch(descriptor).map {
            AnalyticsEventRecord(
                id: $0.id,
                name: $0.name,
                schemaVersion: $0.schemaVersion,
                payload: $0.payload,
                isOptional: $0.isOptional,
                occurredAt: $0.occurredAt
            )
        }
    }

    func removeAnalyticsEvents(ids: [UUID], for scope: AccountScope) async throws {
        let key = scope.key
        try transaction {
            let events = try modelContext.fetch(
                FetchDescriptor<StoredAnalyticsEvent>(
                    predicate: #Predicate { $0.scopeKey == key }
                )
            )
            for event in events where ids.contains(event.id) {
                modelContext.delete(event)
            }
        }
    }

    /// Withdrawing consent has to reach work that is already queued, otherwise
    /// the next flush would send events the user just refused.
    func removeOptionalAnalyticsEvents(for scope: AccountScope) async throws -> Int {
        let key = scope.key
        var removed = 0
        try transaction {
            let events = try modelContext.fetch(
                FetchDescriptor<StoredAnalyticsEvent>(
                    predicate: #Predicate { $0.scopeKey == key && $0.isOptional }
                )
            )
            for event in events {
                modelContext.delete(event)
            }
            removed = events.count
        }
        return removed
    }

    func enqueueDiagnosticReport(
        _ report: PendingDiagnosticReportRecord,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        try transaction {
            modelContext.insert(
                StoredPendingDiagnosticReport(
                    scopeKey: key,
                    id: report.id,
                    kind: report.kind,
                    payload: report.payload,
                    capturedAt: report.capturedAt
                )
            )
        }
    }

    func pendingDiagnosticReports(
        for scope: AccountScope
    ) async throws -> [PendingDiagnosticReportRecord] {
        let key = scope.key
        let descriptor = FetchDescriptor<StoredPendingDiagnosticReport>(
            predicate: #Predicate { $0.scopeKey == key },
            sortBy: [SortDescriptor(\.capturedAt)]
        )
        return try modelContext.fetch(descriptor).map {
            PendingDiagnosticReportRecord(
                id: $0.id,
                kind: $0.kind,
                payload: $0.payload,
                capturedAt: $0.capturedAt
            )
        }
    }
}

/// Deletes one account and leaves everything else alone.
@ModelActor
actor SwiftDataAccountScopeCleaner: AccountScopeCleaner {
    func erase(scope: AccountScope) async throws {
        let key = scope.key
        try transaction {
            // Content is deliberately absent from this list: it is shared, and
            // deleting it on sign-out would force every account on the device
            // to download it again.
            try delete(StoredUserSettings.self, scopeKey: key)
            try delete(StoredCardState.self, scopeKey: key)
            try delete(StoredDeckProgress.self, scopeKey: key)
            try delete(StoredAchievement.self, scopeKey: key)
            try delete(StoredDueSummary.self, scopeKey: key)
            try delete(StoredReviewEvent.self, scopeKey: key)
            try delete(StoredStudySession.self, scopeKey: key)
            try delete(StoredOutboxOperation.self, scopeKey: key)
            try delete(StoredSyncCursor.self, scopeKey: key)
            try delete(StoredAnalyticsEvent.self, scopeKey: key)
            try delete(StoredPrivacySettings.self, scopeKey: key)
            try delete(StoredPendingDiagnosticReport.self, scopeKey: key)
        }
    }

    private func delete<Model: PersistentModel & ScopedModel>(
        _ type: Model.Type,
        scopeKey key: String
    ) throws {
        for model in try modelContext.fetch(FetchDescriptor<Model>()) where model.scopeKey == key {
            modelContext.delete(model)
        }
    }
}

/// Marks the models that belong to an account, so the cleaner cannot be handed
/// a shared content model by mistake.
protocol ScopedModel {
    var scopeKey: String { get }
}

extension StoredUserSettings: ScopedModel {}
extension StoredCardState: ScopedModel {}
extension StoredDeckProgress: ScopedModel {}
extension StoredAchievement: ScopedModel {}
extension StoredDueSummary: ScopedModel {}
extension StoredReviewEvent: ScopedModel {}
extension StoredStudySession: ScopedModel {}
extension StoredOutboxOperation: ScopedModel {}
extension StoredSyncCursor: ScopedModel {}
extension StoredAnalyticsEvent: ScopedModel {}
extension StoredPrivacySettings: ScopedModel {}
extension StoredPendingDiagnosticReport: ScopedModel {}

