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
        // The identity first, off the keychain alone, so the state is
        // authenticated before the network is touched. This used to happen
        // only after the refresh returned, and the launch's sync — racing
        // this call — resolved its scope while the refresh was still in
        // flight: the first run synced the guest and the home screen opened
        // on a guest's empty numbers until a pull-to-refresh asked again.
        await ensureIdentityRestored()
        guard case .authenticated(let userID) = state,
            accessToken == nil,
            let refreshToken = await storedRefreshToken()
        else {
            return
        }
        do {
            let session = try await service.refresh(refreshToken: refreshToken)
            await adopt(session)
            // The rotation says nothing about whose account it is; the
            // identifier stored beside the token does, which is why a relaunch
            // needs no call to find out who it is.
            state = .authenticated(userID: userID)
        } catch {
            guard Self.endsTheSession(error) else {
                // Launched underground, or on hotel wifi that resolves nothing.
                // The token is as good as it was yesterday — nobody refused it
                // — so the app stays signed in and the first request that
                // reaches the backend refreshes for real.
                return
            }
            // The stored token is spent or revoked. The account is known to
            // have existed, so this is an expired session rather than a guest,
            // and nothing of the guest's own data is touched by saying so.
            state = .authenticationExpired(userID: userID)
            accessToken = nil
            try? await tokens.setValue(nil, for: .refreshToken)
        }
    }

    /// The keychain's answer to who this launch belongs to, read exactly once
    /// and awaited by every scope resolution: no caller can ask earlier than
    /// the answer exists. Deliberately without the network — the token's
    /// validity is the refresh's business, identity is the keychain's.
    private var identityRestoration: Task<Void, Never>?

    private func ensureIdentityRestored() async {
        if identityRestoration == nil {
            identityRestoration = Task { await restoreIdentity() }
        }
        await identityRestoration?.value
    }

    private func restoreIdentity() async {
        guard case .guest = state,
            await storedRefreshToken() != nil,
            let stored = try? await tokens.value(for: .accountUserID),
            let userID = UUID(uuidString: stored)
        else {
            return
        }
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
        //
        // A clearing that fails is the graver direction. The interface says
        // signed out and the refresh token is still on disk, so the next
        // launch restores the session of somebody who asked to leave. It is
        // reported as an error rather than skipped, and the memory is dropped
        // regardless: this process must not go on holding what it just tried
        // to destroy.
        var refused: [String] = []
        for kind in [
            SecureTokenKind.refreshToken,
            .accountUserID,
            .accountDisplayName,
            .accountAvatarURL,
            .accountDeviceID,
        ] where await persist(nil, as: kind, during: "a sign-out") == false {
            refused.append(kind.rawValue)
        }
        if !refused.isEmpty {
            logger.log(
                .error,
                .sync,
                "Signing out left session material on the device",
                ["items": .safe(refused.joined(separator: ","))]
            )
        }
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
            guard Self.endsTheSession(error) else {
                // This request failed; the session did not. Deleting the
                // refresh token here is what signed people out for going into
                // a tunnel — the token was never refused, so it stays, the
                // state stays, and the next attempt picks up where this one
                // stopped.
                logger.log(
                    .info, .sync, "A session refresh did not reach the backend and will be retried"
                )
                throw APIError.from(error)
            }
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

    /// Whether a failed refresh means the session is over.
    ///
    /// Only the backend refusing the token does: it answers 401 to a token that
    /// is spent, reused or revoked, and 403 if the account may no longer use
    /// it. A dead network, a timeout, a 500 or a body that would not decode say
    /// nothing whatsoever about the token — and treating them as a refusal is
    /// how a person ends up signed out for riding a lift.
    private static func endsTheSession(_ error: Error) -> Bool {
        switch APIError.from(error) {
        case .unauthorized, .forbidden: true
        default: false
        }
    }

    // MARK: - AccountScopeResolving

    public func currentScope() async -> AccountScope {
        // Whoever asks first — the launch sync, a store's first read — waits
        // the milliseconds the keychain takes, and no early caller can ever
        // be told "guest" about a device that is signed in.
        await ensureIdentityRestored()
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
        // A rotation that cannot be written down is the worst of the three
        // outcomes and used to be the quietest: the server has already spent
        // the old token, this launch carries on happily on the access token in
        // memory, and the next one reads a refresh token that is no longer
        // accepted. The signing out happens tomorrow; the fault is here.
        await persist(session.refreshToken, as: .refreshToken, during: "a rotation")
    }

    private func adopt(_ session: AuthSessionRecord) async {
        accessToken = session.accessToken
        state = .authenticated(userID: session.userID)
        await persist(session.refreshToken, as: .refreshToken, during: "a sign-in")
        await persist(
            session.userID.uuidString,
            as: .accountUserID,
            during: "a sign-in"
        )
        await persist(
            session.displayName,
            as: .accountDisplayName,
            during: "a sign-in"
        )
    }

    /// Writes one part of the session down, and says so when it cannot.
    ///
    /// `try?` was how every one of these was written, and a keychain that
    /// refuses is not a detail to skip: it is the difference between what this
    /// process believes about itself and what survives a relaunch. Swallowed,
    /// it turns a reproducible fault into behaviour nobody can explain — a
    /// person signed out on every launch with nothing in the log to say why
    /// (#392, #393).
    ///
    /// The value never enters the message. The status does, because it is the
    /// difference between a locked keychain, a missing entitlement (-34018)
    /// and a device out of space, and that is what anyone reading the line
    /// needs to know.
    @discardableResult
    private func persist(
        _ value: String?,
        as kind: SecureTokenKind,
        during moment: String
    ) async -> Bool {
        do {
            try await tokens.setValue(value, for: kind)
            return true
        } catch {
            let status: String
            if case SecureTokenStoreError.unavailable(let code) = error {
                status = String(code)
            } else {
                status = "unknown"
            }
            logger.log(
                .error,
                .sync,
                "The session could not be written to the keychain",
                [
                    "moment": .safe(moment),
                    "item": .safe(kind.rawValue),
                    "status": .safe(status),
                    // Said plainly, because this is the sentence that explains
                    // tomorrow's support request.
                    "consequence": .safe("this session will not survive a relaunch"),
                ]
            )
            return false
        }
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
