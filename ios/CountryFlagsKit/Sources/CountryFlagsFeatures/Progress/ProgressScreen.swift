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
    private let onOpenDeck: ((UUID) -> Void)?

    public init(store: ProgressStore, onOpenDeck: ((UUID) -> Void)? = nil) {
        _store = State(wrappedValue: store)
        self.onOpenDeck = onOpenDeck
    }

    public var body: some View {
        content
            .navigationTitle(L10n.progressTitle)
            .task { await store.load() }
            // The screen lives on a tab now and survives between visits, so
            // what changed while it was covered is re-read on the way back in.
            .onAppear { Task { await store.load() } }
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
            // The hero is the world itself: every continent drawn from the
            // app's own geodata, its brightness the share of it learned. The
            // rows underneath answer "where exactly"; this answers "how much
            // of the world", which is the question the screen is opened with.
            GlassCard(padding: DesignTokens.Spacing.large) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                    WorldMapView(
                        brightness: Dictionary(
                            regions.map { ($0.code, $0.learnedFraction) },
                            uniquingKeysWith: { first, _ in first }
                        )
                    )
                    .frame(maxWidth: .infinity)

                    VStack(alignment: .leading, spacing: 2) {
                        SectionLabel(L10n.progressLearnedLabel)
                        HStack(
                            alignment: .firstTextBaseline,
                            spacing: DesignTokens.Spacing.extraSmall
                        ) {
                            Text("\(learnedCards)")
                                .font(DesignTokens.Typography.heroNumber)
                                .monospacedDigit()
                                .contentTransition(.numericText())
                            Text("/ \(totalCards)")
                                .font(DesignTokens.Typography.sectionTitle)
                                .foregroundStyle(.white.opacity(0.55))
                            Spacer(minLength: DesignTokens.Spacing.small)
                            Text(L10n.progressMapHint)
                                .font(DesignTokens.Typography.caption)
                                .foregroundStyle(.white.opacity(0.45))
                        }
                        .foregroundStyle(.white)
                    }
                    .accessibilityElement(children: .combine)
                    // The whole-picture counts keep the identifier the
                    // curated row used to carry: same fact, new place. It is
                    // applied after the combine — on a container it would be
                    // stamped onto every text inside, and a query that asks
                    // for the single element would find a crowd.
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.progressDeckCounts(
                            whole?.code ?? "ALL"
                        )
                    )
                }
            }

            GlassCard(padding: DesignTokens.Spacing.small) {
                VStack(spacing: 0) {
                    ForEach(Array(regions.enumerated()), id: \.element.id) { index, deck in
                        if index > 0 {
                            Divider()
                                .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                        }
                        // A row is a door: the drill-down says which countries
                        // stand where.
                        Button {
                            onOpenDeck?(deck.id)
                        } label: {
                            regionRow(deck)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .disabled(onOpenDeck == nil)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.progressDeckRow(deck.code)
                        )
                    }
                }
            }
        }
    }

    private func regionRow(_ deck: DeckProgressRow) -> some View {
        HStack(spacing: DesignTokens.Spacing.small) {
            ContinentSilhouetteView(
                code: deck.code,
                opacity: 0.15 + 0.85 * deck.learnedFraction
            )
            .frame(width: 44, height: 32)

            Text(deck.name)
                .font(DesignTokens.Typography.sectionTitle)
                .foregroundStyle(.white)
                .lineLimit(1)

            Spacer(minLength: DesignTokens.Spacing.small)

            if let tier = deck.masteryTier {
                MasteryTierLabel(tier: tier)
            }

            Text(verbatim: "\(deck.learnedCards)/\(deck.totalCards)")
                .font(DesignTokens.Typography.sectionTitle)
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.7))
                .accessibilityIdentifier(AccessibilityIdentifier.progressDeckCounts(deck.code))

            if onOpenDeck != nil {
                Image(systemName: "chevron.right")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.4))
            }
        }
        .padding(.horizontal, DesignTokens.Spacing.small)
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
    }

    /// The regions, without the whole: the curated deck spans every card, so
    /// a row for it would restate the hero in different words.
    private var regions: [DeckProgressRow] {
        store.decks.filter { !$0.isCurated }
    }

    /// The curated deck, when the release publishes one: the numbers that
    /// count each card exactly once.
    private var whole: DeckProgressRow? {
        store.decks.first { $0.isCurated }
    }

    private var learnedCards: Int {
        whole?.learnedCards ?? regions.reduce(0) { $0 + $1.learnedCards }
    }

    private var totalCards: Int {
        whole?.totalCards ?? regions.reduce(0) { $0 + $1.totalCards }
    }
}

/// The world, assembled from the same silhouettes everything else draws.
///
/// The layout is a hand-set composition rather than a projection: each
/// continent sits at a fixed fraction of the pane, sized to read at a
/// glance, and its brightness is the share of it learned. Fill the world by
/// learning it, literally.
struct WorldMapView: View {
    /// Deck code to learned fraction, 0...1.
    let brightness: [String: Double]

    /// Each continent's box as a fraction of the pane: where it starts and how
    /// much room it gets.
    ///
    /// Boxes rather than a point and a height, because the previous layout
    /// guessed each shape's width from its height and positioned by centre —
    /// so neighbours crept over one another whenever the guess was off. A box
    /// is checked by looking at it: none of these overlap, and each silhouette
    /// is drawn to fit inside its own.
    private static let placements:
        [(code: String, x: Double, y: Double, width: Double, height: Double)] = [
            ("AMERICAS", 0.02, 0.06, 0.26, 0.86),
            ("EUROPE", 0.38, 0.04, 0.15, 0.30),
            ("AFRICA", 0.40, 0.40, 0.17, 0.54),
            ("ASIA", 0.60, 0.02, 0.30, 0.54),
            ("OCEANIA", 0.79, 0.62, 0.17, 0.30),
        ]

    var body: some View {
        GeometryReader { proxy in
            ForEach(Self.placements, id: \.code) { placement in
                ContinentSilhouetteView(
                    code: placement.code,
                    opacity: 0.15 + 0.85 * (brightness[placement.code] ?? 0)
                )
                .frame(
                    width: proxy.size.width * placement.width,
                    height: proxy.size.height * placement.height
                )
                .position(
                    x: proxy.size.width * (placement.x + placement.width / 2),
                    y: proxy.size.height * (placement.y + placement.height / 2)
                )
            }
        }
        .aspectRatio(1.9, contentMode: .fit)
        .accessibilityHidden(true)
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
