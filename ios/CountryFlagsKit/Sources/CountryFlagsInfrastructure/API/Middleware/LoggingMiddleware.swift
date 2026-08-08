import Foundation
import HTTPTypes
import OSLog
import OpenAPIRuntime

/// What the client is allowed to record about a request.
///
/// The type has no field for a header, a body or a URL query, so no logger
/// implementation can record a token, an identity payload or a search term.
public struct APIRequestLogEntry: Equatable, Sendable {
    public let operationID: String
    public let method: String
    /// Path only. A query string can carry a locale or a cursor, so it is not
    /// worth the risk of also carrying something personal.
    public let path: String
    public let statusCode: Int?
    public let errorCode: String?
    public let requestID: String?
    public let durationMilliseconds: Int
}

public protocol APIRequestLogging: Sendable {
    func record(_ entry: APIRequestLogEntry)
}

/// The default logger. Values are interpolated as public only because the type
/// itself guarantees they are not secrets.
public struct OSLogAPIRequestLogger: APIRequestLogging {
    private let logger: Logger

    public init(subsystem: String = "app.countryflags", category: String = "api") {
        self.logger = Logger(subsystem: subsystem, category: category)
    }

    public func record(_ entry: APIRequestLogEntry) {
        logger.info(
            """
            \(entry.method, privacy: .public) \(entry.path, privacy: .public) \
            operation=\(entry.operationID, privacy: .public) \
            status=\(entry.statusCode ?? -1, privacy: .public) \
            error=\(entry.errorCode ?? "-", privacy: .public) \
            requestID=\(entry.requestID ?? "-", privacy: .public) \
            durationMs=\(entry.durationMilliseconds, privacy: .public)
            """
        )
    }
}

public struct NoOpAPIRequestLogger: APIRequestLogging {
    public init() {}

    public func record(_ entry: APIRequestLogEntry) {}
}

struct LoggingMiddleware: ClientMiddleware {
    let logger: any APIRequestLogging

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let startedAt = ContinuousClock.now
        let requestID = request.headerFields[HTTPField.Name(ClientHeader.requestID)!]

        func record(statusCode: Int?, errorCode: String?) {
            logger.record(
                APIRequestLogEntry(
                    operationID: operationID,
                    method: request.method.rawValue,
                    path: request.path.map { $0.split(separator: "?")[0] }.map(String.init) ?? "",
                    statusCode: statusCode,
                    errorCode: errorCode,
                    requestID: requestID,
                    durationMilliseconds: Int(
                        (ContinuousClock.now - startedAt).components.seconds * 1_000
                            + (ContinuousClock.now - startedAt).components.attoseconds
                            / 1_000_000_000_000_000
                    )
                )
            )
        }

        do {
            let (response, responseBody) = try await next(request, body, baseURL)
            record(statusCode: response.status.code, errorCode: nil)
            return (response, responseBody)
        } catch {
            let apiError = APIError.from(error)
            record(
                statusCode: apiError.details?.statusCode,
                // Only the registered machine code is recorded: an arbitrary
                // error description could carry payload text.
                errorCode: apiError.details?.code ?? Self.transportCode(for: apiError)
            )
            throw error
        }
    }

    private static func transportCode(for error: APIError) -> String {
        switch error {
        case .cancelled: "CANCELLED"
        case .transport: "TRANSPORT"
        case .decoding: "DECODING"
        default: "UNKNOWN"
        }
    }
}
