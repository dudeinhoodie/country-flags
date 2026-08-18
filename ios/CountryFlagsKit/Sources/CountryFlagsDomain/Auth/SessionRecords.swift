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

/// Short-lived proof that the person at the device just proved who they are.
///
/// Held in memory for the length of one sensitive operation and never stored:
/// the whole point of a fresh proof is that it cannot be replayed later, and a
/// keychain entry would make it exactly that. It is `writeOnly` in the
/// contract for the same reason.
public struct ReauthenticationProof: Hashable, Sendable {
    public let token: String
    public let expiresAt: Date

    public init(token: String, expiresAt: Date) {
        self.token = token
        self.expiresAt = expiresAt
    }

    public func isValid(at instant: Date) -> Bool { instant < expiresAt }
}

/// The calls a session is made of, separated from the transport that carries
/// them so the rules above can be tested without a socket.
public protocol AuthenticationService: Sendable {
    func exchange(_ credential: ProviderCredential) async throws -> AuthSessionRecord
    /// Turns a provider credential the account already owns into a proof for
    /// one sensitive operation. It creates no session and rotates no tokens:
    /// the caller is already signed in and is being asked to say so again.
    func reauthenticate(with credential: ProviderCredential) async throws -> ReauthenticationProof
    /// - Returns: the rotated tokens. A refusal means the refresh token is
    ///   spent or revoked, and the caller must not retry with it.
    func refresh(refreshToken: String) async throws -> RefreshedSessionRecord
    func logout(refreshToken: String) async throws
    func logoutEverywhere() async throws
}

/// What the screen shows for the signed-in person.
///
/// Assembled from two sources that know different halves: the backend knows
/// the account's name, the provider knows the picture — and, on a first Apple
/// sign-in, a name the backend may not have yet. Never used for authorisation.
public struct AccountProfile: Hashable, Sendable {
    public let displayName: String?
    public let avatarURL: URL?

    public init(displayName: String?, avatarURL: URL?) {
        self.displayName = displayName
        self.avatarURL = avatarURL
    }
}

/// Signing in and out, and where the app currently stands.
///
/// Guest study never depends on any of this: the state exists so the interface
/// can say who is signed in, not to gate what a learner may do.
public protocol SessionControlling: Sendable {
    func currentState() async -> AuthenticationState
    /// The signed-in person as the screen shows them, or nil as a guest.
    func currentProfile() async -> AccountProfile?
    /// Records what the provider shared at sign-in. The backend's own name
    /// wins where both know one; the picture only a provider has.
    func adoptProviderProfile(name: String?, avatarURL: URL?) async
    func signIn(with credential: ProviderCredential) async -> SignInOutcome
    /// - Parameter everywhere: also ends the sessions of the account's other
    ///   devices, which is the answer to a lost phone rather than to a normal
    ///   sign-out.
    func signOut(everywhere: Bool) async
}
