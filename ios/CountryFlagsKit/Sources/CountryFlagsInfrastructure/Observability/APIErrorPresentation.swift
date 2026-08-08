import Foundation

import CountryFlagsDomain

extension APIError {
    /// What a screen may say about this failure.
    ///
    /// The server message is deliberately not carried over: it is written for
    /// an operator, it can quote a payload, and it is not localized. The screen
    /// gets a kind it can turn into its own copy, plus the request identifier
    /// support needs.
    public var presentation: ErrorPresentation {
        ErrorPresentation(
            kind: presentationKind,
            supportRequestID: supportRequestID,
            isRetryable: isRetryable
        )
    }

    private var presentationKind: ErrorPresentationKind {
        switch self {
        case .unauthorized: .signInRequired
        case .notFound: .contentUnavailable
        case .transport: .offline
        case .server, .rateLimited: .serverUnavailable
        case .forbidden(let details):
            // The one code a screen reacts to differently: a switched-off
            // feature is not the user's mistake and not worth an error banner.
            details.code == "FEATURE_DISABLED" ? .featureUnavailable : .unexpected
        case .client, .conflict, .validationFailed, .decoding, .cancelled: .unexpected
        }
    }

    private var isRetryable: Bool {
        switch self {
        case .transport, .server, .rateLimited: true
        default: false
        }
    }

    /// The failure as an error report describes it: an operation identifier,
    /// registered codes and the request identifier, and nothing else.
    public func errorContext(operation: String, endpointTemplate: String?) -> ErrorContext {
        ErrorContext(
            category: .network,
            operation: operation,
            endpointTemplate: endpointTemplate,
            statusCode: details?.statusCode,
            errorCode: details?.code,
            requestID: supportRequestID,
            isRecoverable: isRetryable
        )
    }
}
