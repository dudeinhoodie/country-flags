import Foundation

import CountryFlagsDomain

#if canImport(MetricKit)
    import MetricKit
#endif

/// Turns what MetricKit hands over into something that may leave the device,
/// and keeps it until it can.
///
/// MetricKit delivers once a day, usually at launch, and the payload is Apple's
/// JSON. Three things happen to it before it is anybody's business: it is
/// scrubbed against the export denylist, it is compressed — a day of diagnostics
/// does not fit the contract's ceiling otherwise — and it is checksummed, so a
/// truncated upload is refused rather than stored as a mystery.
///
/// Nothing is uploaded without consent for diagnostics, and nothing is uploaded
/// at all until something asks: a payload delivered at launch is stored and
/// waits, which is also what makes an offline device lose nothing.
public actor DiagnosticsCoordinator: TelemetryConsentApplying {
    private let repository: any TelemetryRepository
    private let scopes: any AccountScopeResolving
    private let uploader: (any DiagnosticsUploading)?
    private let identifiers: any IdentifierProviding
    private let dates: any DateProviding
    private let appVersion: String
    private let build: String
    private let logger: any AppLogging

    private var consent: TelemetryConsent

    /// The contract caps the base64 payload at 349,528 characters. Base64 grows
    /// bytes by a third, so the compressed report has to stay under this to fit.
    static let maximumCompressedBytes = 262_144
    /// What a single scrubbed report may contribute before compression. A day
    /// of MetricKit is far smaller; the cap is what stops a pathological one.
    static let maximumScrubbedCharacters = 512 * 1024

    public init(
        repository: any TelemetryRepository,
        scopes: any AccountScopeResolving,
        uploader: (any DiagnosticsUploading)? = nil,
        consent: TelemetryConsent,
        appVersion: String,
        build: String,
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpLogger()
    ) {
        self.repository = repository
        self.scopes = scopes
        self.uploader = uploader
        self.consent = consent
        self.appVersion = appVersion
        self.build = build
        self.identifiers = identifiers
        self.dates = dates
        self.logger = logger
    }

    public func adopt(consent updated: TelemetryConsent) async {
        let wasAllowed = consent.allowsDiagnostics
        consent = updated
        guard wasAllowed, !updated.allowsDiagnostics else { return }
        // Withdrawing diagnostics consent is retroactive for the same reason
        // withdrawing analytics consent is: reports collected under the old
        // answer must not leave under the new one. They are dropped rather
        // than held: a report nobody may ever send is only a liability.
        let scope = await scopes.currentScope()
        let pending = (try? await repository.pendingDiagnosticReports(for: scope)) ?? []
        guard !pending.isEmpty else { return }
        logger.log(
            .notice,
            .analytics,
            "Pending diagnostics were discarded after consent was withdrawn",
            ["count": .count(pending.count)]
        )
        await discard(pending.map(\.id), scope: scope)
    }

    /// Stores one payload, scrubbed and compressed. Called by the MetricKit
    /// subscriber and, in tests, directly with a fixture.
    ///
    /// - Returns: whether anything was stored, which is what the consent and
    ///   size tests assert on.
    @discardableResult
    public func record(payload raw: String, generatedAt: Date) async -> Bool {
        guard consent.allowsDiagnostics else { return false }
        let scrubbed = TelemetryRedaction.scrub(raw, limit: Self.maximumScrubbedCharacters)
        guard let compressed = Self.compress(Data(scrubbed.utf8)) else {
            logger.log(.notice, .analytics, "A diagnostic payload could not be compressed")
            return false
        }
        guard compressed.count <= Self.maximumCompressedBytes else {
            // Too large to send is not something to store forever; the report
            // is dropped and the fact of it is a log line, not a payload.
            logger.log(.notice, .analytics, "A diagnostic payload was too large to send")
            return false
        }
        let scope = await scopes.currentScope()
        let record = PendingDiagnosticReportRecord(
            id: identifiers.next(),
            kind: Self.metricKitKind,
            payload: compressed,
            capturedAt: generatedAt
        )
        try? await repository.enqueueDiagnosticReport(record, for: scope)
        return true
    }

    /// Sends what is waiting. Best effort by design: a report that cannot be
    /// delivered stays for the next attempt, and a refused one is dropped
    /// rather than retried forever.
    public func flush() async {
        guard let uploader, consent.allowsDiagnostics else { return }
        let scope = await scopes.currentScope()
        let pending = (try? await repository.pendingDiagnosticReports(for: scope)) ?? []
        guard !pending.isEmpty else { return }

        for report in pending where report.kind == Self.metricKitKind {
            let upload = DiagnosticReportUpload(
                id: report.id,
                appVersion: appVersion,
                build: build,
                generatedAt: report.capturedAt,
                sha256: Self.digest(of: report.payload),
                payload: report.payload
            )
            do {
                try await uploader.upload(upload)
            } catch let error as PresentableError where error.kind == .offline {
                // Nothing is wrong with the report; the device is not online.
                return
            } catch {
                logger.log(.notice, .analytics, "A diagnostic report was refused and dropped")
            }
            await discard([report.id], scope: scope)
        }
    }

    static let metricKitKind = "metrickit"

    // MARK: - Helpers

    private func discard(_ ids: [UUID], scope: AccountScope) async {
        try? await repository.removeDiagnosticReports(ids: ids, for: scope)
    }

    private static func digest(of data: Data) -> String {
        SHA256Digest.hexDigest(of: data)
    }

    /// zlib, through the compression the platform already ships. The contract
    /// asks for gzip; the two differ only in their framing, which the helper
    /// adds.
    private static func compress(_ data: Data) -> Data? {
        GzipEncoder.encode(data)
    }
}
