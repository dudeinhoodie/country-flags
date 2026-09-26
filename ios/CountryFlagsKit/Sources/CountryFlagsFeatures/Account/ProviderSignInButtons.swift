import AuthenticationServices
import SwiftUI

import CountryFlagsDomain

/// The two ways in, as one block.
///
/// They are a pair, so they are drawn as one: the same height, the same
/// label, the same capsule. What differs is whose surface each wears, and
/// both surfaces are the brands' own.
///
/// Apple's button is the system's own. Apple fixes the title of a Sign in
/// with Apple button at 43% of its height — for the system control and for
/// any custom one alike — and App Review looks at every custom one, so
/// redrawing it would buy nothing but risk. Black, because the pair stands on
/// a light tray: Apple keeps its black button for light grounds and its white
/// one for dark, and while the pair stood on the dark scene it was white.
///
/// Google's button is drawn here, to Google's neutral theme as its asset pack
/// draws it: a light grey fill, near-black text, the mark on the fill with
/// nothing under it and no hairline — the one theme Google offers without an
/// outline. Only the height and the label size are ours, matched to the
/// button above; Google permits scaling as long as the mark keeps its
/// proportions. Two solid capsules of one height is what both brands ask for:
/// Google wants its button at least as prominent as the others, Apple wants
/// the same of its own.
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
        .signInWithAppleButtonStyle(.black)
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
                    GoogleLogoMark()
                        .frame(
                            width: DesignTokens.Layout.providerMarkSize,
                            height: DesignTokens.Layout.providerMarkSize
                        )
                    Text(L10n.accountSignInGoogle)
                        // The same size Apple draws its own label at, above:
                        // a fixed point size rather than the type ramp, so
                        // the pair stays a pair whatever the text setting.
                        .font(
                            .system(size: DesignTokens.Layout.providerLabelSize, weight: .medium)
                        )
                        .foregroundStyle(GoogleNeutralTheme.title)
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

/// Google's neutral button theme, in Google's numbers. A brand keeps its
/// colours the way a flag does: the fill and the title are the values Google
/// publishes, not ours to tune. Neutral has no stroke, which is why it is the
/// theme here: a hairline beside a button that has none reads as a mistake.
private enum GoogleNeutralTheme {
    /// #F2F2F2
    static let fill = Color(red: 242 / 255, green: 242 / 255, blue: 242 / 255)
    /// #1F1F1F
    static let title = Color(red: 31 / 255, green: 31 / 255, blue: 31 / 255)
}

/// Google's neutral theme on the app's capsule, pressed the way every other
/// button in the app is pressed.
private struct GoogleSignInStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(GoogleNeutralTheme.fill, in: Capsule(style: .continuous))
            // A frame makes room; it does not make a target.
            .contentShape(Capsule(style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: configuration.isPressed)
    }
}
