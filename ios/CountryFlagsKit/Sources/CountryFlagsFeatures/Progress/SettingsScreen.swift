import SwiftUI

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

    public init(store: SettingsStore) {
        _store = State(wrappedValue: store)
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
            } header: {
                SectionLabel(L10n.settingsRemindersSection)
            } footer: {
                // iOS decides when a local notification is actually delivered,
                // so the screen records the wish without promising a time.
                Text(L10n.settingsRemindersFooter)
                    .foregroundStyle(.white.opacity(0.5))
            }
            .listRowBackground(rowBackground)
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(L10n.settingsTitle)
        .sceneChrome()
        .task { await store.load() }
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
}
