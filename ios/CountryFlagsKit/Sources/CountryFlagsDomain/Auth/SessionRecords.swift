import Foundation

/// What a provider gave the app to prove who signed in.
///
/// These are credentials and are held only long enough to be exchanged for a
/// backend session: nothing here is stored, logged or reported, and the
/// provider's own user identifier is deliberately absent — it is an identity,
/// not proof of anything.
public enum ProviderCredential: Sendable {
    /// Apple returns the token and the code together, and the raw nonce is what
    /// ties them to the request this device started.
    case apple(identityToken: String, authorizationCode: String, rawNonce: String)
    case google(idToken: String)

    public var provider: AuthProvider {
        switch self {
        case .apple: .apple
        case .google: .google
        }
    }
}

/// The session a successful exchange produced.
public struct AuthSessionRecord: Hashable, Sendable {
    public let userID: UUID
    /// What the account calls itself, when the backend knows.
    public let displayName: String?
    public let accessToken: String
    public let accessTokenExpiresAt: Date
    public let refreshToken: String

    public init(
        userID: UUID,
        displayName: String? = nil,
        accessToken: String,
        accessTokenExpiresAt: Date,
        refreshToken: String
    ) {
        self.userID = userID
        self.displayName = displayName
        self.accessToken = accessToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshToken = refreshToken
    }
}

/// How this installation describes itself when a session is created.
///
/// The backend attributes a session and the reviews that follow it to a device,
/// so the identifier is generated once and reused rather than drawn per
/// sign-in: two devices for one person are two devices, and one device signing
/// in twice is not.
public struct DeviceRegistrationRecord: Hashable, Sendable {
    public let clientGeneratedID: String
    public let appVersion: String
    public let locale: String
    public let timezone: String

    public init(clientGeneratedID: String, appVersion: String, locale: String, timezone: String) {
        self.clientGeneratedID = clientGeneratedID
        self.appVersion = appVersion
        self.locale = locale
        self.timezone = timezone
    }
}

public protocol DeviceRegistrationProviding: Sendable {
    func registration() async -> DeviceRegistrationRecord
}

/// A rotated session. The backend answers a refresh with tokens alone: who the
/// account belongs to has not changed, and the caller already knows it.
public struct RefreshedSessionRecord: Hashable, Sendable {
    public let accessToken: String
    public let accessTokenExpiresAt: Date
    public let refreshToken: String

    public init(accessToken: String, accessTokenExpiresAt: Date, refreshToken: String) {
        self.accessToken = accessToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshToken = refreshToken
    }
}

/// The calls a session is made of, separated from the transport that carries
/// them so the rules above can be tested without a socket.
public protocol AuthenticationService: Sendable {
    func exchange(_ credential: ProviderCredential) async throws -> AuthSessionRecord
    /// - Returns: the rotated tokens. A refusal means the refresh token is
    ///   spent or revoked, and the caller must not retry with it.
    func refresh(refreshToken: String) async throws -> RefreshedSessionRecord
    func logout(refreshToken: String) async throws
    func logoutEverywhere() async throws
}

/// Signing in and out, and where the app currently stands.
///
/// Guest study never depends on any of this: the state exists so the interface
/// can say who is signed in, not to gate what a learner may do.
public protocol SessionControlling: Sendable {
    func currentState() async -> AuthenticationState
    /// What the signed-in account calls itself, or nil as a guest — for the
    /// screen alone, never for authorisation.
    func currentDisplayName() async -> String?
    func signIn(with credential: ProviderCredential) async -> SignInOutcome
    /// - Parameter everywhere: also ends the sessions of the account's other
    ///   devices, which is the answer to a lost phone rather than to a normal
    ///   sign-out.
    func signOut(everywhere: Bool) async
}
