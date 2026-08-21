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
    /// The way to the catalog, for the screen that has nothing to review: the
    /// offer to pick a new set of countries has to lead somewhere.
    private let onOpenCatalog: (() -> Void)?
    private let onStartStudy:
        ((UUID, StudySessionSize, StudyAnswerMode, StudySessionComposition) -> Void)?
    /// The stored session size, read when a due session starts: the cap on
    /// one sitting is the learner's, the same setting every other entry
    /// point honours.
    private let makeSettings: (() -> SettingsStore)?

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
    @Environment(\.scenePhase) private var scenePhase

    /// How old the catalogue may be before coming back to the app refreshes it.
    ///
    /// Ten minutes is short enough that an hour away never shows yesterday's
    /// queue, and long enough that putting the phone down to answer the door
    /// costs nothing. The counts themselves are recomputed on every return
    /// whatever this says — they are local arithmetic over a clock that has
    /// moved, and cards fall due while nobody is looking.
    private static let staleAfter: TimeInterval = 600

    public init(
        store: ContentStore,
        sync: SyncCenter,
        assets: (any AssetLoading)? = nil,
        makeProgress: (() -> ProgressStore)? = nil,
        makeSettings: (() -> SettingsStore)? = nil,
        onOpenDeck: @escaping (UUID) -> Void,
        onContinueSession: ((ContinuableSession) -> Void)? = nil,
        onOpenCatalog: (() -> Void)? = nil,
        onStartStudy: (
            (UUID, StudySessionSize, StudyAnswerMode, StudySessionComposition) -> Void
        )? = nil
    ) {
        self.store = store
        self.sync = sync
        self.assets = assets
        self.makeProgress = makeProgress
        self.makeSettings = makeSettings
        self.onOpenDeck = onOpenDeck
        self.onContinueSession = onContinueSession
        self.onOpenCatalog = onOpenCatalog
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
            // Coming back from the background is the third moment the numbers
            // change, and the only one nothing was watching. A view that never
            // disappeared gets no `onAppear`, and a sync that finishes in the
            // same state it started in changes no value to key a task on — so
            // an hour in a pocket used to leave yesterday's queue on screen.
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task {
                    await store.refreshIfStale(olderThan: Self.staleAfter)
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

    /// Whether the pane's numbers are still being read.
    ///
    /// Two things have to land before a number is worth showing: the local
    /// counts, and the first catalogue sync of the launch. The stored
    /// catalogue answers instantly and can be a day old, so painting its
    /// numbers first and correcting them a second later is exactly the flicker
    /// this screen is read through — the reader sees a figure, believes it,
    /// and watches it change.
    ///
    /// Neither wait is unbounded. Without a progress factory there will never
    /// be counts, and a sync that fails or finds no network settles into a
    /// phase that is not `syncing`, so the screen always arrives somewhere.
    private var isAwaitingProgress: Bool {
        if makeProgress != nil, !(progress?.isLoaded ?? false) { return true }
        return store.lastSyncedAt == nil && store.status.phase != .idle
    }

    // MARK: - Today

    /// The whole of today in one pane: what the schedule owes, the flags it
    /// owes it in, the one action — and the unfinished session as a line
    /// inside, not a second hero fighting the first.
    @ViewBuilder
    private func todayPane(_ sections: [CatalogSection]) -> some View {
        let due = totalDue(sections)
        let continuable = progress?.continuable

        // Its own row, above the day's pane: an unfinished sitting is a
        // different thing from a queue — one is a place to go back to, the
        // other is work to start. As a second full pane it competed with the
        // day; as a line with a bar it is a door, which is all it ever was.
        if let continuable {
            ResumeTrainingRow(
                deckName: deckName(continuable.deckID, in: sections) ?? "",
                answered: continuable.answeredCards,
                total: continuable.totalCards,
                action: { onContinueSession?(continuable) }
            )
        }

        if due > 0, let deckID = dueLaunchDeckID(sections) {
            pane(
                label: L10n.homeDueToday,
                count: due,
                total: nil,
                caption: dueBreakdown,
                action: L10n.homeReview,
                identifier: AccessibilityIdentifier.homeReview,
                run: { startDueSession(deckID: deckID) }
            )
        } else if continuable != nil {
            // The queue is empty and the sitting above is the whole of today:
            // neither the celebration nor a deck to start belongs under it.
            EmptyView()
        } else if let deck = recommended(sections) {
            // A day already finished says so — a learner with real progress
            // who cleared the queue must not see the fresh-install pane and
            // wonder where their day went. Clearing the queue is the whole
            // point of the app, so the screen says it like something that was
            // achieved, and shows what it added up to.
            if hasAnyProgress {
                DayClearedCard(
                    learned: learnedCountries,
                    inProgress: countriesInProgress,
                    onOpenCatalog: onOpenCatalog
                )
            }
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
                run: { onOpenDeck(deck.id) }
            )
        }
    }

    /// Whether the learner has ever answered anything: what separates a
    /// cleared queue from a fresh install.
    private var hasAnyProgress: Bool {
        progress?.decks.contains { $0.startedCards > 0 } ?? false
    }

    /// Countries carried all the way to learned, and countries under way.
    ///
    /// Summed over the curated decks alone: those partition the world once,
    /// while a country can also sit in any number of themed decks, and adding
    /// those in would count the same flag several times and show a learner
    /// more countries than there are.
    private var learnedCountries: Int {
        curatedDecks.reduce(0) { $0 + $1.learnedCards }
    }

    private var countriesInProgress: Int {
        curatedDecks.reduce(0) { $0 + max(0, $1.startedCards - $1.learnedCards) }
    }

    // Both read the deck rows, and the rows are the backend's own counts
    // whenever the backend has the facts — `ProgressStore` decides that once,
    // for every screen, rather than each of them deciding again.

    private var curatedDecks: [DeckProgressRow] {
        (progress?.decks ?? []).filter(\.isCurated)
    }

    /// What kind of work the number above is: overdue, still being learned,
    /// never seen. The backend counts it — a card this device has never been
    /// shown has no local state to be counted in — so the line appears only
    /// when a recent count arrived, and is simply absent otherwise.
    ///
    /// Learning and relearning are added together: the difference between a
    /// card being learned and one being learned again is the scheduler's
    /// business, and naming both would explain the algorithm rather than the
    /// day.
    private var dueBreakdown: String? {
        guard let summary = progress?.dueSummary, summary.totalDue > 0 else { return nil }
        var parts: [String] = []
        if summary.overdue > 0 { parts.append(L10n.homeDueOverdue(summary.overdue)) }
        let inLearning = summary.learning + summary.relearning
        if inLearning > 0 { parts.append(L10n.homeDueLearning(inLearning)) }
        if summary.newCards > 0 { parts.append(L10n.homeDueNew(summary.newCards)) }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: " · ")
    }

    private func pane(
        label: String,
        count: Int,
        total: Int?,
        caption: String?,
        action: String,
        identifier: String,
        run: @escaping () -> Void,
        showsFan: Bool = true
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
                        // themselves. Only where the number is the queue: the
                        // fan is drawn from the due cards and would be a lie
                        // beside a session's answered count.
                        if showsFan, !fanCards.isEmpty {
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
                                startDueSession(deckID: deck.id)
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
    /// How many cards the day owes.
    ///
    /// The backend's number when the backend has the facts, and the device's
    /// only when it does not. One authority at a time, decided by one
    /// question: is this device holding answers it has not sent?
    ///
    /// That question is the whole of it. The backend counts what it has
    /// received; while something waits in the outbox it is counting an older
    /// world, and the device is the one that knows. Once the outbox is empty
    /// the backend has seen every answer from every device — including the
    /// ones this phone never made — so its number is the one that can be
    /// right, and the session opened from this pane is composed from the same
    /// place.
    private func totalDue(_ sections: [CatalogSection]) -> Int {
        guard let progress else { return 0 }
        if let summary = progress.dueSummary, !hasUnsentAnswers {
            return summary.totalDue
        }
        if let all = recommended(sections),
            let row = progress.decks.first(where: { $0.id == all.id })
        {
            return row.dueCards
        }
        return progress.decks.map(\.dueCards).max() ?? 0
    }

    /// Whether this device is ahead of the backend.
    private var hasUnsentAnswers: Bool { sync.status.pendingCount > 0 }

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

    private func startDueSession(deckID: UUID) {
        guard let onStartStudy else {
            onOpenDeck(deckID)
            return
        }
        Task {
            // The queue is what was asked for: DUE_ONLY returns the due
            // cards and nothing else, however few. The cap on one sitting
            // is the learner's stored size — the same setting the deck
            // screens read — not a number of this screen's own.
            var size = StudySessionSize.ten
            if let makeSettings {
                let settings = makeSettings()
                await settings.load()
                size = StudySessionSize(storedValue: settings.settings.sessionSize)
            }
            onStartStudy(deckID, size, .selfRated, .dueOnly)
        }
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
            // Lazy, so the scan stops at the third match instead of testing
            // the whole deck for three flags.
            fresh[deck.id] = Array(
                cards.lazy.filter { card in
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
