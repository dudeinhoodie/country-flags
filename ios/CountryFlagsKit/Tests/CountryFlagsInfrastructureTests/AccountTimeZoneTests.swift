import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// A learner who moves has their day counted where they are now (#452).
final class AccountTimeZoneReporterTests: XCTestCase {
    private let userID = UUID(uuidString: "80000000-0000-4000-8000-0000000000c1")!
    private let otherUserID = UUID(uuidString: "80000000-0000-4000-8000-0000000000c2")!

    /// The device moved: the server's zone is read, the new one is sent
    /// against that version, the settings it answers with are stored, and the
    /// zone is remembered.
    func testAMoveIsSentAgainstTheVersionItWasReadAt() async throws {
        let syncing = ScriptedTimeZoneSyncing(
            held: [AccountTimeZone(identifier: "Europe/Moscow", settingsVersion: 4)],
            answers: [.updated(Self.settings(version: 5))]
        )
        let store = try LocalStore(location: .inMemory)
        let records = InMemoryTimeZoneReports()
        let reporter = makeReporter(syncing: syncing, store: store, records: records)

        await reporter.reportIfMoved()

        let sent = await syncing.sent
        XCTAssertEqual(sent.map(\.zone), ["Asia/Tbilisi"])
        XCTAssertEqual(sent.map(\.version), [4])
        XCTAssertEqual(records.reportedTimeZone(for: userID), "Asia/Tbilisi")
        let stored = try await store.makeLearningRepository()
            .settings(for: .authenticated(userID: userID))
        XCTAssertEqual(stored?.version, 5, "the next settings change starts from the new version")
    }

    /// Nothing moved since the last report: no request at all, on every
    /// launch and every return to the app.
    func testTheSameZoneAsksNothing() async {
        let syncing = ScriptedTimeZoneSyncing(held: [], answers: [])
        let records = InMemoryTimeZoneReports()
        records.recordReportedTimeZone("Asia/Tbilisi", for: userID)
        let reporter = makeReporter(syncing: syncing, records: records)

        await reporter.reportIfMoved()
        await reporter.reportIfMoved()

        let reads = await syncing.reads
        let sent = await syncing.sent
        XCTAssertEqual(reads, 0)
        XCTAssertTrue(sent.isEmpty)
    }

    /// The server already counts the day in this zone (another device got
    /// there first, or it is spelled another way): it is read once, nothing
    /// is written, and the next return asks nothing.
    func testAZoneTheServerAlreadyHoldsIsOnlyRemembered() async {
        let syncing = ScriptedTimeZoneSyncing(
            held: [AccountTimeZone(identifier: "asia/tbilisi", settingsVersion: 2)],
            answers: []
        )
        let records = InMemoryTimeZoneReports()
        let reporter = makeReporter(syncing: syncing, records: records)

        await reporter.reportIfMoved()
        await reporter.reportIfMoved()

        let reads = await syncing.reads
        let sent = await syncing.sent
        XCTAssertEqual(reads, 1)
        XCTAssertTrue(sent.isEmpty)
    }

    /// A zone the server does not know is a quiet no: remembered, so it is
    /// not offered again on every return, and nothing else happens.
    func testARefusedZoneIsNotOfferedAgain() async {
        let syncing = ScriptedTimeZoneSyncing(
            held: [AccountTimeZone(identifier: "UTC", settingsVersion: 1)],
            answers: [.refused]
        )
        let records = InMemoryTimeZoneReports()
        let logger = RecordingLogger()
        let reporter = makeReporter(syncing: syncing, records: records, logger: logger)

        await reporter.reportIfMoved()
        await reporter.reportIfMoved()

        let sent = await syncing.sent
        XCTAssertEqual(sent.count, 1)
        XCTAssertFalse(logger.recorded.contains { $0.level == .error })
        XCTAssertFalse(
            logger.renderedLines.contains { $0.contains("Asia/Tbilisi") },
            "where somebody is stays out of the log"
        )
    }

    /// Another device wrote between the read and the write: the zone is read
    /// again and sent once more against the new version.
    func testAConflictIsReadAgainOnce() async {
        let syncing = ScriptedTimeZoneSyncing(
            held: [
                AccountTimeZone(identifier: "UTC", settingsVersion: 1),
                AccountTimeZone(identifier: "UTC", settingsVersion: 2),
            ],
            answers: [.conflict, .updated(Self.settings(version: 3))]
        )
        let records = InMemoryTimeZoneReports()
        let reporter = makeReporter(syncing: syncing, records: records)

        await reporter.reportIfMoved()

        let sent = await syncing.sent
        XCTAssertEqual(sent.map(\.version), [1, 2])
        XCTAssertEqual(records.reportedTimeZone(for: userID), "Asia/Tbilisi")
    }

    /// No network: nothing is remembered, so the next launch tries again.
    func testAFailedRequestIsTriedAgainNextTime() async {
        let syncing = ScriptedTimeZoneSyncing(held: [], answers: [], readFailure: true)
        let records = InMemoryTimeZoneReports()
        let reporter = makeReporter(syncing: syncing, records: records)

        await reporter.reportIfMoved()

        XCTAssertNil(records.reportedTimeZone(for: userID))
    }

    /// A guest's day is counted on the device: there is nobody to tell.
    func testAGuestAsksNothing() async {
        let syncing = ScriptedTimeZoneSyncing(held: [], answers: [])
        let reporter = makeReporter(
            syncing: syncing,
            scope: .guest(installationID: UUID()),
            records: InMemoryTimeZoneReports()
        )

        await reporter.reportIfMoved()

        let reads = await syncing.reads
        XCTAssertEqual(reads, 0)
    }

    /// What one account was brought in line with says nothing about another
    /// account signed in on the same phone.
    func testTheRecordIsPerAccount() {
        let suite = "time-zone-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let records = UserDefaultsTimeZoneReportStore(defaults: defaults)

        records.recordReportedTimeZone("Asia/Tbilisi", for: userID)

        XCTAssertEqual(records.reportedTimeZone(for: userID), "Asia/Tbilisi")
        XCTAssertNil(records.reportedTimeZone(for: otherUserID))
    }

    // MARK: - Harness

    private func makeReporter(
        syncing: ScriptedTimeZoneSyncing,
        scope: AccountScope? = nil,
        store: LocalStore? = nil,
        records: InMemoryTimeZoneReports,
        logger: any AppLogging = NoOpLogger()
    ) -> AccountTimeZoneReporter {
        AccountTimeZoneReporter(
            syncing: syncing,
            scopes: FixedTimeZoneScopes(scope: scope ?? .authenticated(userID: userID)),
            learning: (store ?? (try! LocalStore(location: .inMemory))).makeLearningRepository(),
            records: records,
            currentZone: { "Asia/Tbilisi" },
            logger: logger
        )
    }

    fileprivate static func settings(version: Int) -> UserSettingsRecord {
        UserSettingsRecord(
            sessionSize: 10,
            contentLocale: "en",
            defaultAnswerMode: "SELF_RATED",
            extraFactTypes: [],
            soundEnabled: true,
            hapticsEnabled: true,
            remindersEnabled: false,
            version: version,
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}

/// The client half of the seam: what goes on the wire, and how the answers
/// are read (#452).
final class AccountTimeZoneServiceTests: XCTestCase {
    /// The zone goes alone, under the version it was read at, so nothing
    /// else a learner set can be overwritten by it.
    func testTheZoneIsSentAloneUnderItsVersion() async throws {
        let transport = MockClientTransport()
        await transport.always(
            Self.settingsResponse(zone: "Asia/Tbilisi", version: 5),
            for: "updateSettings"
        )
        let service = Self.makeService(transport: transport)

        let outcome = try await service.updateTimeZone("Asia/Tbilisi", basedOn: 4)

        guard case .updated(let settings) = outcome else {
            return XCTFail("Expected the zone to be stored, got \(outcome)")
        }
        XCTAssertEqual(settings.version, 5)
        let requests = await transport.requests(for: "updateSettings")
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.header("If-Match"), #"W/"4""#)
        let body = try XCTUnwrap(request.body)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(sent.keys.sorted(), ["timezone"])
        XCTAssertEqual(sent["timezone"] as? String, "Asia/Tbilisi")
    }

    /// The zone and version the server holds are read from the settings.
    func testTheHeldZoneIsReadFromTheSettings() async throws {
        let transport = MockClientTransport()
        await transport.always(
            Self.settingsResponse(zone: "Europe/Moscow", version: 7),
            for: "getSettings"
        )

        let held = try await Self.makeService(transport: transport).accountTimeZone()

        XCTAssertEqual(
            held,
            AccountTimeZone(identifier: "Europe/Moscow", settingsVersion: 7)
        )
    }

    /// An unknown zone (422) is a refusal to take quietly, not an error.
    func testAnUnknownZoneIsARefusal() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 422, code: "VALIDATION_FAILED"),
            for: "updateSettings"
        )

        let outcome = try await Self.makeService(transport: transport)
            .updateTimeZone("Mars/Olympus_Mons", basedOn: 1)

        XCTAssertEqual(outcome, .refused)
    }

    /// A version that moved is a conflict for the caller to read again.
    func testAMovedVersionIsAConflict() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 409, code: "SETTINGS_VERSION_CONFLICT"),
            for: "updateSettings"
        )

        let outcome = try await Self.makeService(transport: transport)
            .updateTimeZone("Asia/Tbilisi", basedOn: 1)

        XCTAssertEqual(outcome, .conflict)
    }

    private static func settingsResponse(
        zone: String,
        version: Int
    ) -> MockClientTransport.Response {
        .json(
            """
            {"sessionSize":10,"contentLocale":"en","defaultAnswerMode":"SELF_RATED",\
            "extraFactTypes":[],"soundEnabled":true,"hapticsEnabled":true,\
            "remindersEnabled":false,"desiredRetention":0.9,"timezone":"\(zone)",\
            "version":\(version),"updatedAt":"2027-01-15T08:00:00Z"}
            """
        )
    }

    private static func makeService(transport: MockClientTransport) -> ProgressService {
        ProgressService(
            clientFactory: APIClientFactory(
                configuration: APITestClient.configuration,
                transport: transport,
                identifiers: SequentialIdentifierProvider(),
                retryPolicy: RetryPolicy(maximumAttempts: 1),
                scheduler: RecordingBackoffScheduler(),
                jitter: ZeroJitterProvider()
            )
        )
    }
}

// MARK: - Doubles

private actor ScriptedTimeZoneSyncing: AccountTimeZoneSyncing {
    private var held: [AccountTimeZone]
    private var answers: [AccountTimeZoneUpdateOutcome]
    private let readFailure: Bool
    private(set) var reads = 0
    private(set) var sent: [(zone: String, version: Int)] = []

    init(
        held: [AccountTimeZone],
        answers: [AccountTimeZoneUpdateOutcome],
        readFailure: Bool = false
    ) {
        self.held = held
        self.answers = answers
        self.readFailure = readFailure
    }

    func accountTimeZone() async throws -> AccountTimeZone? {
        reads += 1
        if readFailure { throw APIError.transport("offline") }
        return held.isEmpty ? nil : held.removeFirst()
    }

    func updateTimeZone(
        _ identifier: String,
        basedOn version: Int
    ) async throws -> AccountTimeZoneUpdateOutcome {
        sent.append((identifier, version))
        return answers.removeFirst()
    }
}

private final class InMemoryTimeZoneReports: TimeZoneReportRecording, @unchecked Sendable {
    private var reported: [UUID: String] = [:]

    func reportedTimeZone(for userID: UUID) -> String? { reported[userID] }

    func recordReportedTimeZone(_ identifier: String, for userID: UUID) {
        reported[userID] = identifier
    }
}

private struct FixedTimeZoneScopes: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}
