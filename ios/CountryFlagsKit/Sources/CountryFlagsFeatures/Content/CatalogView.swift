import SwiftUI

import CountryFlagsDomain

/// The deck catalog, as an atlas.
///
/// One column. The curated deck leads with a fan of its own cards; each
/// region under it is recognised by its continent's shape — drawn large and
/// bright, the row's own subject rather than a watermark — with the learner's
/// trail beside it: how many cards, how many learned, and the same two-layer
/// bar the progress screen reads. Sections need no headings when every row
/// says what it is.
public struct CatalogView: View {
    private let store: ContentStore
    private let assets: any AssetLoading
    /// The app's one progress store, observed rather than built here.
    private let progress: ProgressStore?
    private let onOpenDeck: (UUID) -> Void

    @State private var searchText = ""
    @State private var curatedFan: [LearningCardRecord] = []

    public init(
        store: ContentStore,
        assets: any AssetLoading,
        progress: ProgressStore? = nil,
        onOpenDeck: @escaping (UUID) -> Void
    ) {
        self.store = store
        self.assets = assets
        self.progress = progress
        self.onOpenDeck = onOpenDeck
    }

    public var body: some View {
        content
            .navigationTitle(L10n.catalogTitle)
            .searchable(text: $searchText, prompt: L10n.catalogSearchPrompt)
            .refreshable { await store.refresh() }
            .task { await store.start() }
            // On a cold launch the fan races `store.start()`:
            // the catalog is not `.ready` yet, `reloadFan` bails out, and the
            // curated row would keep an empty fan for the whole visit. Keyed
            // to the catalog's content, the fan is re-read the moment the
            // import delivers it — and it is a no-op when the store was warm.
            .task(id: catalogFingerprint) { await reloadFan() }
    }

    /// The ready catalog's identity, for the re-read above; nil while there
    /// is nothing to fan.
    private var catalogFingerprint: Int? {
        guard case .ready(let sections, _, _) = store.catalog else { return nil }
        return sections.hashValue
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
                ForEach(section.decks, id: \.id) { deck in
                    Button {
                        onOpenDeck(deck.id)
                    } label: {
                        row(deck, isCurated: section.kind == .curated)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(AccessibilityIdentifier.catalogDeckRow(deck.code))
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

    /// One deck, one row. The curated deck carries a fan of its own cards —
    /// it holds every flag, so no single shape stands for it; a region
    /// carries its continent.
    private func row(_ deck: DeckRecord, isCurated: Bool) -> some View {
        GlassCard(padding: DesignTokens.Spacing.medium) {
            HStack(spacing: DesignTokens.Spacing.medium) {
                if !isCurated {
                    ContinentSilhouetteView(code: deck.code, opacity: 0.55)
                        .frame(width: 64, height: 48)
                }

                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    Text(deck.name)
                        .font(
                            isCurated
                                ? DesignTokens.Typography.sectionTitle.weight(.bold)
                                : DesignTokens.Typography.sectionTitle
                        )
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    Text(trail(for: deck))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.55))

                    if let row = progressRow(for: deck) {
                        ProgressTrackView(
                            started: row.fraction, learned: row.learnedFraction
                        )
                    }
                }

                if isCurated {
                    FlagFanView(cards: curatedFan, store: store, assets: assets)
                }
            }
        }
        // One row is one thing to hear: the name, the trail, nothing twice.
        .accessibilityElement(children: .combine)
    }

    /// "250 cards · Learned: 34", and just the count until something is.
    private func trail(for deck: DeckRecord) -> String {
        let count = L10n.deckCardCount(deck.cardCount)
        guard let row = progressRow(for: deck), row.learnedCards > 0 else { return count }
        return "\(count) · \(L10n.progressDeckLearned(row.learnedCards))"
    }

    private func progressRow(for deck: DeckRecord) -> DeckProgressRow? {
        progress?.decks.first { $0.id == deck.id }
    }

    private func reloadFan() async {
        if case .ready(let sections, _, _) = store.catalog,
            let curated = sections.first(where: { $0.kind == .curated })?.decks.first
        {
            curatedFan = Array(await store.cards(inDeck: curated.id).prefix(3))
        }
    }

    private func filtered(_ sections: [CatalogSection]) -> [CatalogSection] {
        guard !searchText.isEmpty else { return sections }
        return sections.compactMap { section in
            let decks = CatalogSearch.decks(section.decks, matching: searchText)
            return decks.isEmpty ? nil : CatalogSection(kind: section.kind, decks: decks)
        }
    }
}

/// The two-layer trail: the dim reach is what has been touched, the solid
/// one what has actually been learned — the same reading the progress screen
/// gives it.
struct ProgressTrackView: View {
    let started: Double
    let learned: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.15))
                Capsule()
                    .fill(.white.opacity(0.4))
                    .frame(width: proxy.size.width * started)
                Capsule()
                    .fill(.white)
                    .frame(width: proxy.size.width * learned)
            }
        }
        .frame(height: DesignTokens.Layout.progressBarHeight)
        .accessibilityHidden(true)
    }
}
