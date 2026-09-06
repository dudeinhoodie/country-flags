import SwiftUI

import CountryFlagsDomain

/// A deck that has been bought, which is to say: a deck.
///
/// Everything commerce put on the screen is gone — no price, no lock, no
/// restore, no badge — because the purchase is over and the thing the person
/// paid for is the content. What is left is the compact header the design
/// approved, the trail through it, the search and the list, with the one
/// action pinned where every other action in the app is.
///
/// It is a screen of its own rather than a branch inside the free deck screen
/// for one reason: the free flow must go on behaving exactly as it does today,
/// and a shared body with four conditionals in it is how that stops being
/// true.
struct OwnedDeckView: View {
    let deck: DeckRecord
    let cards: [LearningCardRecord]
    let store: ContentStore
    let assets: any AssetLoading
    let progress: DeckProgressRow?
    /// The unfinished sitting in this deck, when there is one.
    let continuable: ContinuableSession?
    /// Whether the cards are still on their way. A deck bought a second ago
    /// has none, and an empty list under a title is a bug to look at rather
    /// than a download to wait for.
    let isDownloading: Bool
    /// Whether the deck is open on a purchase the backend has not
    /// acknowledged. Said quietly and never as an error: the money moved, the
    /// device wrote it down, and the queue is retrying.
    let isAwaitingSync: Bool
    @Binding var searchText: String
    let onOpenCard: (LearningCardRecord) -> Void
    let onStart: () -> Void

    @Environment(\.displayScale) private var displayScale
    /// What each card's emblem is called, when it has a name of its own —
    /// "Federal Eagle" rather than "Germany". Read once for the whole list:
    /// a lookup per row would be one store round trip per row.
    @State private var assetNames: [UUID: String] = [:]

    var body: some View {
        SceneScrollView {
            header

            if isAwaitingSync {
                syncLine
            }

            if isDownloading {
                PurchaseStatusCard(status: .downloading)
            } else if cards.isEmpty && searchText.isEmpty {
                PurchaseStatusCard(status: .downloadFailed)
            }

            list
        }
        .navigationTitle(deck.name)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button(continuable == nil ? L10n.deckStartLearning : L10n.homeContinue, action: onStart)
                .buttonStyle(GlassProminentActionStyle())
                .disabled(cards.isEmpty)
                .accessibilityIdentifier(AccessibilityIdentifier.studyStart)
                .padding(.horizontal, DesignTokens.Spacing.medium)
                .padding(.bottom, DesignTokens.Spacing.medium)
        }
        .task(id: cards.count) { await loadAssetNames() }
    }

    // MARK: - The header

    /// Name, size, a reduced fan and the trail — compact enough that the list
    /// starts above the fold, which is what the approved reference is about.
    private var header: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
            HStack(alignment: .top, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    Text(deck.name)
                        .font(DesignTokens.Typography.screenTitle)
                        .foregroundStyle(.white)
                    Text(summary)
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(.white.opacity(0.55))
                        .accessibilityIdentifier(AccessibilityIdentifier.deckCardCount)
                }
                Spacer(minLength: 0)
                FlagFanView(cards: Array(cards.prefix(3)), store: store, assets: assets)
            }

            if let progress {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                    Text(L10n.deckLearnedOf(progress.learnedCards, progress.totalCards))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.55))
                    ProgressTrackView(
                        started: progress.fraction,
                        learned: progress.learnedFraction
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The one line commerce is still allowed after a purchase, and only while
    /// the backend has not caught up.
    private var syncLine: some View {
        HStack(spacing: DesignTokens.Spacing.small) {
            Image(systemName: "arrow.clockwise")
                .font(.caption2)
            Text(L10n.commerceStatusTitle(.syncing))
                .font(DesignTokens.Typography.caption)
        }
        .foregroundStyle(.white.opacity(0.45))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.deckPurchaseStatus)
    }

    // MARK: - The list

    private var list: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            HStack {
                SectionLabel(L10n.deckAllCards)
                Text("\(cards.count)")
                    .font(DesignTokens.Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.4))
            }

            if cards.isEmpty && !searchText.isEmpty {
                Text(L10n.deckNoMatches)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .accessibilityIdentifier(AccessibilityIdentifier.deckNoMatches)
            } else {
                // Built as they come into view: a deck can hold every country
                // there is, and the same reasoning as the free deck screen —
                // drawn rather than glassed, because live glass stops being
                // sampled once a pane is taller than the screen.
                LazyVStack(spacing: 0) {
                    ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                        if index > 0 {
                            Divider()
                                .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                                .padding(.leading, DesignTokens.Layout.rowFlagWidth)
                        }
                        Button {
                            onOpenCard(card)
                        } label: {
                            OwnedCardRow(
                                card: card,
                                symbolName: assetNames[card.promptAssetID],
                                store: store,
                                assets: assets,
                                missing: missingSymbol
                            )
                        }
                        .buttonStyle(OwnedCardRowStyle())
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.deckCountryRow(card.id)
                        )
                    }
                }
                .padding(.vertical, DesignTokens.Spacing.small)
                .background(
                    RoundedRectangle(
                        cornerRadius: DesignTokens.Radius.large,
                        style: .continuous
                    )
                    .fill(.white.opacity(0.06))
                )
                .overlay(
                    RoundedRectangle(
                        cornerRadius: DesignTokens.Radius.large,
                        style: .continuous
                    )
                    .strokeBorder(
                        .white.opacity(DesignTokens.Card.borderOpacity),
                        lineWidth: 1 / displayScale
                    )
                )
                .clipShape(
                    RoundedRectangle(
                        cornerRadius: DesignTokens.Radius.large,
                        style: .continuous
                    )
                )
            }
        }
    }

    private var summary: String {
        let count = L10n.deckCardCount(deck.cardCount)
        let kinds = deck.contentKinds.compactMap(L10n.contentKind)
        guard !kinds.isEmpty else { return count }
        return "\(count) · \(kinds.joined(separator: ", "))"
    }

    private var missingSymbol: MissingAssetSymbol {
        deck.contentKinds.contains(AssetType.coatOfArms.rawValue) ? .coatOfArms : .flag
    }

    private func loadAssetNames() async {
        var names: [UUID: String] = [:]
        for card in cards {
            guard names[card.promptAssetID] == nil else { continue }
            if let name = await store.asset(id: card.promptAssetID)?.displayName {
                names[card.promptAssetID] = name
            }
        }
        assetNames = names
    }
}

/// A row that is a button without looking like one — the same behaviour the
/// free deck's list has, so the two lists cannot drift apart in feel.
private struct OwnedCardRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, DesignTokens.Spacing.medium)
            .contentShape(.rect)
            .background(configuration.isPressed ? Color.white.opacity(0.08) : Color.clear)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// One card in an owned deck: the emblem, who it belongs to, what it is
/// called, and the mark that says the row opens something.
///
/// The thumbnail is aspect-fit on a plane rather than filled: a coat of arms
/// is drawn to its own outline, and a crop that took a crown off would be a
/// different emblem.
private struct OwnedCardRow: View {
    let card: LearningCardRecord
    /// The emblem's own name, where the release published one.
    let symbolName: String?
    let store: ContentStore
    let assets: any AssetLoading
    let missing: MissingAssetSymbol

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.medium) {
            FlagImageView(
                assetID: card.promptAssetID,
                accessibilityLabel: card.displayName,
                store: store,
                assets: assets,
                missing: missing
            )
            .padding(DesignTokens.Spacing.extraSmall)
            .frame(
                width: DesignTokens.Layout.rowFlagWidth,
                height: DesignTokens.Layout.rowFlagWidth
            )
            .background(.white.opacity(0.05))
            .clipShape(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
                    .strokeBorder(
                        .white.opacity(DesignTokens.Card.borderOpacity),
                        lineWidth: 1 / displayScale
                    )
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(card.displayName)
                    .font(DesignTokens.Typography.body.weight(.semibold))
                    .foregroundStyle(.white)
                if let symbolName {
                    Text(symbolName)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.55))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white.opacity(0.35))
        }
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
        .padding(.vertical, DesignTokens.Spacing.small)
        .accessibilityElement(children: .combine)
    }
}
