import SwiftUI

import CountryFlagsDomain

/// What the learner has done so far.
///
/// The counts are the device's own: a guest studies durably and is never
/// synchronised, so a screen that waited for a server would be empty for every
/// user this build has. Mastery is the server's to award and is shown only
/// when it has been.
public struct ProgressScreen: View {
    private let store: ProgressStore

    public init(store: ProgressStore) {
        self.store = store
    }

    public var body: some View {
        content
            .navigationTitle(L10n.progressTitle)
            .task { await store.load() }
    }

    @ViewBuilder
    private var content: some View {
        if !store.isLoaded {
            ContentLoadingStateView()
        } else if store.hasNoProgress {
            empty
        } else {
            list
        }
    }

    /// Nothing studied yet says so, rather than showing a column of zeroes that
    /// looks like a screen that failed to load.
    private var empty: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Image(systemName: "chart.bar")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(L10n.progressEmptyTitle)
                .font(DesignTokens.Typography.sectionTitle)
                .accessibilityIdentifier(AccessibilityIdentifier.progressEmpty)
            Text(L10n.progressEmptyBody)
                .font(DesignTokens.Typography.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(DesignTokens.Spacing.large)
    }

    private var list: some View {
        List {
            Section(L10n.progressDecksSection) {
                ForEach(store.decks) { deck in
                    DeckProgressRowView(deck: deck)
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.progressDeckRow(deck.code)
                        )
                }
            }

            if !store.achievements.isEmpty {
                Section(L10n.progressAchievementsSection) {
                    ForEach(store.achievements) { achievement in
                        AchievementRowView(achievement: achievement)
                    }
                }
            }
        }
    }
}

struct DeckProgressRowView: View {
    let deck: DeckProgressRow

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            HStack {
                Text(deck.name)
                    .font(DesignTokens.Typography.body)
                Spacer()
                if let tier = deck.masteryTier {
                    MasteryTierLabel(tier: tier)
                }
            }

            ProgressView(value: deck.fraction)
                .tint(.accentColor)

            Text(L10n.progressDeckCounts(deck.startedCards, deck.totalCards))
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(
                    AccessibilityIdentifier.progressDeckCounts(deck.code)
                )

            if deck.dueCards > 0 {
                Text(L10n.progressDeckDue(deck.dueCards))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, DesignTokens.Spacing.small)
        // The bar is decoration for a number that is already spoken; reading
        // both would say the same thing twice.
        .accessibilityElement(children: .combine)
    }
}

/// A tier the server awarded.
///
/// A tier this build does not know is printed as it arrived rather than
/// dropped: the server only reports one the learner reached, and hiding it
/// would take away an achievement because the app is out of date.
struct MasteryTierLabel: View {
    let tier: MasteryTier

    var body: some View {
        Label {
            Text(name)
                .font(DesignTokens.Typography.caption)
        } icon: {
            Image(systemName: tier.isKnown ? "rosette" : "questionmark.circle")
        }
        .labelStyle(.titleAndIcon)
        .foregroundStyle(.secondary)
    }

    private var name: String {
        switch tier {
        case .bronze: L10n.masteryBronze
        case .silver: L10n.masterySilver
        case .gold: L10n.masteryGold
        case .platinum: L10n.masteryPlatinum
        case .none: L10n.masteryNone
        case .unknown(let value): value
        }
    }
}

struct AchievementRowView: View {
    let achievement: AchievementRow

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                Text(achievement.code)
                    .font(DesignTokens.Typography.body)
                if let earnedAt = achievement.earnedAt {
                    Text(earnedAt.formatted(date: .abbreviated, time: .omitted))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let tier = achievement.tier {
                MasteryTierLabel(tier: tier)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
