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

    /// The counts behind the hero. The app's one progress store, observed
    /// rather than owned: the same numbers appear on four screens, and a
    /// screen holding its own copy is how they came to disagree.
    private let progress: ProgressStore?
    /// Whether the numbers on screen are known to be the previous word —
    /// after a sitting, or before the launch's own run has come back.
    ///
    /// The shell owns both windows, because that is where a session closes
    /// and where the launch run is started; a screen that tried to infer them
    /// was looking after they had already closed.
    private let isSettling: Bool
    /// The flags shown fanned in the today pane and beside each queue row,
    /// keyed by deck. Read alongside the counts and for the same reason: the
    /// rows should show the cards they are talking about.
    @State private var previews: [UUID: [LearningCardRecord]] = [:]
    @State private var fanCards: [LearningCardRecord] = []

    public init(
        store: ContentStore,
        sync: SyncCenter,
        assets: (any AssetLoading)? = nil,
        progress: ProgressStore? = nil,
        isSettling: Bool = false,
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
        self.progress = progress
        self.isSettling = isSettling
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
                // The gesture waits for the numbers, which is what this screen
                // shows. The catalogue catches up alongside it and lands when
                // it lands: a newly published release is applied deck by deck,
                // and holding the spinner for that turned a pull into a wait
                // as long as a whole catalogue.
                store.catchUp()
                // Pull-to-refresh goes through the same boundary as every other
                // trigger, so two of them cannot race into a double submission.
                await sync.synchronize(trigger: .pullToRefresh)
            }
            .task { await store.start() }
            // The one thing this screen still reads for itself: which flags to
            // fan, which is a view concern and depends on the deck rows it
            // just received. Everything else — the counts, the queue, the
            // unfinished session — is refreshed centrally after a sync run,
            // and this screen simply observes the store it is refreshed into.
            .task(id: progress?.decks) { await reloadPreviews() }
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
            // The sync state moved to the header, where it sits between the
            // avatar and the gear; this one explains itself only when it has
            // something to say.
            if isStale || failure != nil {
                ContentStatusBanner(isStale: isStale, failure: failure)
            }

            // Until the backend's numbers arrive the pane says it is loading,
            // in plain words with a spinner — not skeleton shapes pretending
            // to be content, and not the local projection's figures either:
            // the owner's call is that a number on this screen is the
            // backend's number or nothing.
            if isAwaitingProgress || isSettling {
                homeLoader
            } else {
                // Dimmed while the numbers are being checked: the figure stays
                // readable and stops claiming to be settled.
                //
                // And not tappable while it is dimmed, so a queue that is
                // about to change cannot be walked into.
                VStack(spacing: DesignTokens.Spacing.large) {
                    todayPane(sections)
                    queuePane(sections)
                }
                .opacity(isVerifying ? 0.55 : 1)
                .disabled(isVerifying)
                .animation(.easeInOut(duration: 0.2), value: isVerifying)
            }
        }
    }

    /// One spinner in the hero's place. The height is the hero's, so the
    /// queue below does not jump when the numbers land.
    private var homeLoader: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            ProgressView()
                .controlSize(.large)
                .tint(.white)
            Text(L10n.homeLoading)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
        .frame(height: DesignTokens.Layout.heroPlaceholderHeight)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.homeLoading)
    }

    /// Whether the pane has no numbers it is allowed to draw yet.
    ///
    /// The backend is the only source of truth for an account's counts
    /// (ADR-016), so an account whose counts have never arrived waits rather
    /// than showing a local guess that would change the moment the real one
    /// landed. A guest is never waiting: nobody else is counting their work.
    private var isAwaitingProgress: Bool {
        guard let progress else {
            return store.lastSyncedAt == nil && store.status.phase != .idle
        }
        return progress.origin == .awaitingBackend
    }

    /// Whether the numbers on screen are being checked right now. They stay
    /// up — a figure being verified says more than a spinner — but they say
    /// so, which is what the screen used to hide.
    ///
    /// A run in flight counts: between finishing a session and the run that
    /// carries its answers home, what is on screen is the backend's previous
    /// word, and the screen should not present it as settled.
    private var isVerifying: Bool {
        if sync.status.phase == .syncing { return true }
        return progress?.isRefreshing ?? false
    }

    /// Whether what is on screen is known to be behind rather than merely
    /// being checked.
    ///
    /// Leaving a sitting, the answers are still on their way up, so the
    /// counts under them are the backend's previous word — not a figure to
    /// dim and keep, but one that is about to change. The screen spins in its
    /// place rather than showing a number it already knows is stale.
    ///
    /// A routine check with nothing waiting keeps its numbers and dims them:
    /// a figure being verified says more than a spinner.

    // MARK: - Today

    /// The whole of today in one pane: what the schedule owes, the flags it
    /// owes it in, the one action — and the unfinished session as a line
    /// inside, not a second hero fighting the first.
    @ViewBuilder
    private func todayPane(_ sections: [CatalogSection]) -> some View {
        let due = totalDue
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

        // The review block, always. An unfinished sitting used to stand in
        // for the whole of today and suppress everything under it — leaving
        // a deck mid-session collapsed this screen to a lone resume row.
        // Each block now stands on its own: the queue when the schedule owes
        // anything, the day's tally otherwise.
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
        } else if hasAnyProgress {
            // A day already finished says so — a learner with real progress
            // who cleared the queue must not see the fresh-install pane and
            // wonder where their day went.
            DayClearedCard(
                learned: learnedCountries,
                inProgress: countriesInProgress,
                onOpenCatalog: onOpenCatalog
            )
        }

        // The all-countries deck, when the day asks nothing: a queue pane
        // and a deck pane together were two heroes fighting for the same
        // tap, so the deck yields whenever something is due. It leads with
        // its own name — "All countries" is what the block is, and the count
        // is the detail under it, not the headline.
        if due == 0, let deck = recommended(sections) {
            pane(
                label: deck.name,
                count: deck.cardCount,
                total: nil,
                caption: L10n.homeDeckSize,
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

    /// How many cards the day owes, asked of the store that owns the answer.
    ///
    /// This screen used to work it out itself, from a different reading of
    /// "is the device ahead of the backend" than the store used — two answers
    /// to one question, which is how the hero and the rows beneath it came to
    /// disagree. There is one answer now, and it lives with the numbers.
    private var totalDue: Int { progress?.totalDue ?? 0 }

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
            // The three the session will actually open with, which means the
            // oldest debt first — the same order the queue is filled in.
            // Taking the first three in deck order gave three due cards that
            // were simply alphabetically early, so the fan showed flags the
            // session was not about to ask for and read as a random handful.
            //
            // The whole deck is scanned rather than stopped at the third
            // match: which three are oldest is not known until the due ones
            // have been found.
            fresh[deck.id] = Array(
                cards.filter { card in
                    guard let state = states[card.id] else { return false }
                    return state.state != "NEW" && state.dueAt <= now
                }
                .sorted { left, right in
                    (states[left.id]?.dueAt ?? now) < (states[right.id]?.dueAt ?? now)
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
