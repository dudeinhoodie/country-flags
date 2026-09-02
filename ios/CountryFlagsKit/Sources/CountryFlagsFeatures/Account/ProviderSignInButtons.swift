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
///
/// They wear the app's own vocabulary — capsules at the height of every other
/// action, white for the one recommended and glass for the one merely
/// offered — within what the providers allow, which is the whole design
/// problem here. Apple's button may not be redrawn: it must be the system's
/// own, in one of three approved styles. What it does allow is a corner
/// radius of up to half its height, so the capsule this app is built from is
/// available, and the white style is the same white the app spends on its
/// loudest action. Google's mark and wording are theirs; the surface under
/// them is ours.
///
/// Apple sits first and in white, Google second and in glass, which is also
/// how guideline 4.8 wants it: the alternative to a third-party sign-in has
/// to be at least as prominent, and here it is more so.
struct ProviderSignInButtons: View {
    /// The credential a debug build offers instead of a provider sheet, which
    /// is the only way a UI test can drive a flow that starts with one. It is
    /// offered solely where the composition allows it — debug environments,
    /// and only when the launch asked — so a release build never sees it.
    static let fixtureCredential = ProviderCredential.apple(
        identityToken: "fixture-identity-token",
        authorizationCode: "fixture-authorization-code",
        rawNonce: "fixture-nonce"
    )

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
        // The one shape the app draws. Apple permits a radius up to half the
        // height, and half the height is a capsule.
        .clipShape(Capsule(style: .continuous))
        .accessibilityIdentifier(appleIdentifier)

        if let google {
            // Glass rather than a second white slab: two white capsules would
            // read as two recommendations, and one of them has to be the
            // quieter offer. The mark and the wording stay Google's.
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
                    // On its own white keeper, as Google's guidelines ask
                    // when the mark sits on anything but white.
                    GoogleLogoMark()
                        .frame(width: 22, height: 22)
                        .padding(6)
                        .background(.white, in: Circle())
                    Text(L10n.accountSignInGoogle)
                        // Sized off the button's height rather than off the
                        // type ramp, because the button beside it is: Apple
                        // draws its own label and scales it to roughly 43%
                        // of the height, with no API to set it. At 56 points
                        // that is around 24 — half again our body text — so
                        // a `.body` label next to it read as a different
                        // button from a different app. Deriving ours from the
                        // same rule keeps the two together if the height
                        // token ever moves.
                        .font(
                            .system(
                                size: DesignTokens.Layout.providerButtonHeight * 0.43,
                                weight: .medium
                            )
                        )
                        .foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity)
                .frame(height: DesignTokens.Layout.providerButtonHeight)
                .glassEffect(
                    .regular.tint(.white.opacity(0.16)).interactive(),
                    in: Capsule(style: .continuous)
                )
                .contentShape(Capsule(style: .continuous))
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
