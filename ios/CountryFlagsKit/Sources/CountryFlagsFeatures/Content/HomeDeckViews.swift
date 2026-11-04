import SwiftUI

import CountryFlagsDomain

/// The all-countries deck when it is the screen's action (#515): a first
/// visit, or a day with nothing to repeat and nothing paused.
///
/// One of the three blocks the design language lets carry colour (#510): a
/// wash taken from the flags the deck would deal next, so the card looks like
/// what it offers. Over it the eyebrow, the deck's name, one line, the fan of
/// those same flags, and the one white button.
struct HomeDeckHero: View {
    let deck: DeckRecord
    /// "С чего начать" on a first visit, "Новые флаги" after that.
    let eyebrow: String
    /// The deck's size on a first visit; afterwards how many are still new.
    let line: String
    let action: String
    let cards: [LearningCardRecord]
    /// The main colours of the flags in the fan, for the wash.
    let colors: [Color]
    let store: ContentStore
    let assets: (any AssetLoading)?
    let run: () -> Void

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
            HStack(alignment: .top, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    SectionLabel(eyebrow)
                    Text(deck.name)
                        .font(DesignTokens.Typography.cardAnswer)
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(line)
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(.white.opacity(0.75))
                }

                Spacer(minLength: 0)

                if !cards.isEmpty {
                    FlagFanView(cards: cards, store: store, assets: assets)
                }
            }
            // Read as "Новые флаги, Все страны, 176 ещё не знакомы": the fan
            // is a picture of the deck and is not read.
            .accessibilityElement(children: .combine)

            Button(action, action: run)
                .buttonStyle(PrimaryActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.homeDeckRow(deck.code))
        }
        .padding(DesignTokens.Spacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { DeckHeroWash(colors: colors) }
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(
                .white.opacity(DesignTokens.Card.borderOpacity),
                lineWidth: 1 / displayScale
            )
        }
    }
}

/// The deck as a quiet second door (#515): when another block on the screen
/// already holds the white button — a paused sitting, a finished day — the
/// deck is a glass row with a small fan and a chevron, and the whole row
/// opens it.
struct HomeDeckRow: View {
    let deck: DeckRecord
    let cards: [LearningCardRecord]
    let store: ContentStore
    let assets: (any AssetLoading)?
    let run: () -> Void

    var body: some View {
        Button(action: run) {
            GlassCard(padding: DesignTokens.Spacing.medium) {
                HStack(spacing: DesignTokens.Spacing.medium) {
                    if !cards.isEmpty {
                        FlagFanView(cards: cards, store: store, assets: assets, scale: Self.fanScale)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(deck.name)
                            .font(DesignTokens.Typography.sectionTitle)
                            .foregroundStyle(.white)
                        Text(L10n.deckItemCount(deck.cardCount, contentKinds: deck.contentKinds))
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(DesignTokens.Typography.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.4))
                        .accessibilityHidden(true)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.homeDeckRow(deck.code))
    }

    /// The home fan at the size of a row: a reminder of the deck, not its
    /// picture.
    private static let fanScale: CGFloat = 0.62
}

/// The deck hero's ground: the next flags' colours as soft lights, under a
/// veil dark enough for white text.
///
/// Without colours yet — the flags are still being read — or with Reduce
/// Transparency on, it is the flat surface, so the card never flashes a
/// default colour that is not its own.
private struct DeckHeroWash: View {
    let colors: [Color]

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            DesignTokens.Colors.flatSurface
            if !reduceTransparency, !colors.isEmpty {
                ForEach(Array(colors.prefix(Self.lights.count).enumerated()), id: \.offset) { index, color in
                    let light = Self.lights[index]
                    RadialGradient(
                        colors: [color.opacity(light.opacity), .clear],
                        center: light.center,
                        startRadius: 0,
                        endRadius: DesignTokens.Scene.groundLightRadius * light.reach
                    )
                }
                LinearGradient(
                    colors: [.black.opacity(0.32), .black.opacity(0.5)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
        }
        .animation(.smooth(duration: 0.6), value: colors)
    }

    /// Where each flag's colour lights the card: the first from the leading
    /// side, the others from behind the fan.
    private static let lights: [(center: UnitPoint, reach: CGFloat, opacity: Double)] = [
        (UnitPoint(x: 0.1, y: 0.4), 0.8, 0.85),
        (UnitPoint(x: 0.85, y: 0.75), 0.7, 0.75),
        (UnitPoint(x: 0.95, y: 0.05), 0.55, 0.7),
    ]
}
