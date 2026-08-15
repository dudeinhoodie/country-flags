import Foundation
// The SDK predates strict concurrency: `GIDSignInResult` is not Sendable, and
// the CI toolchain rightly refuses to pass it across an isolation boundary.
// This adapter is the one place the SDK is spoken to, everything is consumed
// on the main actor, and only Sendable values of our own leave it.
@preconcurrency import GoogleSignIn
import SwiftUI

import CountryFlagsDomain

/// How a Google sign-in attempt ended, in the app's own terms.
public enum GoogleSignInOutcome: Sendable {
    case credential(ProviderCredential, profile: AccountProfile?)
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
            // The profile is the screen's half of the sign-in: the name and
            // the picture Google shows for this person. Never sent anywhere.
            let profile = result.user.profile.map { data in
                AccountProfile(
                    displayName: data.name,
                    avatarURL: data.hasImage ? data.imageURL(withDimension: 200) : nil
                )
            }
            return .credential(.google(idToken: idToken), profile: profile)
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
