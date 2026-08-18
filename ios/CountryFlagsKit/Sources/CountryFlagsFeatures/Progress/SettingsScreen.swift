import SwiftUI
import UIKit

import CountryFlagsDomain

/// The preferences a learner can change.
///
/// The one screen the design leaves alone. It is a form, and a form is a thing
/// iOS already draws better than we would: the toggles, the grouping and the
/// way a row reacts to a press are all recognisable, and replacing them with
/// our own would cost that recognition and buy nothing. What it does take from
/// the rest of the app is the ground — the list loses its own background so the
/// scene runs under it, which is all it needs to belong here.
public struct SettingsScreen: View {
    /// Owned for the same reason the progress screen owns its own.
    @State private var store: SettingsStore
    @State private var clearProgress: ClearProgressStore?
    private let makeAccount: (() -> AccountStore)?
    private let makeClearProgress: (() -> ClearProgressStore)?

    public init(
        store: SettingsStore,
        makeAccount: (() -> AccountStore)? = nil,
        makeClearProgress: (() -> ClearProgressStore)? = nil
    ) {
        _store = State(wrappedValue: store)
        self.makeAccount = makeAccount
        self.makeClearProgress = makeClearProgress
    }

    public var body: some View {
        List {
            // Who this progress belongs to, above the knobs that shape it.
            if let makeAccount {
                AccountSection(store: makeAccount())
                    .listRowBackground(rowBackground)
            }

            if store.didReloadAfterConflict {
                Section {
                    Text(L10n.settingsConflictReloaded)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .accessibilityIdentifier(AccessibilityIdentifier.settingsConflict)
                }
                .listRowBackground(rowBackground)
            }

            Section {
                Picker(L10n.studySessionSize, selection: sessionSize) {
                    ForEach(SettingsStore.sessionSizes, id: \.self) { size in
                        Text(verbatim: "\(size)")
                            .tag(size)
                            .accessibilityIdentifier(
                                AccessibilityIdentifier.settingsSessionSize(size)
                            )
                    }
                }
                .pickerStyle(.segmented)
            } header: {
                SectionLabel(L10n.settingsSessionSection)
            }
            .listRowBackground(rowBackground)

            Section {
                Toggle(L10n.settingsSound, isOn: soundEnabled)
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsSound)
                Toggle(L10n.settingsHaptics, isOn: hapticsEnabled)
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsHaptics)
            } header: {
                SectionLabel(L10n.settingsFeedbackSection)
            }
            .listRowBackground(rowBackground)

            Section {
                Toggle(L10n.settingsReminders, isOn: remindersEnabled)
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsReminders)

                // The hour is offered only once there is something to schedule:
                // a picker above a switch that is off sets a time for nothing.
                if store.settings.remindersEnabled,
                    store.reminderAuthorization == .authorized
                {
                    DatePicker(
                        L10n.settingsRemindersTime,
                        selection: reminderTime,
                        displayedComponents: .hourAndMinute
                    )
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsRemindersTime)
                }

                // The preference arrived from another device: the account
                // wants reminders and this phone has never been asked. The ask
                // stays an action someone takes.
                if store.settings.remindersEnabled,
                    store.reminderAuthorization == .notDetermined
                {
                    Button(L10n.settingsRemindersAllow) {
                        Task { await store.requestReminderPermission() }
                    }
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsRemindersAllow)
                }

                // A refusal is the system's to reverse, so the row leads there
                // instead of offering a switch that would do nothing.
                if store.reminderAuthorization == .denied,
                    let url = URL(string: UIApplication.openSettingsURLString)
                {
                    Link(L10n.settingsOpenSystemSettings, destination: url)
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.settingsRemindersOpenSystemSettings
                        )
                }
            } header: {
                SectionLabel(L10n.settingsRemindersSection)
            } footer: {
                // iOS decides when a local notification is actually delivered,
                // so the screen records the wish without promising a time.
                Text(
                    store.reminderAuthorization == .denied
                        ? L10n.settingsRemindersDenied
                        : L10n.settingsRemindersFooter
                )
                .foregroundStyle(.white.opacity(0.5))
            }
            .listRowBackground(rowBackground)

            clearProgressSection
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(L10n.settingsTitle)
        .sceneChrome()
        .task {
            await store.load()
            if clearProgress == nil { clearProgress = makeClearProgress?() }
            await clearProgress?.load()
        }
        .confirmationDialog(
            L10n.settingsClearProgressTitle,
            isPresented: clearProgressConfirmation,
            titleVisibility: .visible
        ) {
            Button(L10n.settingsClearProgressConfirm, role: .destructive) {
                clearProgress?.confirm()
            }
            .accessibilityIdentifier(AccessibilityIdentifier.settingsClearProgressConfirm)
            Button(L10n.accountCancel, role: .cancel) {
                clearProgress?.cancel()
            }
        } message: {
            Text(L10n.settingsClearProgressBody)
        }
        .sheet(isPresented: clearProgressProof) {
            clearProgressProofSheet
        }
    }

    /// The one destructive thing this screen can do, and only for an account:
    /// a guest has no server-side history to delete and nobody to prove they
    /// are, so the section is simply absent.
    @ViewBuilder
    private var clearProgressSection: some View {
        if let clearProgress, clearProgress.isOffered {
            Section {
                Button(L10n.settingsClearProgress, role: .destructive) {
                    clearProgress.request()
                }
                .accessibilityIdentifier(AccessibilityIdentifier.settingsClearProgress)

                // What happened last, said plainly: both failures leave the
                // progress standing, and saying so is the point.
                if let status = clearProgressStatus {
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
            .listRowBackground(rowBackground)
        }
    }

    /// Proving identity, as a sheet with the same two buttons signing in uses.
    /// It cannot be dismissed into a half-finished state: nothing has been
    /// deleted until the sheet's work returns.
    @ViewBuilder
    private var clearProgressProofSheet: some View {
        if let clearProgress {
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
                    prepareNonce: { clearProgress.prepareNonce() },
                    rawNonce: { clearProgress.preparedNonce?.raw ?? "" },
                    google: clearProgress.google,
                    fixtureCredential: nil,
                    appleIdentifier: AccessibilityIdentifier.clearProgressProveApple,
                    googleIdentifier: AccessibilityIdentifier.clearProgressProveGoogle,
                    fixtureIdentifier: AccessibilityIdentifier.clearProgressProveFixture,
                    onCredential: { credential, _ in
                        Task { await clearProgress.prove(with: credential) }
                    },
                    onCancelled: { clearProgress.noteCancelledProof() },
                    onFailure: { clearProgress.noteProviderFailure($0) }
                )

                Button(L10n.accountCancel) { clearProgress.cancel() }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white.opacity(0.7))
            }
            .padding(DesignTokens.Spacing.large)
            .presentationDetents([.medium])
        }
    }

    private var clearProgressStatus: String? {
        switch clearProgress?.phase {
        case .clearing: L10n.settingsClearProgressWorking
        case .cleared: L10n.settingsClearProgressDone
        case .failed(.identity): L10n.settingsClearProgressReauthFailed
        case .failed(.deletion): L10n.settingsClearProgressFailed
        default: nil
        }
    }

    private var clearProgressConfirmation: Binding<Bool> {
        Binding(
            get: { clearProgress?.phase == .confirming },
            set: { isPresented in
                if !isPresented, clearProgress?.phase == .confirming { clearProgress?.cancel() }
            }
        )
    }

    private var clearProgressProof: Binding<Bool> {
        Binding(
            get: { clearProgress?.phase == .provingIdentity },
            set: { isPresented in
                if !isPresented, clearProgress?.phase == .provingIdentity {
                    clearProgress?.noteCancelledProof()
                }
            }
        )
    }

    /// Glass rather than the system's grouped background, which on this scene
    /// would be a flat grey slab with no relationship to anything under it.
    ///
    /// A plain fill, not a rounded shape: the grouped list rounds each
    /// section's outer corners itself, and a shape rounded on every row drew
    /// a seam between the rows of one section.
    private var rowBackground: some View {
        Rectangle().fill(.ultraThinMaterial)
    }

    private var sessionSize: Binding<Int> {
        Binding(
            get: { store.settings.sessionSize },
            set: { size in Task { await store.setSessionSize(size) } }
        )
    }

    private var soundEnabled: Binding<Bool> {
        Binding(
            get: { store.settings.soundEnabled },
            set: { isOn in Task { await store.setSoundEnabled(isOn) } }
        )
    }

    private var hapticsEnabled: Binding<Bool> {
        Binding(
            get: { store.settings.hapticsEnabled },
            set: { isOn in Task { await store.setHapticsEnabled(isOn) } }
        )
    }

    private var remindersEnabled: Binding<Bool> {
        Binding(
            get: { store.settings.remindersEnabled },
            set: { isOn in Task { await store.setRemindersEnabled(isOn) } }
        )
    }

    /// `DatePicker` speaks in dates; the schedule is an hour and a minute. The
    /// day the picker is anchored to is never used — only the two components
    /// are read back — so any day serves, and today's keeps the wheel showing
    /// a sensible date to a reader who somehow sees one.
    private var reminderTime: Binding<Date> {
        Binding(
            get: {
                Calendar.current.date(
                    bySettingHour: store.reminderTime.hour,
                    minute: store.reminderTime.minute,
                    second: 0,
                    of: Date()
                ) ?? Date()
            },
            set: { date in
                let components = Calendar.current.dateComponents(
                    [.hour, .minute], from: date
                )
                guard let hour = components.hour, let minute = components.minute else { return }
                Task {
                    await store.setReminderTime(
                        ReminderSchedule(hour: hour, minute: minute)
                    )
                }
            }
        )
    }
}
