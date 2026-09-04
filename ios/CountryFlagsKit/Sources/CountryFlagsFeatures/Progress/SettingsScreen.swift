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
    /// The chosen session size, held here so the control answers the tap
    /// rather than the round trip behind it. The store is written through and
    /// stays the source of truth; this is what the finger is promised.
    @State private var chosenSessionSize: Int?
    @State private var privacy: PrivacyStore?
    private let makePrivacy: (() -> PrivacyStore)?
    /// Which build this is, for the builds that are not production. It used to
    /// be a badge in the corner of the first screen; the avatar has that corner
    /// now, and a tester still has to be able to tell dev from the real thing —
    /// so it says so here, where somebody looking for it will look.
    private let environmentBadge: String?

    public init(
        store: SettingsStore,
        makePrivacy: (() -> PrivacyStore)? = nil,
        environmentBadge: String? = nil
    ) {
        _store = State(wrappedValue: store)
        self.makePrivacy = makePrivacy
        self.environmentBadge = environmentBadge
    }

    public var body: some View {
        List {
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
                // The same shape the deck screen uses: the choice spans the
                // row under its own label, rather than being squeezed beside
                // one. A segmented control that is three narrow slots on one
                // screen and full width on another is two controls as far as
                // a person's hands are concerned.
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                    SectionLabel(L10n.studySessionSize)
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
                    // The label is spoken, not drawn: the line above already
                    // says what the choice is, and the row is the control.
                    .labelsHidden()
                    .accessibilityLabel(L10n.studySessionSize)
                }
                .padding(.vertical, DesignTokens.Spacing.extraSmall)
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
                // A footer only when there is something the switch cannot say
                // on its own: the system has the last word here, and that is
                // worth a line. "The system decides when it arrives" was not —
                // nobody read it, and nobody could act on it.
                if store.reminderAuthorization == .denied {
                    Text(L10n.settingsRemindersDenied)
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
            .listRowBackground(rowBackground)

            privacySection

            // Clearing progress left this screen: it is an act of account
            // management, and it lives with the account behind the avatar.

            Section {
                NavigationLink(value: AppRoute.about) {
                    Text(L10n.settingsAbout)
                }
                .accessibilityIdentifier(AccessibilityIdentifier.settingsAbout)
            }
            .listRowBackground(rowBackground)

            if let environmentBadge {
                Section {
                    Text(environmentBadge)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                        .frame(maxWidth: .infinity, alignment: .center)
                        .accessibilityIdentifier(AccessibilityIdentifier.environmentBadge)
                }
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(L10n.settingsTitle)
        .sceneChrome()
        .onChange(of: store.settings.sessionSize) { _, stored in
            chosenSessionSize = stored
        }
        .task {
            await store.load()
            chosenSessionSize = store.settings.sessionSize
            if privacy == nil { privacy = makePrivacy?() }
            await privacy?.load()
        }
    }

    /// What is collected, and what is not.
    ///
    /// Two switches rather than one: crash diagnostics and product analytics
    /// are different questions, and a single "telemetry" toggle would answer
    /// both with whichever one the person cared about more. Both start off —
    /// nothing optional is collected until somebody says so — and studying
    /// works identically either way.
    @ViewBuilder
    private var privacySection: some View {
        if let privacy {
            Section {
                Toggle(L10n.privacyProductAnalytics, isOn: productAnalyticsBinding(privacy))
                    .accessibilityIdentifier(AccessibilityIdentifier.privacyProductAnalytics)
                Toggle(L10n.privacyDiagnostics, isOn: diagnosticsBinding(privacy))
                    .accessibilityIdentifier(AccessibilityIdentifier.privacyDiagnostics)

                if privacy.didReloadAfterConflict {
                    Text(L10n.settingsConflictReloaded)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .accessibilityIdentifier(AccessibilityIdentifier.privacyConflict)
                }
            } header: {
                SectionLabel(L10n.privacySection)
            } footer: {
                Text(L10n.privacyFooter)
                    .foregroundStyle(.white.opacity(0.5))
            }
            .listRowBackground(rowBackground)
        }
    }

    private func productAnalyticsBinding(_ privacy: PrivacyStore) -> Binding<Bool> {
        Binding(
            get: { privacy.consent.productAnalytics == .granted },
            set: { isOn in Task { await privacy.setProductAnalytics(granted: isOn) } }
        )
    }

    private func diagnosticsBinding(_ privacy: PrivacyStore) -> Binding<Bool> {
        Binding(
            get: { privacy.consent.diagnostics == .granted },
            set: { isOn in Task { await privacy.setDiagnostics(granted: isOn) } }
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
            get: { chosenSessionSize ?? store.settings.sessionSize },
            set: { size in
                chosenSessionSize = size
                Task { await store.setSessionSize(size) }
            }
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
}
