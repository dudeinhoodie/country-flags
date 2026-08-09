import SwiftUI

import CountryFlagsDomain

/// The deck catalog.
///
/// Sections come from the domain grouping rather than from the view, so what
/// the user sees and what the tests assert are the same rule.
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
            list(sections: sections, isStale: isStale, failure: failure)
        }
    }

    private func list(
        sections: [CatalogSection],
        isStale: Bool,
        failure: ContentSyncFailure?
    ) -> some View {
        List {
            if isStale || failure != nil {
                Section {
                    ContentStatusBanner(isStale: isStale, failure: failure)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }

            if let resolution = store.localeResolution, resolution.isFallback {
                Section {
                    Text(L10n.catalogLocaleFallback(resolution.locale))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier(AccessibilityIdentifier.catalogLocaleFallback)
                }
            }

            ForEach(filtered(sections)) { section in
                Section(sectionTitle(section.kind)) {
                    ForEach(section.decks, id: \.id) { deck in
                        Button {
                            onOpenDeck(deck.id)
                        } label: {
                            DeckRow(deck: deck)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(AccessibilityIdentifier.catalogDeckRow(deck.code))
                    }
                }
            }

            if filtered(sections).isEmpty {
                Text(L10n.catalogNoMatches)
                    .foregroundStyle(.secondary)
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
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
            Text(deck.name)
                .font(DesignTokens.Typography.sectionTitle)
            if !deck.deckDescription.isEmpty {
                Text(deck.deckDescription)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
            }
            Text(L10n.deckCardCount(deck.cardCount))
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
        .contentShape(.rect)
    }
}
