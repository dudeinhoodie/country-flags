import SwiftUI

import CountryFlagsDomain

/// The deck catalog.
///
/// The one screen with no hero, deliberately: it is a list, and the job is to
/// choose from it. Sections come from the domain grouping rather than from the
/// view, so what the user sees and what the tests assert are the same rule.
public struct CatalogView: View {
    private let store: ContentStore
    private let assets: any AssetLoading
    private let onOpenDeck: (UUID) -> Void

    @State private var searchText = ""

    public init(
        store: ContentStore,
        assets: any AssetLoading,
        onOpenDeck: @escaping (UUID) -> Void
    ) {
        self.store = store
        self.assets = assets
        self.onOpenDeck = onOpenDeck
    }

    public var body: some View {
        content
            .navigationTitle(L10n.catalogTitle)
            .searchable(text: $searchText, prompt: L10n.catalogSearchPrompt)
            .refreshable { await store.refresh() }
            .task { await store.start() }
    }

    @ViewBuilder
    private var content: some View {
        switch store.catalog {
        case .loading:
            ContentLoadingStateView()
        case .empty:
            ContentUnavailableStateView(failure: nil) { await store.refresh() }
        case .failed(let failure):
            ContentUnavailableStateView(failure: failure) { await store.refresh() }
        case .ready(let sections, let isStale, let failure):
            loaded(sections: sections, isStale: isStale, failure: failure)
        }
    }

    private func loaded(
        sections: [CatalogSection],
        isStale: Bool,
        failure: ContentSyncFailure?
    ) -> some View {
        SceneScrollView {
            if isStale || failure != nil {
                ContentStatusBanner(isStale: isStale, failure: failure)
            }

            if let resolution = store.localeResolution, resolution.isFallback {
                Text(L10n.catalogLocaleFallback(resolution.locale))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityIdentifier(AccessibilityIdentifier.catalogLocaleFallback)
            }

            let matches = filtered(sections)

            ForEach(matches) { section in
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                    SectionLabel(sectionTitle(section.kind))

                    // Tiles, not rows: a deck is a pile of flag cards, and the
                    // catalog shows each one as exactly that — a small fan of
                    // its own flags with air around it, instead of three lines
                    // of text pressed against three more.
                    // The curated shelf runs full width: those decks are
                    // the recommendation, and one half-width tile beside an
                    // empty half reads as a gap, not as an offer.
                    LazyVGrid(
                        columns: Array(
                            repeating: GridItem(
                                .flexible(), spacing: DesignTokens.Spacing.small
                            ),
                            count: section.kind == .curated ? 1 : 2
                        ),
                        spacing: DesignTokens.Spacing.small
                    ) {
                        ForEach(section.decks, id: \.id) { deck in
                            Button {
                                onOpenDeck(deck.id)
                            } label: {
                                DeckTile(deck: deck, store: store, assets: assets)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier(
                                AccessibilityIdentifier.catalogDeckRow(deck.code)
                            )
                        }
                    }
                }
            }

            if matches.isEmpty {
                Text(L10n.catalogNoMatches)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .accessibilityIdentifier(AccessibilityIdentifier.catalogNoMatches)
            }
        }
    }

    private func filtered(_ sections: [CatalogSection]) -> [CatalogSection] {
        guard !searchText.isEmpty else { return sections }
        return sections.compactMap { section in
            let decks = CatalogSearch.decks(section.decks, matching: searchText)
            return decks.isEmpty ? nil : CatalogSection(kind: section.kind, decks: decks)
        }
    }

    /// An unknown kind keeps its own name rather than being relabelled: the
    /// backend published something this build has no word for, and inventing
    /// one would be worse than showing theirs.
    private func sectionTitle(_ kind: DeckKind) -> String {
        switch kind {
        case .curated: L10n.catalogSectionCurated
        case .taxonomy: L10n.catalogSectionRegions
        case .custom, .dynamicUser: L10n.catalogSectionPersonal
        case .unknown(let raw): raw
        }
    }
}

/// One deck as a small pile of its own flags.
///
/// The fan is the first three cards of the deck, held in fixed poses — the
/// same thrown-on-a-table language the study pile speaks. The description is
/// deliberately absent: it belongs to the deck's own screen, and the tile
/// says what a shelf label says — what it is and how much of it there is.
struct DeckTile: View {
    let deck: DeckRecord
    let store: ContentStore
    let assets: any AssetLoading

    @State private var preview: [LearningCardRecord] = []
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        GlassCard(padding: DesignTokens.Spacing.medium) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                fan
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(true)

                Text(deck.name)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                    .lineLimit(2, reservesSpace: true)
                    .multilineTextAlignment(.leading)

                Text(L10n.deckCardCount(deck.cardCount))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .contentShape(.rect)
        .task(id: deck.id) {
            preview = Array(await store.cards(inDeck: deck.id).prefix(3))
        }
    }

    private var fan: some View {
        ZStack {
            if preview.isEmpty {
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .frame(width: Self.flagSize.width, height: Self.flagSize.height)
            }
            ForEach(
                Array(preview.enumerated().reversed()), id: \.element.id
            ) { index, card in
                FlagImageView(
                    assetID: card.promptAssetID,
                    accessibilityLabel: card.displayName,
                    store: store,
                    assets: assets
                )
                .frame(width: Self.flagSize.width, height: Self.flagSize.height)
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
                // The shadow is what separates the cards where they overlap:
                // the poses alone read as one crooked flag.
                .shadow(color: .black.opacity(0.35), radius: 6, y: 3)
                .rotationEffect(.degrees(Self.poses[index].rotation))
                .offset(x: Self.poses[index].x, y: Self.poses[index].y)
            }
        }
        .frame(height: Self.fanHeight)
    }

    private static let flagSize = CGSize(width: 96, height: 72)
    private static let fanHeight: CGFloat = 92
    /// Fixed rather than scattered: every tile holds the same pile, so the
    /// grid reads as a set of shelves rather than a mess of tables.
    private static let poses: [(rotation: Double, x: CGFloat, y: CGFloat)] = [
        (0, 0, 0),
        (-9, -26, 4),
        (8, 26, 6),
    ]
}
