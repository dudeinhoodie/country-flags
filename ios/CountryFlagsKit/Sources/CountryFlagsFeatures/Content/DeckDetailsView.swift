import SwiftUI

import CountryFlagsDomain

/// One deck: what it is, how big it is, and what is in it.
///
/// Session size and the two study modes arrive with the study work packages.
/// What this screen owns is the content half: the deck can be read, searched
/// and browsed with no network at all.
public struct DeckDetailsView: View {
    @State private var model: DeckDetailsModel
    private let store: ContentStore
    private let assets: any AssetLoading

    public init(deckID: UUID, store: ContentStore, assets: any AssetLoading) {
        _model = State(wrappedValue: DeckDetailsModel(deckID: deckID, store: store))
        self.store = store
        self.assets = assets
    }

    public var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .refreshable {
                await store.refresh()
                await model.load()
            }
            .task { await model.load() }
    }

    private var title: String {
        if case .ready(let details, _, _) = model.state, !details.deck.name.isEmpty {
            return details.deck.name
        }
        return L10n.deckTitle
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ContentLoadingStateView()
        case .empty:
            ContentUnavailableStateView(failure: nil) { await store.refresh() }
        case .failed(let failure):
            ContentUnavailableStateView(failure: failure) { await store.refresh() }
        case .ready(let details, let isStale, let failure):
            list(details, isStale: isStale, failure: failure)
        }
    }

    private func list(
        _ details: DeckDetails,
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

            Section {
                if !details.deck.deckDescription.isEmpty {
                    Text(details.deck.deckDescription)
                        .font(DesignTokens.Typography.body)
                }
                Text(L10n.deckCardCount(details.deck.cardCount))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(AccessibilityIdentifier.deckCardCount)
            }

            Section(L10n.deckCountriesSection) {
                if details.cards.isEmpty {
                    Text(L10n.deckNoMatches)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier(AccessibilityIdentifier.deckNoMatches)
                }
                ForEach(details.cards, id: \.id) { card in
                    CountryRow(card: card, store: store, assets: assets)
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.deckCountryRow(card.id)
                        )
                }
            }
        }
        .searchable(text: searchBinding, prompt: L10n.deckSearchPrompt)
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.searchText }, set: { model.searchText = $0 })
    }
}

struct CountryRow: View {
    let card: LearningCardRecord
    let store: ContentStore
    let assets: any AssetLoading

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.medium) {
            FlagImageView(
                assetID: card.promptAssetID,
                accessibilityLabel: card.displayName,
                store: store,
                assets: assets
            )
            .frame(width: 48, height: 32)

            Text(card.displayName)
                .font(DesignTokens.Typography.body)
        }
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
    }
}
