import SwiftUI

import CountryFlagsDomain

/// The deck catalog.
///
/// The one screen with no hero, deliberately: it is a list, and the job is to
/// choose from it. Sections come from the domain grouping rather than from the
/// view, so what the user sees and what the tests assert are the same rule.
public struct CatalogView: View {
    private let store: ContentStore
    private let onOpenDeck: (UUID) -> Void

    @State private var searchText = ""

    public init(store: ContentStore, onOpenDeck: @escaping (UUID) -> Void) {
        self.store = store
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

                    // One pane per section rather than one per deck: a region
                    // is a group, and drawing its decks as separate cards would
                    // say they are unrelated.
                    GlassCard(padding: DesignTokens.Spacing.small) {
                        VStack(spacing: 0) {
                            ForEach(Array(section.decks.enumerated()), id: \.element.id) {
                                index, deck in
                                if index > 0 {
                                    Divider()
                                        .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                                }
                                Button {
                                    onOpenDeck(deck.id)
                                } label: {
                                    DeckRow(deck: deck)
                                        .padding(.horizontal, DesignTokens.Spacing.small)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier(
                                    AccessibilityIdentifier.catalogDeckRow(deck.code)
                                )
                            }
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

struct DeckRow: View {
    let deck: DeckRecord

    var body: some View {
        GlassRow {
            EmptyView()
        } content: {
            Text(deck.name)
                .font(DesignTokens.Typography.sectionTitle)
                .foregroundStyle(.white)
            if !deck.deckDescription.isEmpty {
                Text(deck.deckDescription)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.6))
            }
            Text(L10n.deckCardCount(deck.cardCount))
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.45))
        }
    }
}
