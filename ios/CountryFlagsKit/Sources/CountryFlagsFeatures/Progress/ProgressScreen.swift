import SwiftUI

import CountryFlagsDomain

/// What the learner has done so far.
///
/// The counts are the device's own: a guest studies durably and is never
/// synchronised, so a screen that waited for a server would be empty for every
/// user this build has. Mastery is the server's to award and is shown only
/// when it has been.
public struct ProgressScreen: View {
    // The screen owns the store it reads through, like every other screen with
    // one. A destination builds its store as it is presented, and the parent
    // re-renders while a launch is still importing content and synchronising —
    // held in a plain property, each of those would hand the screen a second
    // store that has read nothing yet, and the reading would start over for as
    // long as the launch stayed busy.
    @State private var store: ProgressStore

    public init(store: ProgressStore) {
        _store = State(wrappedValue: store)
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
            loaded
        }
    }

    /// Nothing studied yet says so, rather than showing a column of zeroes that
    /// looks like a screen that failed to load.
    private var empty: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Spacer(minLength: 0)

            Image(systemName: "chart.bar")
                .font(DesignTokens.Typography.screenTitle)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.white.opacity(0.8))

            Text(L10n.progressEmptyTitle)
                .font(DesignTokens.Typography.sectionTitle)
                .foregroundStyle(.white)
                .accessibilityIdentifier(AccessibilityIdentifier.progressEmpty)

            Text(L10n.progressEmptyBody)
                .font(DesignTokens.Typography.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.65))

            Spacer(minLength: 0)
        }
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.large)
        .sceneChrome()
    }

    private var loaded: some View {
        SceneScrollView {
            // The hero is what has actually been learned across every deck: the
            // per-deck rows underneath answer "where", and this answers "how
            // much", which is the question the screen is opened with.
            GlassCard(padding: DesignTokens.Spacing.large) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    SectionLabel(L10n.progressStudiedLabel)
                    Text("\(studiedCards)")
                        .font(DesignTokens.Typography.heroNumber)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .foregroundStyle(.white)
                    Text(L10n.progressDeckCounts(studiedCards, totalCards))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
                .accessibilityElement(children: .combine)
            }

            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                SectionLabel(L10n.progressDecksSection)
                ForEach(store.decks) { deck in
                    GlassCard(padding: DesignTokens.Spacing.medium) {
                        // The identifier goes on the row, not on the card
                        // around it: an identifier on a plain SwiftUI container
                        // is handed to every descendant and overwrites theirs.
                        DeckProgressRowView(deck: deck)
                            .accessibilityIdentifier(
                                AccessibilityIdentifier.progressDeckRow(deck.code)
                            )
                    }
                }
            }

            if !store.achievements.isEmpty {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                    SectionLabel(L10n.progressAchievementsSection)
                    GlassCard(padding: DesignTokens.Spacing.medium) {
                        VStack(spacing: DesignTokens.Spacing.medium) {
                            ForEach(store.achievements) { achievement in
                                AchievementRowView(achievement: achievement)
                            }
                        }
                    }
                }
            }
        }
    }

    private var studiedCards: Int {
        store.decks.reduce(0) { $0 + $1.startedCards }
    }

    private var totalCards: Int {
        store.decks.reduce(0) { $0 + $1.totalCards }
    }
}

struct DeckProgressRowView: View {
    let deck: DeckProgressRow

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            HStack {
                Text(deck.name)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                Spacer()
                if let tier = deck.masteryTier {
                    MasteryTierLabel(tier: tier)
                }
            }

            // A bar drawn rather than a system indicator: on glass the platform
            // one brings its own tinted track, which reads as a second material
            // sitting on the first.
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.15))
                    Capsule()
                        .fill(.white)
                        .frame(width: proxy.size.width * deck.fraction)
                }
            }
            .frame(height: DesignTokens.Layout.progressBarHeight)

            HStack(spacing: DesignTokens.Spacing.small) {
                Text(L10n.progressDeckCounts(deck.startedCards, deck.totalCards))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.progressDeckCounts(deck.code)
                    )

                if deck.dueCards > 0 {
                    Text(L10n.progressDeckDue(deck.dueCards))
                        .font(DesignTokens.Typography.caption.weight(.medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, DesignTokens.Spacing.small)
                        .padding(.vertical, DesignTokens.Spacing.extraSmall)
                        .background(.white.opacity(0.15), in: Capsule())
                }
            }
        }
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
                .font(DesignTokens.Typography.caption.weight(.medium))
        } icon: {
            Image(systemName: tier.isKnown ? "rosette" : "questionmark.circle")
        }
        .labelStyle(.titleAndIcon)
        .foregroundStyle(.white.opacity(0.85))
        .padding(.horizontal, DesignTokens.Spacing.small)
        .padding(.vertical, DesignTokens.Spacing.extraSmall)
        .background(.white.opacity(0.12), in: Capsule())
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
        HStack(spacing: DesignTokens.Spacing.medium) {
            Image(systemName: "rosette")
                .font(DesignTokens.Typography.sectionTitle)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.white)
                .frame(width: DesignTokens.Spacing.large)

            VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                Text(achievement.code)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white)
                if let earnedAt = achievement.earnedAt {
                    Text(earnedAt.formatted(date: .abbreviated, time: .omitted))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }

            Spacer(minLength: 0)

            if let tier = achievement.tier {
                MasteryTierLabel(tier: tier)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
