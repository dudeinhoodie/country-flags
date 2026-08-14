import Foundation

import CountryFlagsDomain

/// Owns the session: who is signed in, which token to send, and what happens
/// when the backend stops accepting it.
///
/// It is also the account scope every repository writes under, because those
/// are the same question asked twice. Signing in changes the answer, and the
/// guest scope it replaces is left exactly as it was — the progress made before
/// signing in is imported deliberately, never absorbed by a scope change.
///
/// The access token stays in memory and only the refresh token is written to
/// the keychain. An access token is short-lived and a rotated one makes the
/// stored copy a liability rather than a saving.
public actor SessionCoordinator: SessionControlling, AuthorizationTokenProviding,
    AccountScopeResolving
{
    private let service: any AuthenticationService
    private let tokens: any SecureTokenStoring
    private let guestScopes: any AccountScopeResolving
    private let logger: any AppLogging

    private var accessToken: String?
    private var state: AuthenticationState = .guest

    public init(
        service: any AuthenticationService,
        tokens: any SecureTokenStoring,
        guestScopes: any AccountScopeResolving,
        logger: any AppLogging = OSLogAppLogger()
    ) {
        self.service = service
        self.tokens = tokens
        self.guestScopes = guestScopes
        self.logger = logger
    }

    // MARK: - State

    public func currentState() async -> AuthenticationState { state }

    public func currentProfile() async -> AccountProfile? {
        guard state.isAuthenticated else { return nil }
        let name = try? await tokens.value(for: .accountDisplayName)
        let avatar = try? await tokens.value(for: .accountAvatarURL)
        return AccountProfile(
            displayName: name.flatMap { $0.isEmpty ? nil : $0 },
            avatarURL: avatar.flatMap { $0.isEmpty ? nil : URL(string: $0) }
        )
    }

    public func adoptProviderProfile(name: String?, avatarURL: URL?) async {
        guard state.isAuthenticated else { return }
        // The backend's own name wins: what the provider shared fills the gap
        // only where the account has none.
        if let name, !name.isEmpty {
            let stored = try? await tokens.value(for: .accountDisplayName)
            if stored == nil || stored?.isEmpty == true {
                try? await tokens.setValue(name, for: .accountDisplayName)
            }
        }
        if let avatarURL {
            try? await tokens.setValue(avatarURL.absoluteString, for: .accountAvatarURL)
        }
    }

    /// Restores what a previous launch left behind.
    ///
    /// A stored refresh token means an account, so the app reports itself as
    /// signed in before any network call: the first request refreshes, and a
    /// refusal moves the state on its own. Announcing "guest" first would flash
    /// a signed-out interface at somebody who is not.
    public func restore() async {
        guard case .guest = state,
            let refreshToken = await storedRefreshToken(),
            let stored = try? await tokens.value(for: .accountUserID),
            let userID = UUID(uuidString: stored)
        else {
            return
        }
        guard let session = try? await service.refresh(refreshToken: refreshToken) else {
            // The stored token is spent or revoked. The account is known to
            // have existed, so this is an expired session rather than a guest,
            // and nothing of the guest's own data is touched by saying so.
            state = .authenticationExpired(userID: nil)
            return
        }
        await adopt(session)
        // The rotation says nothing about whose account it is; the identifier
        // stored beside the token does, which is why a relaunch needs no call
        // to find out who it is.
        state = .authenticated(userID: userID)
    }

    // MARK: - Signing in

    public func signIn(with credential: ProviderCredential) async -> SignInOutcome {
        state = .authenticating(credential.provider)
        do {
            let session = try await service.exchange(credential)
            await adopt(session)
            return .succeeded(userID: session.userID)
        } catch {
            state = .guest
            return .failed(Self.failure(from: error))
        }
    }

    public func signOut(everywhere: Bool) async {
        if everywhere {
            try? await service.logoutEverywhere()
        } else if let refreshToken = await storedRefreshToken() {
            try? await service.logout(refreshToken: refreshToken)
        }
        // The secrets go first: a failed network call must not leave a device
        // holding a session it believes it no longer has.
        try? await tokens.setValue(nil, for: .refreshToken)
        try? await tokens.setValue(nil, for: .accountUserID)
        try? await tokens.setValue(nil, for: .accountDisplayName)
        try? await tokens.setValue(nil, for: .accountAvatarURL)
        accessToken = nil
        state = .guest
    }

    // MARK: - AuthorizationTokenProviding

    public func currentAccessToken() async -> String? { accessToken }

    public func refreshAccessToken() async throws -> String {
        guard let refreshToken = await storedRefreshToken() else {
            throw APIError.unauthorized(
                APIErrorDetails(
                    statusCode: 401,
                    code: "NO_SESSION",
                    message: "There is no session to refresh",
                    requestID: nil
                )
            )
        }
        do {
            let session = try await service.refresh(refreshToken: refreshToken)
            await adopt(session)
            return session.accessToken
        } catch {
            // A refused refresh ends the session rather than retrying: the
            // token has rotated or been revoked, and presenting it again would
            // only be refused again.
            let userID: UUID? = if case .authenticated(let id) = state { id } else { nil }
            state = .authenticationExpired(userID: userID)
            accessToken = nil
            // The refresh token is spent; the account identifier stays so the
            // interface can name who has to sign in again.
            try? await tokens.setValue(nil, for: .refreshToken)
            logger.log(.info, .sync, "The session expired and the app is signed out")
            throw APIError.from(error)
        }
    }

    // MARK: - AccountScopeResolving

    public func currentScope() async -> AccountScope {
        if case .authenticated(let userID) = state {
            return .authenticated(userID: userID)
        }
        return await guestScopes.currentScope()
    }

    // MARK: - Helpers

    private func storedRefreshToken() async -> String? {
        guard let token = try? await tokens.value(for: .refreshToken), !token.isEmpty else {
            return nil
        }
        return token
    }

    /// Takes the tokens of a rotation. The account it belongs to is unchanged,
    /// so the state is left to whoever knows it.
    private func adopt(_ session: RefreshedSessionRecord) async {
        accessToken = session.accessToken
        try? await tokens.setValue(session.refreshToken, for: .refreshToken)
    }

    private func adopt(_ session: AuthSessionRecord) async {
        accessToken = session.accessToken
        state = .authenticated(userID: session.userID)
        try? await tokens.setValue(session.refreshToken, for: .refreshToken)
        try? await tokens.setValue(session.userID.uuidString, for: .accountUserID)
        try? await tokens.setValue(session.displayName, for: .accountDisplayName)
    }

    private static func failure(from error: any Error) -> SignInFailure {
        switch APIError.from(error) {
        case .transport, .cancelled: .offline
        case .unauthorized(let details), .forbidden(let details): .rejected(code: details.code)
        case .conflict(let details), .validationFailed(let details): .rejected(code: details.code)
        case .notFound(let details), .client(let details): .rejected(code: details.code)
        case .rateLimited(let details, _): .rejected(code: details.code)
        case .server(let details): .provider(code: details.code)
        case .decoding: .provider(code: "DECODING_FAILED")
        }
    }
}
