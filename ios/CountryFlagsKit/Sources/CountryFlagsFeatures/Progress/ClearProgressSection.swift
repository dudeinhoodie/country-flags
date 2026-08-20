import SwiftUI

import CountryFlagsDomain

/// Erasing every answer this account has ever given, as a section a form can
/// drop in.
///
/// It is one section rather than two copies because it is offered in two
/// places — the settings and the account screen — and a destructive action
/// that asks for a proof in one place and not the other is a bug waiting for
/// the version where somebody edits only one of them. A guest never sees it:
/// there is no server-side history to erase and nobody to prove they are.
struct ClearProgressSection: View {
    /// Owned for the same reason every screen owns its store.
    @State private var store: ClearProgressStore

    init(store: ClearProgressStore) {
        _store = State(wrappedValue: store)
    }

    var body: some View {
        if store.isOffered {
            Section {
                Button(L10n.settingsClearProgress, role: .destructive) {
                    store.request()
                }
                .accessibilityIdentifier(AccessibilityIdentifier.settingsClearProgress)
                // Both presentations hang off the row rather than off the
                // enclosing form: this section travels between screens, and a
                // dialog left behind on one of them is a button that does
                // nothing.
                .confirmationDialog(
                    L10n.settingsClearProgressTitle,
                    isPresented: confirmation,
                    titleVisibility: .visible
                ) {
                    Button(L10n.settingsClearProgressConfirm, role: .destructive) {
                        store.confirm()
                    }
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsClearProgressConfirm)
                    Button(L10n.accountCancel, role: .cancel) { store.cancel() }
                } message: {
                    Text(L10n.settingsClearProgressBody)
                }
                .sheet(isPresented: proof) { proofSheet }

                // What happened last, said plainly: both failures leave the
                // progress standing, and saying so is the point.
                if let status {
                    Text(status)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.settingsClearProgressStatus
                        )
                }
            } header: {
                SectionLabel(L10n.settingsProgressSection)
            }
            .listRowBackground(Rectangle().fill(.ultraThinMaterial))
            .task { await store.load() }
        }
    }

    /// Proving identity, as a sheet with the same two buttons signing in uses.
    /// It cannot be dismissed into a half-finished state: nothing has been
    /// deleted until the sheet's work returns.
    private var proofSheet: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            VStack(spacing: DesignTokens.Spacing.small) {
                Text(L10n.settingsClearProgressTitle)
                    .font(DesignTokens.Typography.sectionTitle)
                Text(L10n.settingsClearProgressReauth)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }

            ProviderSignInButtons(
                prepareNonce: { store.prepareNonce() },
                rawNonce: { store.preparedNonce?.raw ?? "" },
                google: store.google,
                fixtureCredential: store.allowsFixtureProof
                    ? ProviderSignInButtons.fixtureCredential : nil,
                appleIdentifier: AccessibilityIdentifier.clearProgressProveApple,
                googleIdentifier: AccessibilityIdentifier.clearProgressProveGoogle,
                fixtureIdentifier: AccessibilityIdentifier.clearProgressProveFixture,
                onCredential: { credential, _ in
                    Task { await store.prove(with: credential) }
                },
                onCancelled: { store.noteCancelledProof() },
                onFailure: { store.noteProviderFailure($0) }
            )

            Button(L10n.accountCancel) { store.cancel() }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(DesignTokens.Spacing.large)
        .presentationDetents([.medium])
    }

    private var status: String? {
        switch store.phase {
        case .clearing: L10n.settingsClearProgressWorking
        case .cleared: L10n.settingsClearProgressDone
        case .failed(.identity): L10n.settingsClearProgressReauthFailed
        case .failed(.deletion): L10n.settingsClearProgressFailed
        default: nil
        }
    }

    private var confirmation: Binding<Bool> {
        Binding(
            get: { store.phase == .confirming },
            set: { isPresented in
                if !isPresented, store.phase == .confirming { store.cancel() }
            }
        )
    }

    private var proof: Binding<Bool> {
        Binding(
            get: { store.phase == .provingIdentity },
            set: { isPresented in
                if !isPresented, store.phase == .provingIdentity { store.noteCancelledProof() }
            }
        )
    }
}
