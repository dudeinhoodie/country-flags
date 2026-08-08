import Foundation

/// The network boundary. The `URLSession` implementation and the generated
/// OpenAPI client arrive with IOS-002; this only fixes the substitution point
/// so feature code depends on a protocol from the start.
public protocol APITransport: Sendable {
    func send(_ request: APIRequest) async throws -> APIResponse
}

public struct APIRequest: Hashable, Sendable {
    public let method: String
    public let path: String

    public init(method: String = "GET", path: String) {
        self.method = method
        self.path = path
    }
}

public struct APIResponse: Hashable, Sendable {
    public let statusCode: Int
    public let body: Data

    public init(statusCode: Int, body: Data) {
        self.statusCode = statusCode
        self.body = body
    }
}

public enum APITransportError: Error, Equatable, Sendable {
    /// The transport is not assembled for this configuration yet.
    case notConfigured
    /// The mock transport has no answer registered for this request.
    case unhandled(APIRequest)
}

/// The default transport for Dev and Prod until IOS-002.
///
/// It deliberately throws instead of returning an empty success: a silent
/// placeholder success would hide unfinished work from the caller.
public struct UnconfiguredAPITransport: APITransport {
    public init() {}

    public func send(_ request: APIRequest) async throws -> APIResponse {
        _ = request
        throw APITransportError.notConfigured
    }
}

/// A deterministic transport for the Mock scheme and for tests: it answers
/// only with registered payloads and never reaches the network.
public struct MockAPITransport: APITransport {
    private let responses: [APIRequest: APIResponse]

    public init(responses: [APIRequest: APIResponse] = [:]) {
        self.responses = responses
    }

    public func send(_ request: APIRequest) async throws -> APIResponse {
        guard let response = responses[request] else {
            throw APITransportError.unhandled(request)
        }
        return response
    }
}
