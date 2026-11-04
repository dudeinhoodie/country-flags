import SwiftUI

import CountryFlagsDomain

/// One region on Home, as a flat card (#517).
///
/// The continent sits at the bottom trailing corner, the name and one line at
/// the bottom leading corner. Before anything is started the continent is one
/// soft colour and the line is the deck's size; after that the continent fills
/// from the bottom — white for the share known, green for the share learned —
/// and the line says the same in words: "10 из 52 знакомы · 2 выучено".
///
/// Flat rather than glass (#510): the card's subject is the continent drawn on
/// it, and glass gave every card a tint from the scene behind it.
struct HomeRegionCard: View {
    let deck: DeckRecord
    /// The backend's counts for this deck, when there are any.
    let progress: DeckProgressRow?
    /// The first region spans both columns.
    let isWide: Bool

    var body: some View {
        FlatCard {
            VStack(alignment: .leading, spacing: 2) {
                Spacer(minLength: 0)
                Text(deck.name)
                    .font(isWide ? DesignTokens.Typography.cardAnswer : DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(line)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(
                maxWidth: .infinity,
                minHeight: isWide
                    ? DesignTokens.Layout.homeWideTileContentHeight
                    : DesignTokens.Layout.homeTileContentHeight,
                alignment: .bottomLeading
            )
            .background(alignment: .bottomTrailing) {
                let box = isWide ? DesignTokens.Layout.homeWideTileContinent : DesignTokens.Layout.homeTileContinent
                ContinentSilhouetteView(
                    code: deck.code,
                    opacity: Self.untouchedOpacity,
                    known: share(progress?.startedCards),
                    learned: share(progress?.learnedCards)
                )
                .frame(width: box.width, height: box.height)
            }
        }
    }

    /// The deck's size until something is started, then how far it has come.
    private var line: String {
        guard let progress, progress.startedCards > 0 else {
            return L10n.deckItemCount(deck.cardCount, contentKinds: deck.contentKinds)
        }
        let known = L10n.homeRegionKnown(progress.startedCards, of: progress.totalCards)
        guard progress.learnedCards > 0 else { return known }
        return "\(known) · \(L10n.homeRegionLearned(progress.learnedCards))"
    }

    /// Clamped for the reason `DeckProgressRow.fraction` is.
    private func share(_ count: Int?) -> Double {
        guard let count, let total = progress?.totalCards, total > 0 else { return 0 }
        return min(1, Double(count) / Double(total))
    }

    /// The continent before anything is started: present, and quiet.
    private static let untouchedOpacity = 0.28
}
