import Foundation
import HTTPTypes
import OpenAPIRuntime

/// A transport that answers from registered responses and never opens a socket.
///
/// It backs the Mock build configuration and the tests. Being deterministic is
/// the point: an unregistered operation fails loudly instead of returning an
/// empty success that would look like a working feature.
public actor MockClientTransport: ClientTransport {
    /// One prepared answer.
    public struct Response: Sendable {
        public let statusCode: Int
        public let headerFields: [String: String]
        public let body: Data?
        /// What the transport throws instead of answering: a connection the
        /// radio dropped, a host that did not resolve. No response then.
        public let failure: (any Error)?

        public init(
            statusCode: Int,
            headerFields: [String: String] = [:],
            body: Data? = nil,
            failure: (any Error)? = nil
        ) {
            self.statusCode = statusCode
            self.headerFields = headerFields
            self.body = body
            self.failure = failure
        }

        /// The request never got an answer.
        public static func transportFailure(_ error: any Error) -> Response {
            Response(statusCode: 0, failure: error)
        }

        public static func json(
            _ json: String,
            statusCode: Int = 200,
            headerFields: [String: String] = [:]
        ) -> Response {
            self.json(Data(json.utf8), statusCode: statusCode, headerFields: headerFields)
        }

        /// A document that is already encoded, such as one read from a file.
        public static func json(
            _ body: Data,
            statusCode: Int = 200,
            headerFields: [String: String] = [:]
        ) -> Response {
            Response(
                statusCode: statusCode,
                headerFields: headerFields.merging(["content-type": "application/json"]) { current, _ in current },
                body: body
            )
        }

        /// The canonical error envelope, so a test does not hand-write it.
        public static func errorEnvelope(
            statusCode: Int,
            code: String,
            message: String = "Test failure",
            requestID: String = "00000000-0000-4000-8000-000000000000",
            headerFields: [String: String] = [:]
        ) -> Response {
            json(
                """
                {"error":{"code":"\(code)","message":"\(message)",\
                "requestId":"\(requestID)","details":{}}}
                """,
                statusCode: statusCode,
                headerFields: headerFields
            )
        }
    }

    /// What the transport was asked to send.
    public struct RecordedRequest: Sendable {
        public let operationID: String
        public let method: String
        public let path: String
        public let headerFields: [String: String]
        public let body: Data?

        public func header(_ name: String) -> String? {
            headerFields[name.lowercased()]
        }
    }

    /// Answers an operation from the request itself, for the cases where one
    /// prepared response cannot be right for every call — a collection endpoint
    /// whose contents depend on the identifier in the path.
    public typealias Handler = @Sendable (RecordedRequest) -> Response

    public enum Failure: Error, Equatable {
        case noResponseRegistered(operationID: String)
    }

    private var queues: [String: [Response]] = [:]
    private var fallbacks: [String: Response] = [:]
    private var handlers: [String: Handler] = [:]
    public private(set) var recordedRequests: [RecordedRequest] = []

    /// - Parameters:
    ///   - fallbacks: answers registered before the transport is reachable. A
    ///     caller that has to `await` its way in cannot be sure the
    ///     registration wins the race against the first request.
    ///   - handlers: the same, for operations answered from the request.
    public init(fallbacks: [String: Response] = [:], handlers: [String: Handler] = [:]) {
        self.fallbacks = fallbacks
        self.handlers = handlers
    }

    /// Queues answers consumed in order. Used when the same operation must
    /// behave differently across attempts, such as failing and then succeeding.
    public func enqueue(_ responses: Response..., for operationID: String) {
        queues[operationID, default: []].append(contentsOf: responses)
    }

    /// Answers every call to an operation the same way.
    public func always(_ response: Response, for operationID: String) {
        fallbacks[operationID] = response
    }

    /// Answers every call to an operation from the request that made it.
    public func always(_ handler: @escaping Handler, for operationID: String) {
        handlers[operationID] = handler
    }

    public func requests(for operationID: String) -> [RecordedRequest] {
        recordedRequests.filter { $0.operationID == operationID }
    }

    public func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var collected: Data?
        if let body {
            collected = try await Data(collecting: body, upTo: 4 * 1024 * 1024)
        }
        let recorded = RecordedRequest(
            operationID: operationID,
            method: request.method.rawValue,
            path: request.path ?? "",
            headerFields: Dictionary(
                request.headerFields.map { ($0.name.canonicalName.lowercased(), $0.value) },
                uniquingKeysWith: { first, _ in first }
            ),
            body: collected
        )
        recordedRequests.append(recorded)

        // A queued answer is consumed first because it is the one registered to
        // make this particular call behave differently.
        let response: Response
        if !(queues[operationID]?.isEmpty ?? true) {
            response = queues[operationID]!.removeFirst()
        } else if let fallback = fallbacks[operationID] {
            response = fallback
        } else if let handler = handlers[operationID] {
            response = handler(recorded)
        } else {
            throw Failure.noResponseRegistered(operationID: operationID)
        }
        if let failure = response.failure {
            throw failure
        }

        var httpResponse = HTTPResponse(status: .init(code: response.statusCode))
        for (name, value) in response.headerFields {
            if let field = HTTPField.Name(name) {
                httpResponse.headerFields[field] = value
            }
        }
        return (httpResponse, response.body.map { HTTPBody($0) })
    }
}
