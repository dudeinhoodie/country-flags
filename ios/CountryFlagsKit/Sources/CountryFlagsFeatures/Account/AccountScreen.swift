import SwiftUI

import CountryFlagsDomain

/// The account: the ways into it, the devices on it, a copy of its data, and
/// the end of it.
///
/// A form, like the settings screen and for the same reason. What it adds is
/// weight: three of these rows are destructive and each one says what it will
/// do before it does it. Nothing here is reachable as a guest — there is no
/// account to manage — and nothing here gates studying.
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
            identitiesSection
            devicesSection
            exportSection
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
        }
        // Keyed on who is signed in, not on appearance alone: signing in now
        // happens on this screen, and the logins and devices belong to the
        // account that was not there a moment ago. Without the key the screen
        // kept the guest's empty answer until it was left and reopened.
        .task(id: account?.state) { await store.load() }
        .onDisappear { store.discardExportArchive() }
        .confirmationDialog(
            L10n.accountDeleteTitle,
            isPresented: deletionConfirmation,
            titleVisibility: .visible
        ) {
            Button(L10n.accountDeleteConfirm, role: .destructive) {
                store.confirmDeletion()
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountDeleteConfirm)
            Button(L10n.accountCancel, role: .cancel) { store.cancelDeletion() }
        } message: {
            Text(L10n.accountDeleteBody)
        }
        .alert(
            identityFailureTitle,
            isPresented: identityFailurePresented,
            presenting: store.identityFailure
        ) { failure in
            // One refusal has a way out that is not "try again": the login
            // belongs to another account, and the safe move is to go and be
            // that account. Merging the two is not offered.
            if failure == .belongsToAnotherAccount {
                Button(L10n.accountSwitchAccounts) {
                    Task { await store.signOutToSwitchAccounts() }
                }
                .accessibilityIdentifier(AccessibilityIdentifier.accountSwitchAccounts)
            }
            Button(L10n.accountCancel, role: .cancel) { store.dismissIdentityFailure() }
        } message: { failure in
            Text(Self.identityFailureMessage(failure))
        }
        .sheet(isPresented: proofPresented) { proofSheet }
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

    // MARK: - Identities

    @ViewBuilder
    private var identitiesSection: some View {
        Section {
            ForEach(store.identities) { identity in
                HStack {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(Self.name(of: identity.provider))
                            .foregroundStyle(.white)
                        Text(L10n.accountIdentityLastUsed(Self.day(identity.lastLoginAt)))
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    Spacer(minLength: DesignTokens.Spacing.small)
                    // Offered for every identity: whether the last one may go
                    // is the server's policy, and it answers with a refusal
                    // this screen shows rather than a rule it duplicates.
                    Button(L10n.accountUnlink, role: .destructive) {
                        Task { await store.unlink(identity.provider) }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.red.opacity(0.9))
                    .disabled(store.isChangingIdentities)
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.accountUnlink(identity.provider.rawValue)
                    )
                }
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                .accessibilityIdentifier(
                    AccessibilityIdentifier.accountIdentityRow(identity.provider.rawValue)
                )
            }

        } header: {
            SectionLabel(L10n.accountIdentitiesSection)
        } footer: {
            Text(L10n.accountIdentitiesFooter)
                .foregroundStyle(.white.opacity(0.5))
        }
        .listRowBackground(rowBackground)
    }

    // MARK: - Devices

    @ViewBuilder
    private var devicesSection: some View {
        if !store.devices.isEmpty {
            Section {
                ForEach(store.devices) { device in
                    HStack {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(device.isCurrent ? L10n.accountThisDevice : device.platform)
                                .foregroundStyle(.white)
                            Text(
                                L10n.accountDeviceDetails(
                                    device.appVersion, Self.day(device.lastSeenAt)
                                )
                            )
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.6))
                        }
                        Spacer(minLength: DesignTokens.Spacing.small)
                        Button(L10n.accountRevokeDevice, role: .destructive) {
                            Task { await store.revoke(device: device) }
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.red.opacity(0.9))
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.accountRevokeDevice(device.id)
                        )
                    }
                    .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                }
            } header: {
                SectionLabel(L10n.accountDevicesSection)
            } footer: {
                Text(L10n.accountDevicesFooter)
                    .foregroundStyle(.white.opacity(0.5))
            }
            .listRowBackground(rowBackground)
        }
    }

    // MARK: - Export

    @ViewBuilder
    private var exportSection: some View {
        Section {
            if let archive = store.exportArchive {
                // The archive never leaves through a link this app cannot see:
                // it is a file on the device by the time it is offered, and the
                // share sheet is what decides where it goes.
                ShareLink(item: archive) {
                    Text(L10n.accountExportShare)
                }
                .accessibilityIdentifier(AccessibilityIdentifier.accountExportShare)
            } else if let export = store.export, !export.status.isSettled {
                HStack(spacing: DesignTokens.Spacing.small) {
                    ProgressView()
                    Text(L10n.accountExportPreparing)
                        .foregroundStyle(.white.opacity(0.7))
                }
                .accessibilityIdentifier(AccessibilityIdentifier.accountExportPreparing)
                .task { await store.followExport() }
            } else if store.isPreparingExport {
                // The gap this fills: between tapping and the backend
                // answering there is a proof sheet and a request, and while
                // both were in flight the row still read "request a copy" —
                // so a person who came back from the provider saw a screen
                // that looked like nothing had happened.
                HStack(spacing: DesignTokens.Spacing.small) {
                    ProgressView()
                    Text(L10n.accountExportPreparing)
                        .foregroundStyle(.white.opacity(0.7))
                }
                .accessibilityIdentifier(AccessibilityIdentifier.accountExportPreparing)
            } else {
                Button(L10n.accountExportRequest) { store.requestExport() }
                    .accessibilityIdentifier(AccessibilityIdentifier.accountExportRequest)
            }

            if store.exportFailure || store.didExportProofFail {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    Text(L10n.accountExportFailed)
                    // What actually went wrong, when the backend said: a
                    // rate limit and a dead network are different problems
                    // and only one of them is worth waiting out.
                    if let reason = store.exportError {
                        Text(L10n.errorMessage(for: reason.kind))
                            .foregroundStyle(.white.opacity(0.55))
                        if let reference = reason.supportRequestID {
                            Text(L10n.errorSupportReference(reference))
                                .foregroundStyle(.white.opacity(0.4))
                        }
                    }
                }
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.7))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AccessibilityIdentifier.accountExportFailed)
            }
        } header: {
            SectionLabel(L10n.accountExportSection)
        } footer: {
            Text(L10n.accountExportFooter)
                .foregroundStyle(.white.opacity(0.5))
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

    /// Proving identity, as a sheet with the same two buttons signing in uses.
    @ViewBuilder
    private var proofSheet: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            VStack(spacing: DesignTokens.Spacing.small) {
                Text(L10n.accountProveTitle)
                    .font(DesignTokens.Typography.sectionTitle)
                Text(L10n.accountProveBody)
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
                appleIdentifier: AccessibilityIdentifier.accountProveApple,
                googleIdentifier: AccessibilityIdentifier.accountProveGoogle,
                fixtureIdentifier: AccessibilityIdentifier.accountProveFixture,
                onCredential: { credential, _ in
                    Task { await store.prove(with: credential) }
                },
                onCancelled: { store.noteCancelledProof() },
                onFailure: { store.noteProviderFailure($0) }
            )

            Button(L10n.accountCancel) { store.noteCancelledProof() }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(DesignTokens.Spacing.large)
        .presentationDetents([.medium])
    }

    // MARK: - Bindings and copy

    private var deletionStatus: String? {
        switch store.reauthenticationPhase {
        case .working: L10n.accountDeleteWorking
        case .failed(.identity): L10n.accountProveFailed
        case .failed(.operation): L10n.accountDeleteFailed
        default: nil
        }
    }

    private var deletionConfirmation: Binding<Bool> {
        Binding(
            get: { store.isConfirmingDeletion },
            // Dismissal follows the confirming tap as well as a cancel, and by
            // then the flow has moved on to asking for a proof. Cancelling on
            // the way out would undo the very thing the tap just started.
            set: { isPresented in
                if !isPresented, store.isConfirmingDeletion { store.cancelDeletion() }
            }
        )
    }

    private var proofPresented: Binding<Bool> {
        Binding(
            get: { store.reauthenticationPhase == .provingIdentity },
            set: { isPresented in
                if !isPresented, store.reauthenticationPhase == .provingIdentity {
                    store.noteCancelledProof()
                }
            }
        )
    }

    private var identityFailurePresented: Binding<Bool> {
        Binding(
            get: { store.identityFailure != nil },
            set: { isPresented in if !isPresented { store.dismissIdentityFailure() } }
        )
    }

    private var identityFailureTitle: String {
        store.identityFailure == .belongsToAnotherAccount
            ? L10n.accountIdentityTakenTitle
            : L10n.accountIdentityFailedTitle
    }

    private static func identityFailureMessage(_ failure: IdentityChangeFailure) -> String {
        switch failure {
        case .belongsToAnotherAccount: L10n.accountIdentityTakenBody
        case .providerAlreadyLinked: L10n.accountIdentityDuplicateBody
        case .lastIdentity: L10n.accountIdentityLastBody
        case .offline: L10n.accountIdentityOfflineBody
        case .refused: L10n.accountIdentityRefusedBody
        }
    }

    private static func name(of provider: AuthProvider) -> String {
        switch provider {
        case .apple: L10n.accountProviderApple
        case .google: L10n.accountProviderGoogle
        }
    }

    /// Dates are shown as days: the hour a device was last seen is precision
    /// nobody acts on, and a timestamp reads as surveillance.
    private static func day(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    /// The same glass the settings rows use, for the same reason.
    private var rowBackground: some View {
        Rectangle().fill(.ultraThinMaterial)
    }
}
