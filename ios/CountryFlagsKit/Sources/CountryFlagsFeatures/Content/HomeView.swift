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
    private let onOpenDeck: (UUID) -> Void
    private let onContinueSession: ((ContinuableSession) -> Void)?
    private let onStartStudy:
        ((UUID, StudySessionSize, StudyAnswerMode, StudySessionComposition) -> Void)?

    /// The counts behind the hero. Built here, once, from the factory: this
    /// view is re-initialised whenever the launch makes progress, and a store
    /// built in the initialiser would be built — and thrown away — every time.
    @State private var progress: ProgressStore?
    private let makeProgress: (() -> ProgressStore)?

    public init(
        store: ContentStore,
        sync: SyncCenter,
        makeProgress: (() -> ProgressStore)? = nil,
        onOpenDeck: @escaping (UUID) -> Void,
        onContinueSession: ((ContinuableSession) -> Void)? = nil,
        onStartStudy: (
            (UUID, StudySessionSize, StudyAnswerMode, StudySessionComposition) -> Void
        )? = nil
    ) {
        self.store = store
        self.sync = sync
        self.makeProgress = makeProgress
        self.onOpenDeck = onOpenDeck
        self.onContinueSession = onContinueSession
        self.onStartStudy = onStartStudy
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
            // A sync run finishing is the moment the canonical numbers land in
            // the store — pull them onto the screen instead of waiting for the
            // learner to leave and come back.
            .task(id: sync.status) {
                if progress == nil { progress = makeProgress?() }
                await progress?.load()
            }
            // Coming back is the other moment both numbers change: a session
            // queues work and answers cards while this screen is covered, and
            // nothing above re-reads on a pop. The root of a navigation stack
            // reappears when the pushed screen leaves, so this is the return
            // path — and the first appearance, which is harmless: both reads
            // are cheap and idempotent.
            .onAppear {
                if progress == nil { progress = makeProgress?() }
                Task {
                    await sync.refreshStatus()
                    await progress?.load()
                }
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

            // Until the numbers arrive the hero holds its shape rather than
            // showing the fallback: a screen that says "start the deck" for a
            // beat and then corrects itself into "continue" reads as a glitch,
            // and this screen opens the app every single time.
            if isAwaitingProgress {
                SkeletonBlock(height: DesignTokens.Layout.heroPlaceholderHeight)
                SkeletonBlock()
            } else {
                if let hero = hero(sections) {
                    heroCard(hero)
                }

                dueSection
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
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(AccessibilityIdentifier.homeDeckRow(deck.code))
                    }
                }
            }
        }
    }

    /// Whether the hero's numbers are still being read. Without a factory
    /// there will never be numbers, and waiting for them would hold the
    /// skeleton forever.
    private var isAwaitingProgress: Bool {
        makeProgress != nil && !(progress?.isLoaded ?? false)
    }

    /// The repeat queue, deck by deck — and an honest zero.
    ///
    /// The hero names only the biggest debt, and an unfinished session
    /// displaces it entirely; this is the place the whole queue is always
    /// visible. With nothing due the section says so instead of vanishing:
    /// an absent number reads as a screen that lost it, not as a day done.
    /// Nothing studied yet is different — the queue does not exist, and a
    /// zero would be noise under a hero that says "start".
    @ViewBuilder
    private var dueSection: some View {
        if let progress, progress.isLoaded, !progress.hasNoProgress {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                SectionLabel(L10n.homeDue)

                let due = progress.decks.filter { $0.dueCards > 0 }
                    .sorted { $0.dueCards > $1.dueCards }
                if due.isEmpty {
                    Text(L10n.homeDueEmpty)
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(.white.opacity(0.6))
                        .accessibilityIdentifier(AccessibilityIdentifier.homeDueEmpty)
                } else {
                    ForEach(due) { deck in
                        Button {
                            startDueSession(deckID: deck.id, dueCount: deck.dueCards)
                        } label: {
                            GlassCard(padding: DesignTokens.Spacing.medium) {
                                HStack(
                                    alignment: .firstTextBaseline,
                                    spacing: DesignTokens.Spacing.small
                                ) {
                                    Text(deck.name)
                                        .font(DesignTokens.Typography.sectionTitle)
                                        .foregroundStyle(.white)
                                    Spacer(minLength: DesignTokens.Spacing.small)
                                    Text("\(deck.dueCards)")
                                        .font(DesignTokens.Typography.sectionTitle)
                                        .monospacedDigit()
                                        .contentTransition(.numericText())
                                        .foregroundStyle(.white.opacity(0.7))

                                    // The region's own landmass, from the same
                                    // geodata the maps draw — a place mark, not
                                    // an icon set.
                                    ContinentSilhouetteView(code: deck.code)
                                        .frame(
                                            width: DesignTokens.Layout.minimumTouchTarget,
                                            height: DesignTokens.Layout.minimumTouchTarget * 0.75
                                        )
                                }
                            }
                            // The whole pane answers, not just its words.
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(
                            "\(deck.name), \(L10n.homeDueCount(deck.dueCards))"
                        )
                        .accessibilityIdentifier(AccessibilityIdentifier.homeDueRow(deck.code))
                    }
                }
            }
        }
    }

    /// The number and the deck it belongs to.
    ///
    /// A session somebody walked away from wins over everything: the fastest
    /// way to lose a learner is to let them forget they were in the middle of
    /// something. Then cards waiting to be repeated, then — a new install, a
    /// day already finished — a deck worth opening instead of a zero.
    private func hero(_ sections: [CatalogSection]) -> Hero? {
        if let continuable = progress?.continuable, let onContinueSession {
            return Hero(
                deckID: continuable.deckID,
                label: L10n.homeSessionInProgress,
                count: continuable.answeredCards,
                total: continuable.totalCards,
                name: sections.flatMap(\.decks)
                    .first { $0.id == continuable.deckID }?.name ?? "",
                action: L10n.homeContinue,
                run: { onContinueSession(continuable) }
            )
        }
        if let due = progress?.decks.filter({ $0.dueCards > 0 })
            .max(by: { $0.dueCards < $1.dueCards }) {
            return Hero(
                deckID: due.id,
                label: L10n.homeDue,
                count: due.dueCards,
                total: nil,
                name: due.name,
                action: L10n.homeContinue,
                run: { startDueSession(deckID: due.id, dueCount: due.dueCards) }
            )
        }
        guard let deck = recommended(sections).first else { return nil }
        return Hero(
            deckID: deck.id,
            label: L10n.homeDeckSize,
            count: deck.cardCount,
            total: nil,
            name: deck.name,
            action: L10n.studyStart,
            run: nil
        )
    }

    private struct Hero {
        let deckID: UUID
        let label: String
        let count: Int
        /// Present when the number is a position in something — "4 / 10" —
        /// rather than a quantity.
        let total: Int?
        let name: String
        let action: String
        /// What the button does instead of opening the deck, when the offer
        /// is more specific than a deck.
        let run: (() -> Void)?
    }

    private func heroCard(_ hero: Hero) -> some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    SectionLabel(hero.label)

                    HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.extraSmall) {
                        Text("\(hero.count)")
                            .font(DesignTokens.Typography.heroNumber)
                            .monospacedDigit()
                            // The number moves rather than being replaced when
                            // a session changes it.
                            .contentTransition(.numericText())
                        if let total = hero.total {
                            Text("/ \(total)")
                                .font(DesignTokens.Typography.sectionTitle)
                                .foregroundStyle(.white.opacity(0.55))
                        }
                    }
                    .foregroundStyle(.white)

                    Text(hero.name)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
                .accessibilityElement(children: .combine)

                Button(hero.action) {
                    if let run = hero.run { run() } else { onOpenDeck(hero.deckID) }
                }
                    .buttonStyle(PrimaryActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.homeContinue)
            }
        }
    }

    /// Straight into the run: what is due is already decided, and a screen
    /// asking how many cards to study stands between the learner and cards
    /// the schedule has picked. The session honours the stored size setting,
    /// the same one the deck screen reads, and the selection puts the due
    /// cards first on its own.
    private func startDueSession(deckID: UUID, dueCount: Int) {
        guard let onStartStudy else {
            onOpenDeck(deckID)
            return
        }
        // The queue is what was asked for, and the backend decides how big
        // that is: DUE_ONLY returns the due cards and nothing else, however
        // few. The size is only the contract's cap on one sitting.
        onStartStudy(deckID, .twenty, .selfRated, .dueOnly)
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
