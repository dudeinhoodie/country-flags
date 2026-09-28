import AuthenticationServices
import Foundation

import CountryFlagsDomain

/// Turns what Apple's controller hands back into the app's own terms.
///
/// The mapping is split so its core takes plain values: a test cannot
/// construct an `ASAuthorization`, but it can hand this bytes and assert what
/// comes out. Cancellation maps to its own case because it is a normal
/// outcome — the person changed their mind — and reporting it as an error
/// would put an apology on the screen where nothing went wrong.
enum AppleCredentialMapper {
    enum Outcome {
        case credential(ProviderCredential, profile: AccountProfile?)
        case cancelled
        case failed(SignInFailure)
    }

    static func outcome(
        of result: Result<ASAuthorization, any Error>,
        rawNonce: String
    ) -> Outcome {
        switch result {
        case .success(let authorization):
            guard let appleID = authorization.credential as? ASAuthorizationAppleIDCredential,
                let credential = credential(
                    identityToken: appleID.identityToken,
                    authorizationCode: appleID.authorizationCode,
                    rawNonce: rawNonce,
                    appleUserID: appleID.user
                )
            else {
                return .failed(.provider(code: "APPLE_CREDENTIAL_UNREADABLE"))
            }
            // Apple shares the name exactly once, on the first authorization;
            // it is captured here or never. There is no picture to capture.
            let profile = appleID.fullName.flatMap { components -> AccountProfile? in
                let name = PersonNameComponentsFormatter.localizedString(
                    from: components, style: .default
                )
                return name.isEmpty ? nil : AccountProfile(displayName: name, avatarURL: nil)
            }
            return .credential(credential, profile: profile)
        case .failure(let error):
            if let authorizationError = error as? ASAuthorizationError,
                authorizationError.code == .canceled {
                return .cancelled
            }
            return .failed(.provider(code: "APPLE_AUTHORIZATION_FAILED"))
        }
    }

    /// The token and the code arrive as bytes and go to the backend as the
    /// UTF-8 strings they are. Either missing or unreadable means the
    /// credential cannot be exchanged, not that something may be guessed.
    ///
    /// Apple's user identifier rides along for the session to keep: it is
    /// what the app asks Apple about later, on launch and on every return,
    /// to find out whether the person has since switched the sign-in off.
    static func credential(
        identityToken: Data?,
        authorizationCode: Data?,
        rawNonce: String,
        appleUserID: String? = nil
    ) -> ProviderCredential? {
        guard
            let identityToken,
            let authorizationCode,
            let token = String(data: identityToken, encoding: .utf8),
            let code = String(data: authorizationCode, encoding: .utf8),
            !token.isEmpty,
            !code.isEmpty
        else {
            return nil
        }
        return .apple(
            identityToken: token,
            authorizationCode: code,
            rawNonce: rawNonce,
            appleUserID: appleUserID.flatMap { $0.isEmpty ? nil : $0 }
        )
    }
}
