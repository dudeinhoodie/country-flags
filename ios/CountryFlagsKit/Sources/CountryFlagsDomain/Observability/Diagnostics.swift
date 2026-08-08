import Foundation

/// The kinds of platform diagnostic the app forwards.
public enum DiagnosticReportKind: String, Hashable, Sendable, CaseIterable {
    case crash
    case hang
    case launchPerformance
    case resourceUsage
    case networkTransfer
}

/// A diagnostic captured on the device.
///
/// The payload is already sanitized when the report is built: an adapter is a
/// delivery mechanism, not the place where privacy is decided.
public struct DiagnosticReport: Hashable, Sendable {
    public let id: UUID
    public let kind: DiagnosticReportKind
    public let capturedAt: Date
    public let appBuild: String
    public let payload: Data

    public init(id: UUID, kind: DiagnosticReportKind, capturedAt: Date, appBuild: String, payload: Data) {
        self.id = id
        self.kind = kind
        self.capturedAt = capturedAt
        self.appBuild = appBuild
        self.payload = payload
    }
}

public protocol DiagnosticsReporting: Sendable {
    func report(_ report: DiagnosticReport) async
    /// Sign-out drops what has not been delivered together with the identity it
    /// belonged to.
    func reset() async
}

/// The default. Collection and delivery arrive with the diagnostics work
/// package; the boundary exists now so nothing has to be rewired then.
public struct NoOpDiagnosticsReporter: DiagnosticsReporting {
    public init() {}

    public func report(_ report: DiagnosticReport) async {}
    public func reset() async {}
}
