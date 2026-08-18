import AuthenticationServices
import SwiftUI

import CountryFlagsDomain

/// The two ways in, as one block.
///
/// Signing in and proving who you are again are different operations with the
/// same first step: a provider credential. The buttons are shared so the two
/// places cannot drift into looking like a first choice and an afterthought —
/// what differs is what the caller does with the credential, which is the
/// closure it passes.
struct ProviderSignInButtons: View {
    /// Drawn for the request and held by the caller until the provider
    /// answers: the raw value has to accompany the exchange.
    let prepareNonce: () -> SignInNonce
    let rawNonce: () -> String
    let google: (any GoogleSignInPresenting)?
    /// Debug builds only. A fixture credential must never be one tap away in
    /// production, which is why the caller decides rather than this view.
    let fixtureCredential: ProviderCredential?
    let appleIdentifier: String
    let googleIdentifier: String
    let fixtureIdentifier: String
    let onCredential: (ProviderCredential, AccountProfile?) -> Void
    let onCancelled: () -> Void
    let onFailure: (SignInFailure) -> Void

    var body: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
            // Apple signs the hash into the identity token; the backend
            // compares it against the raw value sent with the exchange.
            request.nonce = prepareNonce().hashed
        } onCompletion: { result in
            switch AppleCredentialMapper.outcome(of: result, rawNonce: rawNonce()) {
            case .credential(let credential, let profile):
                onCredential(credential, profile)
            case .cancelled:
                onCancelled()
            case .failed(let failure):
                onFailure(failure)
            }
        }
        .signInWithAppleButtonStyle(.white)
        .frame(height: DesignTokens.Layout.providerButtonHeight)
        .accessibilityIdentifier(appleIdentifier)

        if let google {
            // The same slab as Apple's, deliberately: white, the same height,
            // the same radius, the provider's own mark on the left.
            Button {
                Task {
                    switch await google.signIn() {
                    case .credential(let credential, let profile):
                        onCredential(credential, profile)
                    case .cancelled:
                        onCancelled()
                    case .failed(let failure):
                        onFailure(failure)
                    }
                }
            } label: {
                HStack(spacing: DesignTokens.Spacing.small) {
                    GoogleLogoMark()
                        .frame(width: 18, height: 18)
                    Text(L10n.accountSignInGoogle)
                        .font(DesignTokens.Typography.body.weight(.medium))
                }
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .frame(height: DesignTokens.Layout.providerButtonHeight)
                .background(
                    .white,
                    in: RoundedRectangle(
                        cornerRadius: DesignTokens.Radius.small, style: .continuous
                    )
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(googleIdentifier)
        }

        // The whole flow — exchange, migration, state — without a provider
        // sheet a test cannot drive.
        if let fixtureCredential {
            Button(String("Sign in (fixture)")) {
                onCredential(fixtureCredential, nil)
            }
            .accessibilityIdentifier(fixtureIdentifier)
        }
    }
}
