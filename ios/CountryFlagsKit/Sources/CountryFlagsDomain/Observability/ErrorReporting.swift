import Foundation

/// What is kept about a failure.
///
/// Everything here is machine-readable. There is no field for a server message
/// or an exception description, because those are the payloads that quietly
/// carry an email address or an answer into a crash report.
public struct ErrorContext: Hashable, Sendable {
    public let category: LogCategory
    /// A stable identifier of the operation, such as `getAppConfig`.
    public let operation: String
    /// The route template without a query, never the resolved URL.
    public let endpointTemplate: String?
    public let statusCode: Int?
    /// The registered machine code from the error envelope.
    public let errorCode: String?
    public let requestID: String?
    public let appBuild: String?
    public let connectivity: ConnectivityClass?
    public let isRecoverable: Bool

    public init(
        category: LogCategory,
        operation: String,
        endpointTemplate: String? = nil,
        statusCode: Int? = nil,
        errorCode: String? = nil,
        requestID: String? = nil,
        appBuild: String? = nil,
        connectivity: ConnectivityClass? = nil,
        isRecoverable: Bool = true
    ) {
        self.category = category
        self.operation = operation
        self.endpointTemplate = endpointTemplate
        self.statusCode = statusCode
        self.errorCode = errorCode
        self.requestID = requestID
        self.appBuild = appBuild
        self.connectivity = connectivity
        self.isRecoverable = isRecoverable
    }
}

public enum ConnectivityClass: String, Hashable, Sendable, CaseIterable {
    case unknown
    case offline
    case cellular
    case wifi
}

/// A step on the way to a failure.
///
/// The message is redacted on construction, so a breadcrumb dropped in at a
/// call site cannot become the place a token escapes.
public struct SafeBreadcrumb: Hashable, Sendable {
    public let category: LogCategory
    public let event: String
    public let occurredAt: Date
    public let fields: [String: String]

    public init(
        category: LogCategory,
        event: String,
        occurredAt: Date,
        fields: [String: String] = [:]
    ) {
        self.category = category
        self.event = event
        self.occurredAt = occurredAt
        self.fields = Redaction.redact(fields: fields)
    }
}

/// The opaque identity attached to reports after a permitted identification.
/// Cleared on sign-out.
public struct ErrorUserContext: Hashable, Sendable {
    public let analyticsSubjectID: UUID

    public init(analyticsSubjectID: UUID) {
        self.analyticsSubjectID = analyticsSubjectID
    }
}

public protocol ErrorReporting: Sendable {
    func capture(error: Error, context: ErrorContext)
    func addBreadcrumb(_ breadcrumb: SafeBreadcrumb)
    func setUserContext(_ context: ErrorUserContext?)
}

/// The default until a crash reporting provider is chosen in its own work
/// package. Reporting must never be able to fail an operation, so this does
/// nothing and cannot throw.
public struct NoOpErrorReporter: ErrorReporting {
    public init() {}

    public func capture(error: Error, context: ErrorContext) {}
    public func addBreadcrumb(_ breadcrumb: SafeBreadcrumb) {}
    public func setUserContext(_ context: ErrorUserContext?) {}
}

/// What a screen is allowed to say about a failure.
///
/// The kind answers "what happened and what can be done"; the identifier is for
/// support. A technical code or a server message never reaches the interface.
public enum ErrorPresentationKind: String, Hashable, Sendable, CaseIterable {
    case offline
    case signInRequired
    case contentUnavailable
    case featureUnavailable
    case serverUnavailable
    case unexpected
}

public struct ErrorPresentation: Hashable, Sendable {
    public let kind: ErrorPresentationKind
    /// Shown only in diagnostics and copied into a support request.
    public let supportRequestID: String?
    public let isRetryable: Bool

    public init(kind: ErrorPresentationKind, supportRequestID: String?, isRetryable: Bool) {
        self.kind = kind
        self.supportRequestID = supportRequestID
        self.isRetryable = isRetryable
    }
}
