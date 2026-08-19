import Foundation

/// A sanitized diagnostic report on its way out.
///
/// The payload is already gzipped, base64-encoded and checksummed by the time
/// it reaches this type: the compression is what keeps a day of MetricKit
/// inside the contract's size ceiling, and the checksum is what lets the
/// backend refuse a truncated one.
public struct DiagnosticReportUpload: Hashable, Sendable {
    public let id: UUID
    public let appVersion: String
    public let build: String
    public let generatedAt: Date
    /// The digest of `payload` — the compressed bytes, before base64 — because
    /// that is what the backend recomputes and compares against.
    public let sha256: String
    /// The gzipped report. The transport base64-encodes it; keeping the bytes
    /// here means the digest and the encoding cannot disagree.
    public let payload: Data

    public init(
        id: UUID,
        appVersion: String,
        build: String,
        generatedAt: Date,
        sha256: String,
        payload: Data
    ) {
        self.id = id
        self.appVersion = appVersion
        self.build = build
        self.generatedAt = generatedAt
        self.sha256 = sha256
        self.payload = payload
    }
}

/// Sends a diagnostic report. Separated from whatever captured it so the
/// capture path can be tested without a socket, and so a provider swap is a
/// composition change.
public protocol DiagnosticsUploading: Sendable {
    func upload(_ report: DiagnosticReportUpload) async throws
}

/// What the backend did with a consent change.
public enum PrivacySettingsUpdateOutcome: Sendable, Equatable {
    case updated(TelemetryConsent)
    /// Another device answered first. The server's settings come back with it
    /// so the caller can take them rather than retry and overwrite an answer
    /// somebody just gave.
    case conflict(TelemetryConsent?)
}

/// Reads and writes the account's consent.
public protocol PrivacySettingsSyncing: Sendable {
    func privacySettings() async throws -> TelemetryConsent
    func update(_ consent: TelemetryConsent) async throws -> PrivacySettingsUpdateOutcome
}

/// Something that collects under a consent decision and must be told when it
/// changes.
///
/// Declared here so the screen that offers the switches can hand the answer to
/// the collectors without importing the layer they live in — and so a new
/// collector is one more conformance rather than one more call site to
/// remember.
public protocol TelemetryConsentApplying: Sendable {
    func adopt(consent: TelemetryConsent) async
}
