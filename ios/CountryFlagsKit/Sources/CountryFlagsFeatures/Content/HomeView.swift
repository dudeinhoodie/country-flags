import SwiftUI

import CountryFlagsDomain

/// The first screen.
///
/// It is built around one number and one action. Which number depends on what
/// the learner has done: cards waiting to be repeated if there are any, and the
/// size of a deck worth opening if there are not. Everything else on the screen
/// — the decks, the catalogue, the progress — is a way to get somewhere else
/// and is drawn quieter than the thing above it.
public struct HomeView: View {
    private let store: ContentStore
    private let sync: SyncCenter
    private let onOpenCatalog: () -> Void
    private let onOpenProgress: () -> Void
    private let onOpenDeck: (UUID) -> Void

    /// The counts behind the hero. Owned rather than held, for the reason the
    /// progress screen owns its own: this view is rebuilt whenever the launch
    /// makes progress, and a store rebuilt with it would start reading over
    /// again every time.
    @State private var progress: ProgressStore?

    public init(
        store: ContentStore,
        sync: SyncCenter,
        progress: ProgressStore? = nil,
        onOpenCatalog: @escaping () -> Void,
        onOpenProgress: @escaping () -> Void,
        onOpenDeck: @escaping (UUID) -> Void
    ) {
        self.store = store
        self.sync = sync
        _progress = State(wrappedValue: progress)
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
            // another screen, so the count is re-read when this one appears —
            // without asking the network for anything.
            //
            // Read again whenever content synchronisation moves, because that
            // read goes to the store the first import is still filling and can
            // arrive after the screen already has. Tied to appearance alone, a
            // count that lost that race stayed wrong for the whole visit and
            // only corrected itself once the learner left and came back.
            .task(id: store.status) { await sync.refreshStatus() }
            // Same reasoning for the hero: cards fall due while the learner is
            // elsewhere, so the number is re-read on every return.
            .task { await progress?.load() }
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
            // A subtitle rather than a second heading: the navigation bar
            // already says which screen this is, and two large titles stacked
            // read as a mistake.
            Text(L10n.homeGreeting)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.white.opacity(0.7))
                .accessibilityIdentifier(AccessibilityIdentifier.homeGreeting)

            // Both explain themselves only when they have something to say; a
            // healthy device up to date shows neither.
            if sync.status.isWorthReporting {
                SyncStatusLine(status: sync.status)
            }
            if isStale || failure != nil {
                ContentStatusBanner(isStale: isStale, failure: failure)
            }

            if let hero = hero(sections) {
                heroCard(hero)
            }

            let decks = recommended(sections)
            if !decks.isEmpty {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                    SectionLabel(L10n.homeRecommended)
                    ForEach(decks, id: \.id) { deck in
                        Button {
                            onOpenDeck(deck.id)
                        } label: {
                            GlassCard(padding: DesignTokens.Spacing.medium) {
                                GlassRow {
                                    EmptyView()
                                } content: {
                                    Text(deck.name)
                                        .font(DesignTokens.Typography.sectionTitle)
                                        .foregroundStyle(.white)
                                    Text(L10n.deckCardCount(deck.cardCount))
                                        .font(DesignTokens.Typography.caption)
                                        .foregroundStyle(.white.opacity(0.6))
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(AccessibilityIdentifier.homeDeckRow(deck.code))
                    }
                }
            }

            VStack(spacing: DesignTokens.Spacing.small) {
                Button(L10n.homeOpenCatalog, action: onOpenCatalog)
                    .buttonStyle(GlassActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.homeOpenCatalog)
                Button(L10n.homeOpenProgress, action: onOpenProgress)
                    .buttonStyle(GlassActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.homeOpenProgress)
            }
        }
    }

    /// The number and the deck it belongs to.
    ///
    /// Cards waiting to be repeated are what the app is for, so they win. With
    /// none waiting — a new install, or a day already finished — the screen
    /// offers a deck to open instead of a zero, which says nothing and looks
    /// like a screen that failed to load.
    private func hero(_ sections: [CatalogSection]) -> Hero? {
        if let due = progress?.decks.filter({ $0.dueCards > 0 })
            .max(by: { $0.dueCards < $1.dueCards }) {
            return Hero(
                deckID: due.id,
                label: L10n.homeDue,
                count: due.dueCards,
                name: due.name,
                action: L10n.homeContinue
            )
        }
        guard let deck = recommended(sections).first else { return nil }
        return Hero(
            deckID: deck.id,
            label: L10n.homeDeckSize,
            count: deck.cardCount,
            name: deck.name,
            action: L10n.studyStart
        )
    }

    private struct Hero {
        let deckID: UUID
        let label: String
        let count: Int
        let name: String
        let action: String
    }

    private func heroCard(_ hero: Hero) -> some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    SectionLabel(hero.label)

                    Text("\(hero.count)")
                        .font(DesignTokens.Typography.heroNumber)
                        .monospacedDigit()
                        // The number moves rather than being replaced when a
                        // session changes it.
                        .contentTransition(.numericText())
                        .foregroundStyle(.white)

                    Text(hero.name)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
                .accessibilityElement(children: .combine)

                Button(hero.action) { onOpenDeck(hero.deckID) }
                    .buttonStyle(PrimaryActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.homeContinue)
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
