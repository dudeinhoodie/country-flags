import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// Stored consent at launch (#452): it reaches the collectors before anything
/// is collected, then MetricKit is subscribed to, then what waits is sent.
@MainActor
final class TelemetryLaunchTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let guest = AccountScope.guest(
        installationID: UUID(uuidString: "81000000-0000-4000-8000-0000000000d1")!
    )

    /// The person agreed to diagnostics on an earlier launch. This launch
    /// applies that answer without anybody opening the settings, and only
    /// then starts collecting and sends what is waiting.
    func testStoredConsentIsAppliedBeforeCollectionStarts() async {
        let repository = StoredPrivacy(
            record: PrivacySettingsRecord(
                productAnalyticsStatus: ConsentStatus.denied.rawValue,
                diagnosticsStatus: ConsentStatus.granted.rawValue,
                policyVersion: PrivacyStore.policyVersion,
                version: 3,
                updatedAt: now
            )
        )
        let journal = Journal()
        let collector = JournalingCollector(journal: journal)
        let launch = TelemetryLaunch(
            privacy: PrivacyStore(
                repository: repository,
                scopes: FixedScopes(scope: guest),
                collectors: [collector]
            ),
            startDiagnostics: { journal.note("start") },
            flushDiagnostics: { await journal.noteAsync("flush") }
        )

        await launch.run()

        XCTAssertEqual(journal.entries, ["consent diagnostics=granted", "start", "flush"])
    }

    /// Nobody has been asked yet: the collectors are told exactly that, which
    /// collects nothing optional, and the launch still subscribes and flushes
    /// (both of which do nothing without consent).
    func testNoStoredAnswerAppliesTheUnaskedDefault() async {
        let journal = Journal()
        let launch = TelemetryLaunch(
            privacy: PrivacyStore(
                repository: StoredPrivacy(record: nil),
                scopes: FixedScopes(scope: guest),
                collectors: [JournalingCollector(journal: journal)]
            ),
            startDiagnostics: { journal.note("start") },
            flushDiagnostics: { await journal.noteAsync("flush") }
        )

        await launch.run()

        XCTAssertEqual(journal.entries, ["consent diagnostics=unknown", "start", "flush"])
    }
}

// MARK: - Doubles

/// What happened, in order.
@MainActor
private final class Journal {
    private(set) var entries: [String] = []

    func note(_ entry: String) { entries.append(entry) }

    nonisolated func noteAsync(_ entry: String) async {
        await MainActor.run { self.note(entry) }
    }
}

private struct JournalingCollector: TelemetryConsentApplying {
    let journal: Journal

    func adopt(consent: TelemetryConsent) async {
        await journal.noteAsync("consent diagnostics=\(consent.diagnostics.rawValue.lowercased())")
    }
}

private struct FixedScopes: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}

/// Holds one privacy record and nothing else.
private actor StoredPrivacy: TelemetryRepository {
    private let record: PrivacySettingsRecord?

    init(record: PrivacySettingsRecord?) {
        self.record = record
    }

    func privacySettings(for scope: AccountScope) async throws -> PrivacySettingsRecord? {
        record
    }

    func savePrivacySettings(_ settings: PrivacySettingsRecord, for scope: AccountScope) async throws {}
    func enqueueAnalyticsEvent(_ event: AnalyticsEventRecord, for scope: AccountScope) async throws {}
    func pendingAnalyticsEvents(for scope: AccountScope) async throws -> [AnalyticsEventRecord] { [] }
    func removeAnalyticsEvents(ids: [UUID], for scope: AccountScope) async throws {}
    func removeOptionalAnalyticsEvents(for scope: AccountScope) async throws -> Int { 0 }
    func enqueueDiagnosticReport(
        _ report: PendingDiagnosticReportRecord,
        for scope: AccountScope
    ) async throws {}
    func pendingDiagnosticReports(
        for scope: AccountScope
    ) async throws -> [PendingDiagnosticReportRecord] { [] }
    func removeDiagnosticReports(ids: [UUID], for scope: AccountScope) async throws {}
}
