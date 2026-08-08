import Foundation

/// The boundary to whatever holds the session.
///
/// Keychain storage and the real refresh call arrive with the authentication
/// work package; this protocol keeps the transport independent of them and
/// lets a test drive the refresh path without any storage.
public protocol AuthorizationTokenProviding: Sendable {
    /// The token to send, or nil while the user is a guest.
    func currentAccessToken() async -> String?
    /// Exchanges the refresh token for a new access token.
    func refreshAccessToken() async throws -> String
}

/// A provider for builds that have no session at all.
public struct GuestTokenProvider: AuthorizationTokenProviding {
    public init() {}

    public func currentAccessToken() async -> String? { nil }

    public func refreshAccessToken() async throws -> String {
        throw APIError.unauthorized(
            APIErrorDetails(
                statusCode: 401,
                code: "NO_SESSION",
                message: "A guest has no session to refresh",
                requestID: nil
            )
        )
    }
}

/// Serializes token refresh across concurrent requests.
///
/// Several requests can meet a 401 at the same time. Without coordination each
/// one would start its own refresh, and every refresh after the first would
/// present an already rotated refresh token, which the backend rejects. The
/// actor guarantees one refresh per rotation and hands its result to everyone
/// waiting.
public actor TokenRefreshCoordinator {
    private let provider: any AuthorizationTokenProviding
    private var inFlight: Task<String, any Error>?

    public init(provider: any AuthorizationTokenProviding) {
        self.provider = provider
    }

    /// Returns a token newer than `staleToken`.
    ///
    /// A caller that queued behind a finished refresh gets the fresh token
    /// without triggering another one.
    public func refresh(replacing staleToken: String?) async throws -> String {
        if let current = await provider.currentAccessToken(), current != staleToken {
            return current
        }
        if let inFlight {
            return try await inFlight.value
        }

        let task = Task { [provider] in try await provider.refreshAccessToken() }
        inFlight = task
        defer { inFlight = nil }
        return try await task.value
    }
}
