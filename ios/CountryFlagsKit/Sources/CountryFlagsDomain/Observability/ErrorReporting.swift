import Foundation

public enum ConnectivityClass: String, Hashable, Sendable {
    case unknown
    case offline
    case cellular
    case wifi
}

/// What may accompany a captured error.
///
/// Everything here is either a machine code or an identifier the backend
/// already knows. There is no field for a request body, a response body or a
/// full URL, so a report cannot carry one.
public struct ErrorContext: Hashable, Sendable {
    public let category: LogCategory
    /// The operation identifier of the contract, or another stable constant.
    public let operation: String
    public let statusCode: Int?
    /// The registered machine code from the error envelope.
    public let errorCode: String?
    public let requestID: String?
    /// Correlates a failure with the local work that caused it.
    public let localOperationID: UUID?
    public let connectivity: ConnectivityClass

    public init(
        category: LogCategory,
        operation: String,
        statusCode: Int? = nil,
        errorCode: String? = nil,
        requestID: String? = nil,
        localOperationID: UUID? = nil,
        connectivity: ConnectivityClass = .unknown
    ) {
        self.category = category
        self.operation = operation
        self.statusCode = statusCode
        self.errorCode = errorCode
        self.requestID = requestID
        self.localOperationID = localOperationID
        self.connectivity = connectivity
    }
}

/// A step on the way to a failure.
public struct SafeBreadcrumb: Hashable, Sendable {
    public let category: LogCategory
    /// A constant. A breadcrumb assembled from user input is user input.
    public let message: String
    public let occurredAt: Date

    public init(category: LogCategory, message: String, occurredAt: Date) {
        self.category = category
        self.message = message
        self.occurredAt = occurredAt
    }
}

/// The bounded identity a crash report may carry.
public struct ErrorUserContext: Hashable, Sendable {
    public let targetingKey: String
    public let isAuthenticated: Bool

    public init(targetingKey: String, isAuthenticated: Bool) {
        self.targetingKey = targetingKey
        self.isAuthenticated = isAuthenticated
    }
}

public protocol ErrorReporting: Sendable {
    func capture(error: any Error, context: ErrorContext)
    func addBreadcrumb(_ breadcrumb: SafeBreadcrumb)
    /// Passing nil clears it, which is what sign-out does.
    func setUserContext(_ context: ErrorUserContext?)
}

public struct NoOpErrorReporter: ErrorReporting {
    public init() {}

    public func capture(error: any Error, context: ErrorContext) {}
    public func addBreadcrumb(_ breadcrumb: SafeBreadcrumb) {}
    public func setUserContext(_ context: ErrorUserContext?) {}
}

/// A platform diagnostic report, such as the ones MetricKit delivers.
public struct DiagnosticReport: Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable {
        case crash
        case hang
        case launchPerformance
        case resourceUsage
    }

    public let kind: Kind
    public let appBuild: String
    public let collectedAt: Date
    /// Already sanitized by the caller: counts and durations, never a payload.
    public let measurements: [String: Double]

    public init(
        kind: Kind,
        appBuild: String,
        collectedAt: Date,
        measurements: [String: Double]
    ) {
        self.kind = kind
        self.appBuild = appBuild
        self.collectedAt = collectedAt
        self.measurements = measurements
    }
}

public protocol DiagnosticsReporting: Sendable {
    func report(_ report: DiagnosticReport) async
}

public struct NoOpDiagnosticsReporter: DiagnosticsReporting {
    public init() {}

    public func report(_ report: DiagnosticReport) async {}
}

/// What a screen is allowed to tell the person.
///
/// The server message is never it: an error envelope is written for an operator
/// and may name an internal rule. A screen shows copy chosen for `kind` in the
/// app's own language, plus the identifier support needs to find the request.
public struct PresentableError: Hashable, Sendable, Error {
    /// The raw values name the copy each kind is shown with, so a new kind
    /// without a translation is a missing string rather than a wrong message.
    public enum Kind: String, Hashable, Sendable, CaseIterable {
        case offline
        case timeout
        case unauthorized
        case forbidden
        case notFound = "not_found"
        case conflict
        case invalidInput = "invalid_input"
        case rateLimited = "rate_limited"
        case featureDisabled = "feature_disabled"
        case server
        case unexpected
    }

    public let kind: Kind
    /// The registered machine code, for a diagnostics screen and for logs.
    public let code: String?
    /// The identifier a person can hand to support.
    public let supportRequestID: String?

    public init(kind: Kind, code: String? = nil, supportRequestID: String? = nil) {
        self.kind = kind
        self.code = code
        self.supportRequestID = supportRequestID
    }
}
