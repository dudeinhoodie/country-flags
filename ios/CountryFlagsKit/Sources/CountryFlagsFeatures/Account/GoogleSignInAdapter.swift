import Foundation
import GoogleSignIn
import SwiftUI

import CountryFlagsDomain

/// How a Google sign-in attempt ended, in the app's own terms.
public enum GoogleSignInOutcome: Sendable {
    case credential(ProviderCredential)
    case cancelled
    case failed(SignInFailure)
}

/// The seam the account surface talks to.
///
/// A protocol rather than the SDK, for the same reason the Apple mapper takes
/// bytes: the tests drive the store with a double, and the SDK stays behind
/// one file.
public protocol GoogleSignInPresenting: Sendable {
    @MainActor func signIn() async -> GoogleSignInOutcome
}

/// The official SDK, wrapped.
///
/// The identity token is minted for the backend's own client — the audience
/// the backend verifies — and the credential passes through: what the app
/// keeps is the backend session, never Google's.
public struct GoogleSignInAdapter: GoogleSignInPresenting {
    private let clientID: String
    private let serverClientID: String?

    public init(clientID: String, serverClientID: String?) {
        self.clientID = clientID
        self.serverClientID = serverClientID
    }

    @MainActor
    public func signIn() async -> GoogleSignInOutcome {
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: clientID,
            serverClientID: serverClientID
        )
        guard let presenter = Self.presenter() else {
            return .failed(.provider(code: "GOOGLE_NO_PRESENTER"))
        }
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard let idToken = result.user.idToken?.tokenString else {
                return .failed(.provider(code: "GOOGLE_TOKEN_MISSING"))
            }
            return .credential(.google(idToken: idToken))
        } catch let error as GIDSignInError where error.code == .canceled {
            // A closed sheet is a change of mind, not a failure.
            return .cancelled
        } catch {
            return .failed(.provider(code: "GOOGLE_SIGN_IN_FAILED"))
        }
    }

    /// The controller the provider's sheet hangs off: the key window's top.
    @MainActor
    private static func presenter() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.keyWindow?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    /// The redirect back into the app after the browser round trip.
    @MainActor
    public static func handle(_ url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }
}
