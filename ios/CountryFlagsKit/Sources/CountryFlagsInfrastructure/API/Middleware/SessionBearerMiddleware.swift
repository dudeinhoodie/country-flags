import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Carries the bearer of the session that is ending.
///
/// The auth client has no token provider of its own: the session needs a
/// client before it exists, and every other client needs the session. The two
/// sign-outs are nonetheless private routes, so the session hands over the
/// token it holds and this attaches it to a client built for that one call.
///
/// It sits innermost, below the logging and retry layers, so the value is
/// attached to exactly the request that leaves and to nothing a log can see.
struct SessionBearerMiddleware: ClientMiddleware {
    let token: String

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var authorized = request
        authorized.headerFields[.authorization] = "Bearer \(token)"
        return try await next(authorized, body, baseURL)
    }
}
