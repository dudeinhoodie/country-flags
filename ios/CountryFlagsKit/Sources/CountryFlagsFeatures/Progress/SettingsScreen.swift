import SwiftUI

import CountryFlagsDomain

/// The preferences a learner can change.
public struct SettingsScreen: View {
    private let store: SettingsStore

    public init(store: SettingsStore) {
        self.store = store
    }

    public var body: some View {
        List {
            if store.didReloadAfterConflict {
                Section {
                    Text(L10n.settingsConflictReloaded)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier(AccessibilityIdentifier.settingsConflict)
                }
            }

            Section(L10n.settingsSessionSection) {
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
            }

            Section(L10n.settingsFeedbackSection) {
                Toggle(L10n.settingsSound, isOn: soundEnabled)
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsSound)
                Toggle(L10n.settingsHaptics, isOn: hapticsEnabled)
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsHaptics)
            }

            Section {
                Toggle(L10n.settingsReminders, isOn: remindersEnabled)
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsReminders)
            } header: {
                Text(L10n.settingsRemindersSection)
            } footer: {
                // iOS decides when a local notification is actually delivered,
                // so the screen records the wish without promising a time.
                Text(L10n.settingsRemindersFooter)
            }
        }
        .navigationTitle(L10n.settingsTitle)
        .task { await store.load() }
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
