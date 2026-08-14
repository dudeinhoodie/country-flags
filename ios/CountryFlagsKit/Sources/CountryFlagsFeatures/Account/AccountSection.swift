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
            Label(L10n.accountSignedIn, systemImage: "person.crop.circle.badge.checkmark")
                .foregroundStyle(.white)
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
            case .credential(let credential):
                Task { await store.signIn(with: credential) }
            case .cancelled:
                store.noteCancelledSignIn()
            case .failed(let failure):
                store.noteProviderFailure(failure)
            }
        }
        .signInWithAppleButtonStyle(.white)
        .frame(height: DesignTokens.Layout.minimumTouchTarget)
        .accessibilityIdentifier(AccessibilityIdentifier.accountSignInApple)

        if store.google != nil {
            Button {
                Task { await store.signInWithGoogle() }
            } label: {
                Label(L10n.accountSignInGoogle, systemImage: "g.circle.fill")
            }
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
