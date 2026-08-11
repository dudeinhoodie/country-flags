import SwiftUI

import CountryFlagsDomain

/// The first screen.
///
/// The parts that need a session or progress arrive with their own work
/// packages. What is here now is the content half: a greeting that needs no
/// name, a way into the catalog, and recommended decks drawn from what the
/// device has already stored.
public struct HomeView: View {
    private let store: ContentStore
    private let sync: SyncCenter
    private let onOpenCatalog: () -> Void
    private let onOpenProgress: () -> Void
    private let onOpenDeck: (UUID) -> Void

    public init(
        store: ContentStore,
        sync: SyncCenter,
        onOpenCatalog: @escaping () -> Void,
        onOpenProgress: @escaping () -> Void,
        onOpenDeck: @escaping (UUID) -> Void
    ) {
        self.store = store
        self.sync = sync
        self.onOpenCatalog = onOpenCatalog
        self.onOpenProgress = onOpenProgress
        self.onOpenDeck = onOpenDeck
    }

    public var body: some View {
        content
            .navigationTitle(L10n.homeTitle)
            .refreshable {
                await store.refresh()
                // Pull-to-refresh goes through the same boundary as every other
                // trigger, so two of them cannot race into a double submission.
                await sync.synchronize(trigger: .pullToRefresh)
            }
            .task { await store.start() }
            // The queue grows with every answer, and answering happens on
            // another screen. Re-reading on appearance is what keeps the count
            // honest without asking the network for anything.
            .onAppear {
                Task { await sync.refreshStatus() }
            }
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
            Section {
                Text(L10n.homeGreeting)
                    .font(DesignTokens.Typography.screenTitle)
                    .accessibilityIdentifier(AccessibilityIdentifier.homeGreeting)
            }

            // Synchronisation explains itself only when it has something to
            // say; a healthy device up to date shows nothing.
            if sync.status.isWorthReporting {
                Section {
                    SyncStatusLine(status: sync.status)
                }
            }

            // The content state is shown only when there is something to say, so
            // a healthy launch has no status line at all.
            if isStale || failure != nil {
                Section {
                    ContentStatusBanner(isStale: isStale, failure: failure)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }

            Section(L10n.homeRecommended) {
                ForEach(recommended(sections), id: \.id) { deck in
                    Button {
                        onOpenDeck(deck.id)
                    } label: {
                        DeckRow(deck: deck)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(AccessibilityIdentifier.homeDeckRow(deck.code))
                }
            }

            Section {
                Button(L10n.homeOpenCatalog, action: onOpenCatalog)
                    .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                    .accessibilityIdentifier(AccessibilityIdentifier.homeOpenCatalog)
                Button(L10n.homeOpenProgress, action: onOpenProgress)
                    .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                    .accessibilityIdentifier(AccessibilityIdentifier.homeOpenProgress)
            }
        }
    }

    /// The curated decks are what the product recommends; the taxonomy ones are
    /// a way to browse rather than a suggestion. Falling back to whatever
    /// exists keeps the section from being empty on a release that publishes no
    /// curated deck at all.
    private func recommended(_ sections: [CatalogSection]) -> [DeckRecord] {
        let curated = sections.first { $0.kind == .curated }?.decks ?? []
        let decks = curated.isEmpty ? sections.flatMap(\.decks) : curated
        return Array(decks.prefix(Self.recommendedLimit))
    }

    private static let recommendedLimit = 3
}
