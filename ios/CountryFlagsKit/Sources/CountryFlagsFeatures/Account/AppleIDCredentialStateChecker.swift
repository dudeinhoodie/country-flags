import AuthenticationServices
import Foundation

import CountryFlagsDomain

/// Asks Apple whether a Sign in with Apple credential still stands.
///
/// A person can switch the sign-in off in Settings, under Apple ID, or on the
/// web, and Apple tells no server about it. The app has to ask, by the user
/// identifier Apple gave at sign-in, and act on the answer itself (#444).
///
/// Any failure to ask is `.unknown`: a check that did not happen says nothing
/// about the credential, and signing somebody out for being offline would be
/// the same mistake as ending a session over a tunnel.
public struct AppleIDCredentialStateChecker: AppleCredentialStateChecking {
    public init() {}

    public func credentialState(forUserID userID: String) async -> AppleCredentialState {
        do {
            let state = try await ASAuthorizationAppleIDProvider()
                .credentialState(forUserID: userID)
            return Self.state(from: state)
        } catch {
            return .unknown
        }
    }

    static func state(
        from state: ASAuthorizationAppleIDProvider.CredentialState
    ) -> AppleCredentialState {
        switch state {
        case .authorized: .authorized
        case .revoked: .revoked
        case .notFound: .notFound
        case .transferred: .transferred
        @unknown default: .unknown
        }
    }
}
