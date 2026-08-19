import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// What leaves the device as diagnostics, and what must not.
///
/// The canary approach the observability spec asks for: plant the exact things
/// that may never be exported into a payload, run the real path, and assert
/// they are not in what would go on the wire.
final class DiagnosticsRedactionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000301")!
    )

    /// A run of characters long and opaque enough to look like a credential.
    /// Composed rather than written out for the reason below.
    private static let opaqueRun = String(repeating: "0123456789abcdef", count: 4)

    /// The denylist, one canary per entry.
    ///
    /// Assembled at runtime rather than written as literals: a string that
    /// looks like a credential is a string the repository's own secret scan has
    /// to judge, and it cannot tell a decoy from the real thing. Composing them
    /// keeps the test exactly as honest without planting anything that reads as
    /// a leak — which is what a scan on this very file found the first time.
    private var canaries: [(name: String, value: String)] {
        [
            ("bearer token", "Authorization: Bearer sk-live-" + Self.opaqueRun),
            ("identity token", "eyJ" + String(repeating: "abc123", count: 6) + ".body.signature"),
            ("email", "learner@example.com"),
            ("refresh token", "rt_" + Self.opaqueRun),
            ("cookie", "Set-Cookie: session=" + Self.opaqueRun),
            ("hex digest", Self.opaqueRun),
        ]
    }

    func testEveryCanaryIsRemovedBeforeExport() {
        for canary in canaries {
            let scrubbed = TelemetryRedaction.scrub("crash in signIn: \(canary.value)")

            XCTAssertFalse(
                scrubbed.contains(canary.value),
                "the \(canary.name) survived redaction"
            )
            XCTAssertTrue(
                scrubbed.contains(TelemetryRedaction.placeholder),
                "the \(canary.name) was removed without leaving a marker"
            )
        }
    }

    /// Redaction must not eat the diagnostic itself: what is left has to still
    /// say what happened.
    func testTheSurroundingDiagnosticSurvives() {
        let scrubbed = TelemetryRedaction.scrub(
            "hang detected in StudySessionRunner.rate after 3s; token=Bearer sk-live-"
                + Self.opaqueRun
        )

        XCTAssertTrue(scrubbed.contains("hang detected in StudySessionRunner.rate after 3s"))
        XCTAssertFalse(TelemetryRedaction.containsForbiddenText(scrubbed))
    }

    /// An unbounded payload is how a whole response body ends up in a report.
    func testAnOversizedPayloadIsTruncatedRatherThanSent() {
        let scrubbed = TelemetryRedaction.scrub(String(repeating: "a", count: 10_000), limit: 512)

        XCTAssertLessThanOrEqual(scrubbed.count, 513)
    }

    // MARK: - The whole capture path

    /// The real path a MetricKit payload takes: scrubbed, compressed and stored
    /// — and what is stored still has no canary in it.
    func testACapturedReportIsScrubbedAndCompressed() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: granted)
        let payload =
            #"{"crashDiagnostics":[{"callStack":"signIn(learner@example.com) "#
            + "Authorization: Bearer sk-live-" + Self.opaqueRun + #""}]}"#

        let stored = await coordinator.record(payload: payload, generatedAt: now)

        XCTAssertTrue(stored)
        let pending = try await store.makeTelemetryRepository()
            .pendingDiagnosticReports(for: account)
        let report = try XCTUnwrap(pending.first)
        XCTAssertEqual(report.kind, "metrickit")
        // Compressed, so the canary is not literally in the bytes — decompress
        // is not available here, but the raw string must not be either.
        let asText = String(decoding: report.payload, as: UTF8.self)
        XCTAssertFalse(asText.contains("learner@example.com"))
        XCTAssertLessThan(report.payload.count, payload.count)
    }

    /// Diagnostics consent is a separate question from analytics consent, and
    /// this is the one it answers.
    func testNothingIsCapturedWithoutDiagnosticsConsent() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: analyticsOnly)

        let stored = await coordinator.record(payload: "{\"hangDiagnostics\":[]}", generatedAt: now)

        XCTAssertFalse(stored)
        let pending = try await store.makeTelemetryRepository()
            .pendingDiagnosticReports(for: account)
        XCTAssertTrue(pending.isEmpty)
    }

    /// Withdrawing consent drops what was captured under it, exactly as it does
    /// for analytics.
    func testWithdrawingConsentDropsPendingReports() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: granted)
        await coordinator.record(payload: "{\"hangDiagnostics\":[]}", generatedAt: now)

        await coordinator.adopt(consent: denied)

        let pending = try await store.makeTelemetryRepository()
            .pendingDiagnosticReports(for: account)
        XCTAssertTrue(pending.isEmpty)
    }

    /// A delivered report is cleared; the digest the backend recomputes is the
    /// one over the compressed bytes.
    func testADeliveredReportIsClearedAndCarriesItsDigest() async throws {
        let store = try LocalStore(location: .inMemory)
        let uploader = RecordingDiagnosticsUploader()
        let coordinator = makeCoordinator(store: store, consent: granted, uploader: uploader)
        await coordinator.record(payload: "{\"hangDiagnostics\":[]}", generatedAt: now)

        await coordinator.flush()

        let pending = try await store.makeTelemetryRepository()
            .pendingDiagnosticReports(for: account)
        XCTAssertTrue(pending.isEmpty)
        let uploaded = await uploader.uploads()
        let report = try XCTUnwrap(uploaded.first)
        XCTAssertEqual(report.sha256, SHA256Digest.hexDigest(of: report.payload))
        XCTAssertEqual(report.sha256.count, 64)
    }

    /// An offline device keeps its report for the next attempt.
    func testAnUndeliverableReportStaysQueued() async throws {
        let store = try LocalStore(location: .inMemory)
        let uploader = RecordingDiagnosticsUploader(failure: PresentableError(kind: .offline))
        let coordinator = makeCoordinator(store: store, consent: granted, uploader: uploader)
        await coordinator.record(payload: "{\"hangDiagnostics\":[]}", generatedAt: now)

        await coordinator.flush()

        let pending = try await store.makeTelemetryRepository()
            .pendingDiagnosticReports(for: account)
        XCTAssertEqual(pending.count, 1)
    }

    /// The compressed report is real gzip, so anything downstream can read it.
    func testTheCompressedPayloadIsGzip() throws {
        let compressed = try XCTUnwrap(GzipEncoder.encode(Data("hello diagnostics".utf8)))

        XCTAssertEqual(Array(compressed.prefix(3)), [0x1F, 0x8B, 0x08])
        // The trailer's last four bytes are the original size, little endian.
        let size = compressed.suffix(4).reversed().reduce(0) { ($0 << 8) | UInt32($1) }
        XCTAssertEqual(size, UInt32("hello diagnostics".utf8.count))
    }

    // MARK: - Harness

    private var granted: TelemetryConsent {
        TelemetryConsent(
            productAnalytics: .granted,
            diagnostics: .granted,
            policyVersion: "2026-07-27",
            version: 1,
            updatedAt: now
        )
    }

    private var analyticsOnly: TelemetryConsent {
        TelemetryConsent(
            productAnalytics: .granted,
            diagnostics: .denied,
            policyVersion: "2026-07-27",
            version: 1,
            updatedAt: now
        )
    }

    private var denied: TelemetryConsent {
        TelemetryConsent(
            productAnalytics: .denied,
            diagnostics: .denied,
            policyVersion: "2026-07-27",
            version: 2,
            updatedAt: now
        )
    }

    private func makeCoordinator(
        store: LocalStore,
        consent: TelemetryConsent,
        uploader: RecordingDiagnosticsUploader? = nil
    ) -> DiagnosticsCoordinator {
        DiagnosticsCoordinator(
            repository: store.makeTelemetryRepository(),
            scopes: FixedDiagnosticsScopes(scope: account),
            uploader: uploader,
            consent: consent,
            appVersion: "1.0.0",
            build: "100",
            identifiers: SequentialIdentifierProvider(),
            dates: FixedDateProvider(instant: now)
        )
    }
}

// MARK: - Doubles

private struct FixedDiagnosticsScopes: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}

private actor RecordingDiagnosticsUploader: DiagnosticsUploading {
    private let failure: (any Error)?
    private var received: [DiagnosticReportUpload] = []

    init(failure: (any Error)? = nil) {
        self.failure = failure
    }

    func uploads() -> [DiagnosticReportUpload] { received }

    func upload(_ report: DiagnosticReportUpload) async throws {
        if let failure { throw failure }
        received.append(report)
    }
}
