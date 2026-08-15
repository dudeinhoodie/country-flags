import AuthenticationServices
import SwiftUI

import CountryFlagsDomain

/// The account, as a section of the settings form.
///
/// A guest sees an offer, never a gate: the note under the button says what
/// signing in buys — progress that survives the device — and everything else
/// in the app works without it. Signing out with unsent answers is put to the
/// user with the number, because stranding work silently is the one thing
/// this section must never do.
struct AccountSection: View {
    /// Owned for the same reason every screen owns its store.
    @State private var store: AccountStore

    init(store: AccountStore) {
        _store = State(wrappedValue: store)
    }

    var body: some View {
        Section {
            content
        } header: {
            SectionLabel(L10n.accountSection)
        } footer: {
            footer
        }
        .task { await store.start() }
        .confirmationDialog(
            signOutTitle,
            isPresented: signOutDialogBinding,
            titleVisibility: .visible
        ) {
            Button(L10n.accountSignOut, role: .destructive) {
                Task { await store.confirmSignOut(everywhere: false) }
            }
            Button(L10n.accountSignOutEverywhere, role: .destructive) {
                Task { await store.confirmSignOut(everywhere: true) }
            }
            Button(L10n.accountCancel, role: .cancel) {
                store.cancelSignOut()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .guest:
            signInControls
        case .authenticating:
            HStack(spacing: DesignTokens.Spacing.small) {
                ProgressView()
                Text(L10n.accountSigningIn)
                    .foregroundStyle(.white.opacity(0.7))
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountSigningIn)
        case .authenticated:
            // The person, not a status line: their picture and their name,
            // with what the account buys them as the caption underneath.
            HStack(spacing: DesignTokens.Spacing.medium) {
                AccountAvatarView(profile: store.profile)

                VStack(alignment: .leading, spacing: 0) {
                    Text(store.profile?.displayName ?? L10n.accountFallbackName)
                        .font(DesignTokens.Typography.body.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(L10n.accountSignedIn)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AccessibilityIdentifier.accountSignedIn)

            Button(L10n.accountSignOut, role: .destructive) {
                Task { await store.requestSignOut() }
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountSignOut)
        case .authenticationExpired:
            Label(L10n.accountExpired, systemImage: "person.crop.circle.badge.exclamationmark")
                .foregroundStyle(.white.opacity(0.8))
                .accessibilityIdentifier(AccessibilityIdentifier.accountExpired)

            signInControls
        }
    }

    @ViewBuilder
    private var signInControls: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
            // Apple signs the hash into the identity token; the backend
            // compares it against the raw value sent with the exchange.
            request.nonce = store.prepareNonce().hashed
        } onCompletion: { result in
            let rawNonce = store.preparedNonce?.raw ?? ""
            switch AppleCredentialMapper.outcome(of: result, rawNonce: rawNonce) {
            case .credential(let credential, let profile):
                Task { await store.signIn(with: credential, providerProfile: profile) }
            case .cancelled:
                store.noteCancelledSignIn()
            case .failed(let failure):
                store.noteProviderFailure(failure)
            }
        }
        .signInWithAppleButtonStyle(.white)
        .frame(height: DesignTokens.Layout.providerButtonHeight)
        .accessibilityIdentifier(AccessibilityIdentifier.accountSignInApple)

        if store.google != nil {
            // The same slab as Apple's, deliberately: white, the same height,
            // the same radius, the provider's own mark on the left. Two ways
            // in must not look like a first choice and an afterthought.
            Button {
                Task { await store.signInWithGoogle() }
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
            .accessibilityIdentifier(AccessibilityIdentifier.accountSignInGoogle)
        }

        // Debug environments only, and only when the launch asked: the whole
        // flow — exchange, migration, state — without a provider sheet a test
        // cannot drive.
        if store.allowsFakeSignIn {
            Button(String("Sign in (fixture)")) {
                Task {
                    await store.signIn(
                        with: .apple(
                            identityToken: "fixture-identity-token",
                            authorizationCode: "fixture-authorization-code",
                            rawNonce: "fixture-nonce"
                        )
                    )
                }
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountFakeSignIn)
        }
    }

    @ViewBuilder
    private var footer: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
            if case .guest = store.state {
                Text(L10n.accountGuestNote)
            }
            if let failure = store.lastFailure {
                Text(failure == .offline ? L10n.accountSignInOffline : L10n.accountSignInFailed)
                    .accessibilityIdentifier(AccessibilityIdentifier.accountFailure)
            }
            migrationLine
        }
        .foregroundStyle(.white.opacity(0.5))
    }

    @ViewBuilder
    private var migrationLine: some View {
        switch store.migration {
        case .imported(let result):
            Text(L10n.accountMigrationImported(result.acceptedEventCount))
                .accessibilityIdentifier(AccessibilityIdentifier.accountMigrationImported)
        case .pending:
            Text(L10n.accountMigrationPending)
        case .failed:
            Text(L10n.accountMigrationFailed)
        case .nothingToImport, .refused, .unavailable, nil:
            // Nothing to say: no work moved because there was none to move,
            // or the attempt will simply repeat. A settings footer is not a
            // place to narrate mechanics that resolved themselves.
            EmptyView()
        }
    }

    private var signOutTitle: String {
        guard let assessment = store.signOutAssessment, assessment.requiresWarning else {
            return L10n.accountSignOutClean
        }
        return L10n.accountSignOutWarning(assessment.unsyncedCount)
    }

    private var signOutDialogBinding: Binding<Bool> {
        Binding(
            get: { store.signOutAssessment != nil },
            set: { isPresented in
                if !isPresented { store.cancelSignOut() }
            }
        )
    }
}

/// The account's picture, or the person's initial while there is none.
///
/// The picture is fetched from the provider's URL each time: an avatar
/// changed on the account changes here without any store of ours holding a
/// stale copy. The monogram fallback keeps the circle a person rather than
/// a generic glyph.
private struct AccountAvatarView: View {
    let profile: AccountProfile?

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ZStack {
            Circle().fill(.ultraThinMaterial)

            if let initial {
                Text(initial)
                    .font(DesignTokens.Typography.body.weight(.semibold))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: "person.fill")
                    .foregroundStyle(.white.opacity(0.7))
            }

            if let url = profile?.avatarURL {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
            }
        }
        .frame(
            width: DesignTokens.Layout.minimumTouchTarget,
            height: DesignTokens.Layout.minimumTouchTarget
        )
        .clipShape(Circle())
        .overlay {
            Circle().strokeBorder(
                .white.opacity(DesignTokens.Card.borderOpacity),
                lineWidth: 1 / displayScale
            )
        }
        .accessibilityHidden(true)
    }

    private var initial: String? {
        guard let name = profile?.displayName?.trimmingCharacters(in: .whitespaces),
            let first = name.first
        else {
            return nil
        }
        return String(first).uppercased()
    }
}

/// Google's four-colour "G", drawn rather than shipped.
///
/// Four arcs and the bar, in the brand's own colours — a trademark keeps its
/// palette the way a flag does, so the hex values here are the logo's, not
/// ours. Drawing it keeps the mark crisp at any size with no asset to age.
private struct GoogleLogoMark: View {
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let line = side * 0.21
            let inset = line / 2

            ZStack {
                segment(0.00, 0.17, Color(red: 0.259, green: 0.522, blue: 0.957), line: line)
                segment(0.17, 0.38, Color(red: 0.204, green: 0.659, blue: 0.325), line: line)
                segment(0.38, 0.62, Color(red: 0.984, green: 0.737, blue: 0.020), line: line)
                segment(0.62, 0.87, Color(red: 0.918, green: 0.263, blue: 0.208), line: line)

                // The bar that turns the ring into a G.
                Rectangle()
                    .fill(Color(red: 0.259, green: 0.522, blue: 0.957))
                    .frame(width: side / 2 - inset + line / 2, height: line)
                    .offset(x: side / 4 - inset / 2 + line / 4)
            }
            .padding(inset)
            .frame(width: side, height: side)
        }
    }

    /// One arc of the ring. Trim runs from 3 o'clock, clockwise on screen.
    private func segment(
        _ from: CGFloat, _ to: CGFloat, _ color: Color, line: CGFloat
    ) -> some View {
        Circle()
            .trim(from: from, to: to)
            .stroke(color, lineWidth: line)
    }
}
