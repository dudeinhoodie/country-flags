import Foundation

/// Which identity provider a sign-in went through.
///
/// The raw values are the contract's. A provider's user identifier is an
/// identity, never a credential: it is not secret, it is not proof of anything,
/// and nothing may be authorised by holding one.
public enum AuthProvider: String, Hashable, Sendable, CaseIterable {
    case apple = "APPLE"
    case google = "GOOGLE"
}

/// Where the app stands with the backend.
public enum AuthenticationState: Hashable, Sendable {
    /// No account. The guest flow stays fully available here — signing in is an
    /// offer, never a gate.
    case guest
    case authenticating(AuthProvider)
    case authenticated(userID: UUID)
    /// The refresh token was refused. The account is known but the session is
    /// not usable until the user signs in again, and none of their guest or
    /// unsynced data is touched by getting here.
    case authenticationExpired(userID: UUID?)

    public var isAuthenticated: Bool {
        if case .authenticated = self { return true }
        return false
    }

    /// Whether the app may study without signing in. It always may; the
    /// property exists so the rule is stated once rather than assumed.
    public var allowsGuestStudy: Bool { true }
}

/// How a sign-in attempt ended.
public enum SignInOutcome: Hashable, Sendable {
    case succeeded(userID: UUID)
    /// The user dismissed the sheet. This is a normal outcome and must not be
    /// reported as a failure: nothing went wrong, they simply changed their
    /// mind.
    case cancelled
    case failed(SignInFailure)
}

public enum SignInFailure: Hashable, Sendable {
    /// The provider refused or returned something unusable.
    case provider(code: String)
    /// The backend refused the identity token.
    case rejected(code: String)
    case offline

    public var isRetryable: Bool {
        switch self {
        case .offline, .provider: true
        case .rejected: false
        }
    }
}

/// The one-time value that ties a provider's identity token to this request.
///
/// Apple signs the hash and the backend compares it against the raw value, so a
/// token captured from another session cannot be replayed into this one. The
/// raw value never leaves the device except to the backend, and never reaches a
/// log.
public struct SignInNonce: Hashable, Sendable {
    public let raw: String
    /// The SHA-256 of `raw`, hex encoded, which is what the provider is given.
    public let hashed: String

    public init(raw: String, hashed: String) {
        self.raw = raw
        self.hashed = hashed
    }
}

/// Builds nonces. Separated so a test can state the value instead of drawing
/// one, and so the randomness has a single home.
public protocol NonceGenerating: Sendable {
    func makeNonce() -> SignInNonce
}
