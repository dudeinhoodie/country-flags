import SwiftUI

import CountryFlagsDomain

/// One card for every block on Home that asks for something now (#510): the
/// review queue, and the session left half-way.
///
/// The owner wanted the two to look exactly alike (2026-11-04), so they share
/// one shape rather than two lookalikes: the title and how many flags on one
/// line, the deck under them, the flags themselves, one button. The count is
/// a quiet number beside the title rather than a hero figure; the flags are
/// what the card is about, and they are on it.
struct HomeActionCard: View {
    let title: String
    /// "12 флагов": how many the block is about, beside the title.
    let count: String
    /// The deck the action opens, on its own line under the title.
    let deck: String?
    /// The flags the action deals first, in the order it deals them.
    let cards: [LearningCardRecord]
    /// How many flags the block stands for in all, so the strip can say how
    /// many it did not draw.
    let total: Int
    let action: String
    /// White is spent once per screen; a second action card on the same
    /// screen takes glass.
    var isProminent = true
    let identifier: String
    let store: ContentStore
    let assets: (any AssetLoading)?
    let run: () -> Void

    var body: some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    // One line while it fits; at the largest text sizes the
                    // count goes under the title instead of crushing it.
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.small) {
                            titleText
                            Spacer(minLength: DesignTokens.Spacing.small)
                            countText
                        }
                        VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                            titleText
                            countText
                        }
                    }

                    if let deck {
                        Text(deck)
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                }
                // Read as "Пора повторить, 12 флагов, Все страны". The flags
                // are a picture of the count and are not read one by one.
                .accessibilityElement(children: .combine)

                if !cards.isEmpty {
                    FlagStrip(cards: cards, total: total, store: store, assets: assets)
                }

                if isProminent {
                    Button(action, action: run)
                        .buttonStyle(PrimaryActionStyle())
                        .accessibilityIdentifier(identifier)
                } else {
                    Button(action, action: run)
                        .buttonStyle(GlassActionStyle())
                        .accessibilityIdentifier(identifier)
                }
            }
        }
    }

    private var titleText: some View {
        Text(title)
            .font(DesignTokens.Typography.cardAnswer)
            .foregroundStyle(.white)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var countText: some View {
        Text(count)
            .font(DesignTokens.Typography.body)
            .monospacedDigit()
            .contentTransition(.numericText())
            .foregroundStyle(.white.opacity(0.75))
    }
}

/// The flags a block is about, in a row: at most five, the rest as "+N".
///
/// Five is what fits a 402-point screen beside the pill; a narrower screen or
/// a larger text size drops to four and then three rather than wrapping, and
/// the pill counts whatever was not drawn, so the row never says less than the
/// number beside the title.
struct FlagStrip: View {
    let cards: [LearningCardRecord]
    let total: Int
    let store: ContentStore
    let assets: (any AssetLoading)?

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        if let assets {
            ViewThatFits(in: .horizontal) {
                ForEach(Self.limits, id: \.self) { limit in
                    row(limit: limit, assets: assets)
                }
            }
            .accessibilityHidden(true)
        }
    }

    private func row(limit: Int, assets: any AssetLoading) -> some View {
        let shown = Array(cards.prefix(limit))
        let more = max(0, total - shown.count)
        return HStack(spacing: DesignTokens.Spacing.small) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, card in
                FlagImageView(
                    assetID: card.promptAssetID,
                    accessibilityLabel: card.displayName,
                    store: store,
                    assets: assets,
                    drawnWidth: Self.size.width
                )
                .frame(width: Self.size.width, height: Self.size.height)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
                        .strokeBorder(
                            .white.opacity(DesignTokens.Card.borderOpacity),
                            lineWidth: 1 / displayScale
                        )
                }
                .shadow(color: .black.opacity(0.35), radius: 5, y: 2)
                // Turned a little each, the way the study pile lies, so the
                // row reads as cards rather than as a table of thumbnails.
                .rotationEffect(.degrees(Self.turns[index % Self.turns.count]))
            }

            if more > 0 {
                Text("+\(more)")
                    .font(DesignTokens.Typography.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .padding(.horizontal, DesignTokens.Spacing.small)
                    .padding(.vertical, DesignTokens.Spacing.extraSmall)
                    .background(.white.opacity(0.15), in: Capsule(style: .continuous))
            }
        }
        // Room for the turned corners and the shadow, so the row is not
        // clipped by the card's padding.
        .padding(.vertical, DesignTokens.Spacing.extraSmall)
    }

    /// The row flag: the design language's row width, at the card's 4:3.
    static let size = CGSize(
        width: DesignTokens.Layout.rowFlagWidth,
        height: DesignTokens.Layout.rowFlagWidth / DesignTokens.Card.aspectRatio
    )
    static let limits = [5, 4, 3]
    private static let turns: [Double] = [-4, 3, -2, 4, -3]
}
