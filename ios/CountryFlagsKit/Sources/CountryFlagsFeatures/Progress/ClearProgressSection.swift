import SwiftUI

import CountryFlagsDomain

/// Erasing every answer this account has ever given, as a section a form can
/// drop in.
///
/// The screen that shows it is the one that loads it. That is not ceremony:
/// whether this section exists at all is what `load()` decides, so a `.task`
/// hanging off the section itself could only run once the section was already
/// on screen — which it never was.
///
/// It is one section rather than two copies because it is offered in two
/// places — the settings and the account screen — and a destructive action
/// that confirms in one place and not the other is a bug waiting for the
/// version where somebody edits only one of them. A guest never sees it:
/// there is no server-side history to erase.
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
                // The dialog hangs off the row rather than off the enclosing
                // form: this section travels between screens, and a dialog
                // left behind on one of them is a button that does nothing.
                .confirmationDialog(
                    L10n.settingsClearProgressTitle,
                    isPresented: confirmation,
                    titleVisibility: .visible
                ) {
                    Button(L10n.settingsClearProgressConfirm, role: .destructive) {
                        Task { await store.confirm() }
                    }
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsClearProgressConfirm)
                    Button(L10n.accountCancel, role: .cancel) { store.cancel() }
                } message: {
                    Text(L10n.settingsClearProgressBody)
                }

                // What happened last, said plainly: a failure leaves the
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
        }
    }

    private var status: String? {
        switch store.phase {
        case .clearing: L10n.settingsClearProgressWorking
        case .cleared: L10n.settingsClearProgressDone
        case .failed: L10n.settingsClearProgressFailed
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
}
