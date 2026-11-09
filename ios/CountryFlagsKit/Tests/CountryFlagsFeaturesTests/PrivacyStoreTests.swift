import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// The privacy switches and the decision behind them: a switch holds its new
/// position at once, and a decision the backend never heard is offered again
/// at the next launch — but never over an answer another device gave since.
@MainActor
final class PrivacyStoreTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "82000000-0000-4000-8000-0000000000a1")!
    )

    func testASwitchHoldsItsNewValueBeforeAnythingIsAwaited() async {
        let gate = ScopeGate(scope: account)
        let store = PrivacyStore(
            repository: PrivacyRecords(record: nil),
            scopes: gate,
            dates: FixedDateProvider(instant: now)
        )

        let change = Task.immediate { await store.setDiagnostics(granted: true) }

        XCTAssertEqual(store.consent.diagnostics, .granted)
        await gate.open()
        await change.value
        XCTAssertEqual(store.consent.diagnostics, .granted)
    }

    /// Granted on this device, but the round trip failed: the backend still
    /// holds the version the change was based on, with the old answer.
    func testADecisionTheBackendNeverHeardIsOfferedAgain() async {
        let accepted = consent(diagnostics: .granted, version: 3)
        let backend = ScriptedPrivacySync(
            server: consent(diagnostics: .denied, version: 2),
            outcome: .updated(accepted)
        )
        let repository = PrivacyRecords(record: record(diagnostics: .granted, version: 2))
        let store = makeStore(repository: repository, sync: backend)
        await store.load()

        await store.offerUnsentDecision()

        let sent = await backend.sent
        XCTAssertEqual(sent.map(\.diagnostics), [.granted])
        XCTAssertEqual(sent.map(\.version), [2])
        XCTAssertEqual(store.consent, accepted)
        let saved = await repository.record
        XCTAssertEqual(saved?.version, 3)
    }

    func testADecisionTheBackendAlreadyHoldsIsNotSentAgain() async {
        let backend = ScriptedPrivacySync(
            server: consent(diagnostics: .granted, version: 2),
            outcome: .updated(consent(diagnostics: .granted, version: 3))
        )
        let store = makeStore(
            repository: PrivacyRecords(record: record(diagnostics: .granted, version: 2)),
            sync: backend
        )
        await store.load()

        await store.offerUnsentDecision()

        let sent = await backend.sent
        XCTAssertTrue(sent.isEmpty)
    }

    /// Another device answered since: overwriting it from here would undo a
    /// decision somebody made later than this one.
    func testANewerAnswerOnTheBackendIsNotOverwritten() async {
        let backend = ScriptedPrivacySync(
            server: consent(diagnostics: .denied, version: 4),
            outcome: .updated(consent(diagnostics: .granted, version: 5))
        )
        let store = makeStore(
            repository: PrivacyRecords(record: record(diagnostics: .granted, version: 2)),
            sync: backend
        )
        await store.load()

        await store.offerUnsentDecision()

        let sent = await backend.sent
        XCTAssertTrue(sent.isEmpty)
        XCTAssertEqual(store.consent.diagnostics, .granted)
    }

    func testAGuestOffersNothing() async {
        let backend = ScriptedPrivacySync(
            server: consent(diagnostics: .denied, version: 2),
            outcome: .updated(consent(diagnostics: .granted, version: 3))
        )
        let store = PrivacyStore(
            repository: PrivacyRecords(record: record(diagnostics: .granted, version: 2)),
            scopes: FixedScopeResolver(scope: .guest(installationID: UUID())),
            sync: backend,
            dates: FixedDateProvider(instant: now)
        )
        await store.load()

        await store.offerUnsentDecision()

        let sent = await backend.sent
        XCTAssertTrue(sent.isEmpty)
    }

    /// An install that has never answered holds the unasked default, which is
    /// not a decision to send.
    func testAnInstallThatNeverAnsweredOffersNothing() async {
        let backend = ScriptedPrivacySync(
            server: consent(diagnostics: .granted, version: 1),
            outcome: .updated(consent(diagnostics: .unknown, version: 2))
        )
        let store = makeStore(repository: PrivacyRecords(record: nil), sync: backend)
        await store.load()

        await store.offerUnsentDecision()

        let sent = await backend.sent
        XCTAssertTrue(sent.isEmpty)
    }

    // MARK: - Harness

    private func makeStore(
        repository: PrivacyRecords,
        sync: ScriptedPrivacySync
    ) -> PrivacyStore {
        PrivacyStore(
            repository: repository,
            scopes: FixedScopeResolver(scope: account),
            sync: sync,
            dates: FixedDateProvider(instant: now)
        )
    }

    private func consent(diagnostics: ConsentStatus, version: Int) -> TelemetryConsent {
        TelemetryConsent(
            productAnalytics: .denied,
            diagnostics: diagnostics,
            policyVersion: PrivacyStore.policyVersion,
            version: version,
            updatedAt: now
        )
    }

    private func record(diagnostics: ConsentStatus, version: Int) -> PrivacySettingsRecord {
        PrivacySettingsRecord(
            productAnalyticsStatus: ConsentStatus.denied.rawValue,
            diagnosticsStatus: diagnostics.rawValue,
            policyVersion: PrivacyStore.policyVersion,
            version: version,
            updatedAt: now
        )
    }
}

// MARK: - Doubles

/// The backend's consent, and a record of every change offered to it.
private actor ScriptedPrivacySync: PrivacySettingsSyncing {
    private let server: TelemetryConsent
    private let outcome: PrivacySettingsUpdateOutcome
    private(set) var sent: [TelemetryConsent] = []

    init(server: TelemetryConsent, outcome: PrivacySettingsUpdateOutcome) {
        self.server = server
        self.outcome = outcome
    }

    func privacySettings() async throws -> TelemetryConsent { server }

    func update(_ consent: TelemetryConsent) async throws -> PrivacySettingsUpdateOutcome {
        sent.append(consent)
        return outcome
    }
}

/// Holds the one privacy record a scope has.
private actor PrivacyRecords: TelemetryRepository {
    private(set) var record: PrivacySettingsRecord?

    init(record: PrivacySettingsRecord?) {
        self.record = record
    }

    func privacySettings(for scope: AccountScope) async throws -> PrivacySettingsRecord? {
        record
    }

    func savePrivacySettings(_ settings: PrivacySettingsRecord, for scope: AccountScope) async throws {
        record = settings
    }

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
