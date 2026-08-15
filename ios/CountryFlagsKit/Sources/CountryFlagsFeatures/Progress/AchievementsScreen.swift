import SwiftUI

import CountryFlagsDomain

/// The trophies, on a screen of their own.
///
/// Everything here is the backend's word: an achievement exists because the
/// server awarded it, and the device only shows what the last sync brought
/// home. The hero is the count of what has been earned; under it, the awards
/// newest first. Nothing is promised — a list of locked outlines would be a
/// catalogue the server does not publish.
public struct AchievementsScreen: View {
    @State private var store: ProgressStore

    public init(store: ProgressStore) {
        _store = State(wrappedValue: store)
    }

    public var body: some View {
        content
            .navigationTitle(L10n.achievementsTitle)
            // Earned while this screen was covered — a session ends, a sync
            // runs — so the list is re-read on every return, not once.
            .onAppear {
                Task { await store.load() }
            }
    }

    @ViewBuilder
    private var content: some View {
        if !store.isLoaded {
            ContentLoadingStateView()
        } else if store.achievements.isEmpty {
            empty
        } else {
            earned
        }
    }

    private var earned: some View {
        SceneScrollView {
            GlassCard(padding: DesignTokens.Spacing.large) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    SectionLabel(L10n.achievementsEarned)
                    Text("\(store.achievements.count)")
                        .font(DesignTokens.Typography.heroNumber)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }

            GlassCard(padding: DesignTokens.Spacing.medium) {
                VStack(spacing: DesignTokens.Spacing.medium) {
                    ForEach(newestFirst) { achievement in
                        AchievementRowView(achievement: achievement)
                    }
                }
            }
        }
    }

    /// The latest win on top: the learner opens this screen right after
    /// earning something, and what they came for must not be at the bottom.
    private var newestFirst: [AchievementRow] {
        store.achievements.sorted {
            ($0.earnedAt ?? .distantPast) > ($1.earnedAt ?? .distantPast)
        }
    }

    private var empty: some View {
        SceneScrollView {
            VStack(spacing: DesignTokens.Spacing.medium) {
                Image(systemName: "rosette")
                    .font(DesignTokens.Typography.heroNumber)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.white.opacity(0.4))
                Text(L10n.achievementsEmpty)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, DesignTokens.Spacing.extraLarge)
            .accessibilityIdentifier(AccessibilityIdentifier.achievementsEmpty)
        }
    }
}
