import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Attaches the session token and recovers from a single expiry.
///
/// A 401 is retried exactly once, after one coordinated refresh. Retrying more
/// than once would turn a rejected session into a request loop, and refreshing
/// per request would rotate the refresh token from under the other requests.
struct AuthenticationMiddleware: ClientMiddleware {
    let tokens: any AuthorizationTokenProviding
    let refreshCoordinator: TokenRefreshCoordinator

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let token = await tokens.currentAccessToken()
        let buffered = try await BufferedBody.collect(body)

        var authorized = request
        if let token {
            authorized.headerFields[.authorization] = "Bearer \(token)"
        }

        let (response, responseBody) = try await next(
            authorized,
            buffered.makeBody(),
            baseURL
        )
        // Any 401 is worth one refresh — including the request that went out
        // with no token at all, which is what a launch that could not reach
        // the backend leaves behind: a session with nothing in hand. Gated on
        // the token, the first request after such a launch was refused, and
        // so was every one after it until a relaunch. A guest has nothing to
        // refresh and the provider says so by throwing; for them the 401 is
        // the answer, not a hint.
        guard response.status.code == 401 else {
            return (response, responseBody)
        }

        let refreshed: String
        do {
            refreshed = try await refreshCoordinator.refresh(replacing: token)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // A failed refresh means the session is gone. The original 401 is
            // the honest outcome; the caller re-authenticates.
            return (response, responseBody)
        }

        var retried = request
        retried.headerFields[.authorization] = "Bearer \(refreshed)"
        return try await next(retried, buffered.makeBody(), baseURL)
    }
}
