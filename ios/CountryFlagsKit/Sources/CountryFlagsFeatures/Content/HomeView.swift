import SwiftUI

import CountryFlagsDomain

/// The first screen.
///
/// One pane holds the whole of today — the repeat queue's number, a fan of
/// the flags waiting in it, the one action, and the unfinished session as a
/// quiet line inside rather than a second hero. Under it, the queue deck by
/// deck, each row carrying its own flags and its continent. Nothing on the
/// screen is a caption for something absent: every section shows a number or
/// a picture, or it does not appear.
public struct HomeView: View {
    private let store: ContentStore
    private let sync: SyncCenter
    private let assets: (any AssetLoading)?
    private let onOpenDeck: (UUID) -> Void
    private let onContinueSession: ((ContinuableSession) -> Void)?
    private let onStartStudy:
        ((UUID, StudySessionSize, StudyAnswerMode, StudySessionComposition) -> Void)?

    /// The counts behind the hero. Built here, once, from the factory: this
    /// view is re-initialised whenever the launch makes progress, and a store
    /// built in the initialiser would be built — and thrown away — every time.
    @State private var progress: ProgressStore?
    private let makeProgress: (() -> ProgressStore)?
    /// The flags shown fanned in the today pane and beside each queue row,
    /// keyed by deck. Read alongside the counts and for the same reason: the
    /// rows should show the cards they are talking about.
    @State private var previews: [UUID: [LearningCardRecord]] = [:]
    @State private var fanCards: [LearningCardRecord] = []

    public init(
        store: ContentStore,
        sync: SyncCenter,
        assets: (any AssetLoading)? = nil,
        makeProgress: (() -> ProgressStore)? = nil,
        onOpenDeck: @escaping (UUID) -> Void,
        onContinueSession: ((ContinuableSession) -> Void)? = nil,
        onStartStudy: (
            (UUID, StudySessionSize, StudyAnswerMode, StudySessionComposition) -> Void
        )? = nil
    ) {
        self.store = store
        self.sync = sync
        self.assets = assets
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
                await reloadPreviews()
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
                    await reloadPreviews()
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
            // Both explain themselves only when they have something to say; a
            // healthy device up to date shows neither.
            if sync.status.isWorthReporting {
                SyncStatusLine(status: sync.status)
            }
            if isStale || failure != nil {
                ContentStatusBanner(isStale: isStale, failure: failure)
            }

            // Until the numbers arrive the pane holds its shape rather than
            // showing the fallback: a screen that says "start the deck" for a
            // beat and then corrects itself into "review" reads as a glitch,
            // and this screen opens the app every single time.
            if isAwaitingProgress {
                SkeletonBlock(height: DesignTokens.Layout.heroPlaceholderHeight)
                SkeletonBlock()
            } else {
                todayPane(sections)
                queuePane(sections)
            }
        }
    }

    /// Whether the pane's numbers are still being read. Without a factory
    /// there will never be numbers, and waiting for them would hold the
    /// skeleton forever.
    private var isAwaitingProgress: Bool {
        makeProgress != nil && !(progress?.isLoaded ?? false)
    }

    // MARK: - Today

    /// The whole of today in one pane: what the schedule owes, the flags it
    /// owes it in, the one action — and the unfinished session as a line
    /// inside, not a second hero fighting the first.
    @ViewBuilder
    private func todayPane(_ sections: [CatalogSection]) -> some View {
        let due = totalDue(sections)
        let continuable = progress?.continuable

        if due > 0, let deckID = dueLaunchDeckID(sections) {
            pane(
                label: L10n.homeDueToday,
                count: due,
                total: nil,
                caption: nil,
                action: L10n.homeReview,
                identifier: AccessibilityIdentifier.homeContinue,
                run: { startDueSession(deckID: deckID, dueCount: due) },
                continuable: continuable
            )
        } else if let continuable {
            pane(
                label: L10n.homeSessionInProgress,
                count: continuable.answeredCards,
                total: continuable.totalCards,
                caption: deckName(continuable.deckID, in: sections),
                action: L10n.homeContinue,
                identifier: AccessibilityIdentifier.homeContinue,
                run: { onContinueSession?(continuable) },
                continuable: nil
            )
        } else if let deck = recommended(sections) {
            // A fresh install, or a day already finished: a deck worth opening
            // instead of a zero, which says nothing and looks like a screen
            // that failed to load.
            pane(
                label: L10n.homeDeckSize,
                count: deck.cardCount,
                total: nil,
                caption: deck.name,
                action: L10n.studyStart,
                identifier: AccessibilityIdentifier.homeDeckRow(deck.code),
                run: { onOpenDeck(deck.id) },
                continuable: nil
            )
        }
    }

    private func pane(
        label: String,
        count: Int,
        total: Int?,
        caption: String?,
        action: String,
        identifier: String,
        run: @escaping () -> Void,
        continuable: ContinuableSession?
    ) -> some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    SectionLabel(label)

                    HStack(alignment: .center, spacing: DesignTokens.Spacing.medium) {
                        HStack(
                            alignment: .firstTextBaseline,
                            spacing: DesignTokens.Spacing.extraSmall
                        ) {
                            Text("\(count)")
                                .font(DesignTokens.Typography.heroNumber)
                                .monospacedDigit()
                                // The number moves rather than being replaced
                                // when a session changes it.
                                .contentTransition(.numericText())
                            if let total {
                                Text("/ \(total)")
                                    .font(DesignTokens.Typography.sectionTitle)
                                    .foregroundStyle(.white.opacity(0.55))
                            }
                        }
                        .foregroundStyle(.white)

                        Spacer(minLength: 0)

                        // The cards the number is counting, as a small pile of
                        // themselves.
                        if !fanCards.isEmpty {
                            FlagFanView(cards: fanCards, store: store, assets: assets)
                        }
                    }

                    if let caption {
                        Text(caption)
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.6))
                    }
                }
                .accessibilityElement(children: .combine)

                Button(action, action: run)
                    .buttonStyle(PrimaryActionStyle())
                    .accessibilityIdentifier(identifier)

                if let continuable {
                    Button {
                        onContinueSession?(continuable)
                    } label: {
                        HStack(spacing: DesignTokens.Spacing.extraSmall) {
                            Text(L10n.homeSessionInProgress)
                                .foregroundStyle(.white.opacity(0.65))
                            Text(
                                verbatim:
                                    "\(continuable.answeredCards) / \(continuable.totalCards)"
                            )
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            Spacer(minLength: DesignTokens.Spacing.small)
                            Text(L10n.homeContinue)
                                .foregroundStyle(.white)
                                .fontWeight(.semibold)
                            Image(systemName: "chevron.right")
                                .foregroundStyle(.white.opacity(0.5))
                        }
                        .font(DesignTokens.Typography.caption)
                        .padding(.horizontal, DesignTokens.Spacing.medium)
                        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget * 0.85)
                        .background(
                            .white.opacity(0.06),
                            in: RoundedRectangle(
                                cornerRadius: DesignTokens.Radius.medium, style: .continuous
                            )
                        )
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - The queue, deck by deck

    @ViewBuilder
    private func queuePane(_ sections: [CatalogSection]) -> some View {
        if let progress, progress.isLoaded {
            // Regions only: the curated deck spans every card, so its row
            // would restate the pane above it in different words.
            let curated = Set((sections.first { $0.kind == .curated }?.decks ?? []).map(\.id))
            let due = progress.decks.filter { $0.dueCards > 0 && !curated.contains($0.id) }
                .sorted { $0.dueCards > $1.dueCards }
            if !due.isEmpty {
                GlassCard(padding: DesignTokens.Spacing.small) {
                    VStack(spacing: 0) {
                        ForEach(Array(due.enumerated()), id: \.element.id) { index, deck in
                            if index > 0 {
                                Divider()
                                    .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                            }
                            Button {
                                startDueSession(deckID: deck.id, dueCount: deck.dueCards)
                            } label: {
                                queueRow(deck)
                            }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel(
                                "\(deck.name), \(L10n.homeDueCount(deck.dueCards))"
                            )
                            .accessibilityIdentifier(
                                AccessibilityIdentifier.homeDueRow(deck.code)
                            )
                        }
                    }
                }
            }
        }
    }

    private func queueRow(_ deck: DeckProgressRow) -> some View {
        HStack(spacing: DesignTokens.Spacing.small) {
            // The cards this row is counting: the queue stops being a list of
            // words about pictures somewhere else.
            HStack(spacing: 3) {
                ForEach(previews[deck.id] ?? [], id: \.id) { card in
                    MiniFlagView(card: card, store: store, assets: assets)
                }
            }

            Text(deck.name)
                .font(DesignTokens.Typography.sectionTitle)
                .foregroundStyle(.white)
                .lineLimit(1)

            Spacer(minLength: DesignTokens.Spacing.small)

            Text("\(deck.dueCards)")
                .font(DesignTokens.Typography.sectionTitle)
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(.white.opacity(0.7))

            ContinentSilhouetteView(code: deck.code)
                .frame(
                    width: DesignTokens.Layout.minimumTouchTarget * 0.9,
                    height: DesignTokens.Layout.minimumTouchTarget * 0.65
                )
        }
        .padding(.horizontal, DesignTokens.Spacing.small)
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
        .contentShape(.rect)
    }

    // MARK: - Data

    /// What the schedule owes, counted once. The decks overlap — the curated
    /// deck holds every card the regions hold — so summing rows double-counts;
    /// the curated deck's own queue is the whole queue, and without one the
    /// largest region stands in.
    private func totalDue(_ sections: [CatalogSection]) -> Int {
        guard let progress else { return 0 }
        if let all = recommended(sections),
            let row = progress.decks.first(where: { $0.id == all.id })
        {
            return row.dueCards
        }
        return progress.decks.map(\.dueCards).max() ?? 0
    }

    /// The deck a "review everything" tap studies: the curated deck holds
    /// every card, so its due queue is the whole queue. Without one, the deck
    /// owing the most.
    private func dueLaunchDeckID(_ sections: [CatalogSection]) -> UUID? {
        recommended(sections)?.id
            ?? progress?.decks.filter { $0.dueCards > 0 }
                .max { $0.dueCards < $1.dueCards }?.id
    }

    private func deckName(_ id: UUID, in sections: [CatalogSection]) -> String? {
        sections.flatMap(\.decks).first { $0.id == id }?.name
    }

    /// The curated deck is what the product recommends; the taxonomy ones are
    /// a way to browse rather than a suggestion. Falling back to whatever
    /// exists keeps the pane from being empty on a release that publishes no
    /// curated deck at all.
    private func recommended(_ sections: [CatalogSection]) -> DeckRecord? {
        (sections.first { $0.kind == .curated }?.decks ?? sections.flatMap(\.decks)).first
    }

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

    /// Reads the flags the pane and the rows show. Due cards first, so the
    /// fan shows what the number counts; a fresh install fans the deck it is
    /// offered instead.
    private func reloadPreviews() async {
        guard let progress, progress.isLoaded else { return }
        let states = await progress.cardStatesByID()
        let now = Date()

        var fresh: [UUID: [LearningCardRecord]] = [:]
        for deck in progress.decks where deck.dueCards > 0 {
            let cards = await store.cards(inDeck: deck.id)
            fresh[deck.id] = Array(
                cards.filter { card in
                    guard let state = states[card.id] else { return false }
                    return state.state != "NEW" && state.dueAt <= now
                }
                .prefix(3)
            )
        }
        previews = fresh

        if let top = progress.decks.filter({ $0.dueCards > 0 })
            .max(by: { $0.dueCards < $1.dueCards }),
            let cards = fresh[top.id], !cards.isEmpty
        {
            fanCards = cards
        } else if case .ready(let sections, _, _) = store.catalog,
            let deck = recommended(sections)
        {
            fanCards = Array(await store.cards(inDeck: deck.id).prefix(3))
        }
    }
}

/// Three cards of a deck, thrown the way the study pile lies.
struct FlagFanView: View {
    let cards: [LearningCardRecord]
    let store: ContentStore
    let assets: (any AssetLoading)?

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        if let assets {
            ZStack {
                ForEach(
                    Array(cards.prefix(3).enumerated().reversed()), id: \.element.id
                ) { index, card in
                    FlagImageView(
                        assetID: card.promptAssetID,
                        accessibilityLabel: card.displayName,
                        store: store,
                        assets: assets
                    )
                    .frame(width: Self.size.width, height: Self.size.height)
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
                    .shadow(color: .black.opacity(0.35), radius: 5, y: 2)
                    .rotationEffect(.degrees(Self.poses[index].rotation))
                    .offset(x: Self.poses[index].x, y: Self.poses[index].y)
                }
            }
            .frame(width: 120, height: 74)
            .accessibilityHidden(true)
        }
    }

    private static let size = CGSize(width: 76, height: 57)
    private static let poses: [(rotation: Double, x: CGFloat, y: CGFloat)] = [
        (-2, 0, 0),
        (-10, -20, 3),
        (8, 20, 5),
    ]
}

/// One flag at row height: enough to be recognised beside its count.
struct MiniFlagView: View {
    let card: LearningCardRecord
    let store: ContentStore
    let assets: (any AssetLoading)?

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        if let assets {
            FlagImageView(
                assetID: card.promptAssetID,
                accessibilityLabel: card.displayName,
                store: store,
                assets: assets
            )
            .frame(width: 24, height: 18)
            .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .strokeBorder(
                        .white.opacity(DesignTokens.Card.borderOpacity),
                        lineWidth: 1 / displayScale
                    )
            }
            .accessibilityHidden(true)
        }
    }
}
