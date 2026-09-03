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
/// They are a pair, so they are drawn as one: the same height, the same
/// label, the same capsule. What differs is whose surface each wears.
///
/// Apple's button is the system's own, and at this height that is the
/// better choice rather than merely the safe one. Apple fixes the title of a
/// Sign in with Apple button at 43% of its height — for the system control
/// and for any custom one alike — and App Review looks at every custom one,
/// so redrawing it would buy nothing but risk. What the proportion leaves
/// open is the height, and the height was chosen from the label: the body
/// size, 17 points, which is 40 tall. Apple permits a corner radius up to
/// half the height, so the capsule this app is built from is available.
///
/// Google's button is drawn here, to Google's own light theme as its asset
/// pack draws it: white, a grey hairline inside the edge, near-black text,
/// the mark on the white with nothing under it, and the pill Google offers
/// beside the rectangle. Only the height — Google's is 44 — and the label
/// size are ours, matched to the button above; Google permits scaling as
/// long as the mark keeps its proportions. Two white capsules of one height
/// is what both brands ask for: Google wants its button at least as
/// prominent as the others, Apple wants the same of its own, and the
/// hairline is what tells them apart — as it does everywhere this pair
/// appears. A dark theme was tried and looked like a hole in the scene.
///
/// Both are titled "Continue with …" rather than "Sign in with …": one flow
/// serves the person with an account and the person without, which is the
/// case Apple names for that title, and a pair should conjugate the same way.
///
/// Apple sits first, which is also how guideline 4.8 wants it: the
/// alternative to a third-party sign-in has to be at least as prominent.
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
        SignInWithAppleButton(.continue) { request in
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
                // Twelve points between the mark and the title is Google's
                // own spacing for iOS.
                HStack(spacing: DesignTokens.Spacing.small + 4) {
                    // Twenty points in Google's 44-point button, scaled with
                    // the button as the guidelines ask.
                    GoogleLogoMark()
                        .frame(width: 18, height: 18)
                    Text(L10n.accountSignInGoogle)
                        // The same size Apple draws its own label at, above:
                        // a fixed point size rather than the type ramp, so
                        // the pair stays a pair whatever the text setting.
                        .font(
                            .system(size: DesignTokens.Layout.providerLabelSize, weight: .medium)
                        )
                        .foregroundStyle(GoogleLightTheme.title)
                }
                .frame(maxWidth: .infinity)
                .frame(height: DesignTokens.Layout.providerButtonHeight)
            }
            .buttonStyle(GoogleSignInStyle())
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

/// Google's light button theme, in Google's numbers. A brand keeps its
/// colours the way a flag does: the fill, the hairline inside it and the
/// title are the values Google publishes, not ours to tune.
private enum GoogleLightTheme {
    /// #FFFFFF
    static let fill = Color.white
    /// #747775, one point, inside the edge.
    static let stroke = Color(red: 116 / 255, green: 119 / 255, blue: 117 / 255)
    /// #1F1F1F
    static let title = Color(red: 31 / 255, green: 31 / 255, blue: 31 / 255)
}

/// Google's light theme on the app's capsule, pressed the way every other
/// button in the app is pressed.
private struct GoogleSignInStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(GoogleLightTheme.fill, in: Capsule(style: .continuous))
            .overlay {
                Capsule(style: .continuous)
                    .strokeBorder(GoogleLightTheme.stroke, lineWidth: 1)
            }
            // A frame makes room; it does not make a target.
            .contentShape(Capsule(style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: configuration.isPressed)
    }
}
