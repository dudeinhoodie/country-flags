import Foundation

/// The parts of a failed response a caller may act on or show to support.
///
/// Nothing here is derived from a token or from personal data, so the value is
/// safe to log and to surface in a diagnostics screen.
public struct APIErrorDetails: Equatable, Sendable {
    public let statusCode: Int
    /// The stable machine code from the error envelope, or `UNKNOWN` when the
    /// response carried no envelope.
    public let code: String
    public let message: String
    /// Correlates the failure with a server log entry. The client sends it and
    /// the server echoes it back, so it is available even when the body is not.
    public let requestID: String?

    public init(statusCode: Int, code: String, message: String, requestID: String?) {
        self.statusCode = statusCode
        self.code = code
        self.message = message
        self.requestID = requestID
    }
}

/// The stable domain errors every caller sees.
///
/// Generated DTOs and transport types never leave this module: a feature maps
/// these cases to user-facing copy without knowing how the request was made.
public enum APIError: Error, Equatable, Sendable {
    /// Authentication is missing, expired or was rejected after a refresh.
    case unauthorized(APIErrorDetails)
    /// Authenticated but not allowed.
    case forbidden(APIErrorDetails)
    case notFound(APIErrorDetails)
    /// The request lost an idempotency or version race.
    case conflict(APIErrorDetails)
    case validationFailed(APIErrorDetails)
    case rateLimited(APIErrorDetails, retryAfter: Duration?)
    /// Any other client-side status.
    case client(APIErrorDetails)
    case server(APIErrorDetails)
    /// The request never produced a response.
    case transport(String)
    case decoding(String)
    case cancelled

    /// The identifier a user can hand to support.
    public var supportRequestID: String? {
        details?.requestID
    }

    public var details: APIErrorDetails? {
        switch self {
        case .unauthorized(let details),
            .forbidden(let details),
            .notFound(let details),
            .conflict(let details),
            .validationFailed(let details),
            .rateLimited(let details, _),
            .client(let details),
            .server(let details):
            return details
        case .transport, .decoding, .cancelled:
            return nil
        }
    }

    static func status(
        _ details: APIErrorDetails,
        retryAfter: Duration? = nil
    ) -> APIError {
        switch details.statusCode {
        case 401: .unauthorized(details)
        case 403: .forbidden(details)
        case 404: .notFound(details)
        case 409: .conflict(details)
        case 422: .validationFailed(details)
        case 429: .rateLimited(details, retryAfter: retryAfter)
        case 500...599: .server(details)
        default: .client(details)
        }
    }
}

extension APIError {
    /// Unwraps whatever the generated client throws.
    ///
    /// A middleware error is wrapped by the runtime, so a caller that inspected
    /// the thrown value directly would see a transport type instead of the
    /// domain error the middleware produced.
    public static func from(_ error: any Error) -> APIError {
        if let apiError = error as? APIError {
            return apiError
        }
        if error is CancellationError {
            return .cancelled
        }
        if let urlError = error as? URLError {
            return urlError.code == .cancelled
                ? .cancelled
                : .transport(urlError.code.rawValue.description)
        }
        // ClientError and DecodingError both carry an underlying cause worth
        // unwrapping before falling back to a description.
        let mirror = Mirror(reflecting: error)
        for child in mirror.children where child.label == "underlyingError" {
            if let underlying = child.value as? any Error {
                return from(underlying)
            }
        }
        if error is DecodingError {
            return .decoding(String(describing: type(of: error)))
        }
        return .transport(String(describing: type(of: error)))
    }
}
