import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Carries the fresh proof a sensitive operation requires.
///
/// The contract declares it as a security scheme — `X-Reauthentication-Token`
/// — so no generated operation takes it as a parameter. It is attached here,
/// on a client built for one call, rather than on the shared one: a proof that
/// rode along with every request would be a proof for operations nobody
/// re-authenticated for.
///
/// It is never logged: the logging middleware records header names it knows,
/// and this one is not among them.
struct ReauthenticationMiddleware: ClientMiddleware {
    /// The name the contract's `ReauthenticationToken` scheme uses.
    static let headerName = "X-Reauthentication-Token"

    let token: String

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var proven = request
        if let field = HTTPField.Name(Self.headerName) {
            proven.headerFields[field] = token
        }
        return try await next(proven, body, baseURL)
    }
}
