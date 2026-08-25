import SwiftUI

import CountryFlagsDomain

/// The account: who is signed in, the legal documents, and the end of it.
///
/// A form, like the settings screen and for the same reason. What it adds is
/// weight: two of these rows are destructive and each one says what it will
/// do before it does it. Nothing here is reachable as a guest — there is no
/// account to manage — and nothing here gates studying.
///
/// The linked sign-in methods, the device roster and the data export used to
/// live here; the product let them go, and the endpoints stayed server-side
/// for the day they are wanted again.
public struct AccountScreen: View {
    @State private var store: AccountLifecycleStore
    /// The legal documents, when the build has been given their addresses. An
    /// unset link is not shown: an offer that opens nothing is worse than no
    /// offer, the same rule the Google button follows.
    private let privacyPolicyURL: URL?
    private let termsURL: URL?
    /// Who is signed in, and the way in or out. It used to live in the
    /// settings; it belongs with the account it is about.
    @State private var account: AccountStore?
    private let makeAccount: (() -> AccountStore)?
    /// Erasing the answers without erasing the account — the one destructive
    /// thing that is about progress rather than identity, offered here as well
    /// as in the settings.
    @State private var clearProgress: ClearProgressStore?
    private let makeClearProgress: (() -> ClearProgressStore)?

    public init(
        store: AccountLifecycleStore,
        makeAccount: (() -> AccountStore)? = nil,
        makeClearProgress: (() -> ClearProgressStore)? = nil,
        privacyPolicyURL: URL? = nil,
        termsURL: URL? = nil
    ) {
        _store = State(wrappedValue: store)
        self.makeAccount = makeAccount
        self.makeClearProgress = makeClearProgress
        self.privacyPolicyURL = privacyPolicyURL
        self.termsURL = termsURL
    }

    public var body: some View {
        List {
            if let deletion = store.pendingDeletion {
                deletionNotice(deletion)
            }
            if let account {
                AccountSection(store: account)
                    .listRowBackground(rowBackground)
            }
            if let clearProgress {
                ClearProgressSection(store: clearProgress)
            }
            legalSection
            deletionSection
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(L10n.accountTitle)
        .sceneChrome()
        .onAppear {
            if account == nil { account = makeAccount?() }
            if clearProgress == nil { clearProgress = makeClearProgress?() }
            // Whether the row exists is what this answers, so it cannot wait
            // for the row to appear.
            Task { await clearProgress?.load() }
        }
        // Keyed on who is signed in, not on appearance alone: signing in now
        // happens on this screen, and the deletion notice belongs to the
        // account that was not there a moment ago.
        .task(id: account?.state) { await store.load() }
        .confirmationDialog(
            L10n.accountDeleteTitle,
            isPresented: deletionConfirmation,
            titleVisibility: .visible
        ) {
            Button(L10n.accountDeleteConfirm, role: .destructive) {
                Task { await store.confirmDeletion() }
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountDeleteConfirm)
            Button(L10n.accountCancel, role: .cancel) { store.cancelDeletion() }
        } message: {
            Text(L10n.accountDeleteBody)
        }
    }

    // MARK: - Deletion notice

    private func deletionNotice(_ deletion: AccountDeletionRecord) -> some View {
        Section {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                Text(L10n.accountDeletionPendingTitle)
                    .font(DesignTokens.Typography.body.weight(.semibold))
                    .foregroundStyle(.white)
                Text(L10n.accountDeletionPendingBody(Self.day(deletion.expectedCompletionAt)))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AccessibilityIdentifier.accountDeletionPending)
        }
        .listRowBackground(rowBackground)
    }

    // MARK: - Legal

    @ViewBuilder
    private var legalSection: some View {
        if privacyPolicyURL != nil || termsURL != nil {
            Section {
                if let privacyPolicyURL {
                    Link(L10n.accountPrivacyPolicy, destination: privacyPolicyURL)
                        .accessibilityIdentifier(AccessibilityIdentifier.accountPrivacyPolicy)
                }
                if let termsURL {
                    Link(L10n.accountTerms, destination: termsURL)
                        .accessibilityIdentifier(AccessibilityIdentifier.accountTerms)
                }
            } header: {
                SectionLabel(L10n.accountLegalSection)
            }
            .listRowBackground(rowBackground)
        }
    }

    // MARK: - Deletion

    @ViewBuilder
    private var deletionSection: some View {
        if store.pendingDeletion == nil {
            Section {
                Button(L10n.accountDelete, role: .destructive) { store.requestDeletion() }
                    .accessibilityIdentifier(AccessibilityIdentifier.accountDelete)

                if let status = deletionStatus {
                    Text(status)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .accessibilityIdentifier(AccessibilityIdentifier.accountDeleteStatus)
                }
            } header: {
                SectionLabel(L10n.accountDangerSection)
            }
            .listRowBackground(rowBackground)
        }
    }

    // MARK: - Bindings and copy

    private var deletionStatus: String? {
        switch store.deletionPhase {
        case .working: L10n.accountDeleteWorking
        case .failed: L10n.accountDeleteFailed
        case .idle: nil
        }
    }

    private var deletionConfirmation: Binding<Bool> {
        Binding(
            get: { store.isConfirmingDeletion },
            set: { isPresented in
                if !isPresented, store.isConfirmingDeletion { store.cancelDeletion() }
            }
        )
    }

    /// Dates are shown as days: the hour a deletion completes is precision
    /// nobody acts on, and a timestamp reads as surveillance.
    private static func day(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    /// The same glass the settings rows use, for the same reason.
    private var rowBackground: some View {
        Rectangle().fill(.ultraThinMaterial)
    }
}
