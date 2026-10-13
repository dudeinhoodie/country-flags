import SwiftUI

import CountryFlagsDomain

/// The first screen.
///
/// For a guest with work on the phone, the account row comes first of all.
/// Then how far the learner has come — countries known and countries
/// learned — which is also where a finished day says so. Under it one pane
/// holds the whole of today — the repeat queue's number, a fan of the flags
/// waiting in it, the one action, and the unfinished session as a quiet line
/// inside rather than a second hero — or, when the day asks nothing, the
/// all-countries deck with its size. Then the queue deck by deck, each row
/// carrying its own flags and its continent. Nothing on the screen is a
/// caption for something absent: every section shows a number or a picture,
/// or it does not appear.
public struct HomeView: View {
    private let store: ContentStore
    private let sync: SyncCenter
    private let assets: (any AssetLoading)?
    private let onOpenDeck: (UUID) -> Void
    private let onContinueSession: ((ContinuableSession) -> Void)?
    /// The way to the progress tab, from the block that counts the countries.
    /// The two figures there are the short form of that screen, and a summary
    /// that does not open what it summarises leaves the learner to find it.
    private let onOpenProgress: (() -> Void)?
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
    /// Whose phone this is, for the one row that is about the person rather
    /// than the queue. The shell's own store, observed for the same reason
    /// the counts are.
    private let account: AccountStore?
    /// Opens the sign-in screen.
    private let onSignIn: (() -> Void)?
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
    /// Distinct cards answered today, counted off the card states on the
    /// device. It decides one thing: whether the day's allowance is spent.
    @State private var answeredToday = 0
    /// The flag a first visit is asked about, and whether its name is shown.
    @State private var flagOfTheDay: LearningCardRecord?
    @State private var isFlagRevealed = false
    @State private var detailsSubject: CountryDetailsSubject?
    @Environment(\.displayScale) private var displayScale


    /// The placeholder's bars stand in for text, so they grow with it. Drawn
    /// at fixed points they matched the hero at one type size and at no other,
    /// which is the layout breaking at accessibility sizes that the design
    /// language counts as unfinished rather than as a later bug.
    @ScaledMetric(relativeTo: .footnote) private var labelBarHeight: CGFloat = 12
    @ScaledMetric(relativeTo: .largeTitle) private var figureBarHeight: CGFloat = 40

    public init(
        store: ContentStore,
        sync: SyncCenter,
        assets: (any AssetLoading)? = nil,
        progress: ProgressStore? = nil,
        isSettling: Bool = false,
        makeSettings: (() -> SettingsStore)? = nil,
        onOpenDeck: @escaping (UUID) -> Void,
        onContinueSession: ((ContinuableSession) -> Void)? = nil,
        onOpenProgress: (() -> Void)? = nil,
        onStartStudy: (
            (UUID, StudySessionSize, StudyAnswerMode, StudySessionComposition) -> Void
        )? = nil,
        account: AccountStore? = nil,
        onSignIn: (() -> Void)? = nil
    ) {
        self.store = store
        self.sync = sync
        self.assets = assets
        self.progress = progress
        self.account = account
        self.onSignIn = onSignIn
        self.isSettling = isSettling
        self.makeSettings = makeSettings
        self.onOpenDeck = onOpenDeck
        self.onContinueSession = onContinueSession
        self.onOpenProgress = onOpenProgress
        self.onStartStudy = onStartStudy
    }

    public var body: some View {
        content
            .navigationTitle(L10n.homeTitle)
            .refreshable {
                await RefreshGesture.perform {
                    // The gesture waits for the numbers, which is what this
                    // screen shows. The catalogue catches up alongside it and
                    // lands when it lands: a newly published release is
                    // applied deck by deck, and holding the spinner for that
                    // turned a pull into a wait as long as a whole catalogue.
                    store.catchUp()
                    // Pull-to-refresh goes through the same boundary as every
                    // other trigger, so two of them cannot race into a double
                    // submission.
                    await sync.synchronize(trigger: .pullToRefresh)
                }
            }
            .task { await store.start() }
            // The one thing this screen still reads for itself: which flags to
            // fan, which is a view concern and depends on the deck rows it
            // just received. Everything else — the counts, the queue, the
            // unfinished session — is refreshed centrally after a sync run,
            // and this screen simply observes the store it is refreshed into.
            // Keyed on the catalogue as well as on the counts: a launch
            // resolves them in either order, and the first wave needs the
            // flags the moment the catalogue lands rather than whenever the
            // counts happen to follow.
            .task(id: previewInputs) { await reloadPreviews() }
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
            // The guest's account row leads the screen, above everything else
            // in every state it shows in, the wait for the counts included —
            // the owner's decision on 13.10 (#497). It used to stand last,
            // under the day, on the grounds that the first thing on the screen
            // should be what to do next; the owner reversed that. When it
            // appears and how it looks are unchanged.
            //
            // It never shares the top with the expired sign-in below: that one
            // is for an account the backend stopped honouring, this one for a
            // guest, and each checks it is not the other.
            guestPrompt
                .devBlockID("home.account")

            // The sync state moved to the header, where it sits between the
            // avatar and the gear; this one explains itself only when it has
            // something to say.
            if isStale || failure != nil {
                ContentStatusBanner(isStale: isStale, failure: failure)
                    .devBlockID("home.status")
            }

            expiredSignInPrompt
                .devBlockID("home.sign-in-expired")

            // The screen fills in the order its data arrives, which is two
            // waves and not one: the catalogue is already on the device — the
            // decks, the cards and every flag — and only the counts are still
            // coming. So the wait shows what is known and marks what is not,
            // rather than replacing the screen with a single blank shape.
            //
            // Not the local projection's figures, though: a number here is
            // the backend's number or none at all (ADR-016). That half has
            // not moved, and it is why the figure is the one thing the first
            // wave cannot draw.
            //
            // And no longer a spinner. The skeleton was turned down here once
            // as shapes pretending to be content; put side by side, an empty
            // box turning on the spot pretends harder — it says a wait is
            // happening and nothing about what is coming.
            Group {
                if isAwaitingProgress || isSettling {
                    VStack(spacing: DesignTokens.Spacing.large) {
                        homeLoader(sections)
                        queueLoader
                    }
                    .transition(.opacity)
                } else {
                    // Dimmed while the numbers are being checked: the figure
                    // stays readable and stops claiming to be settled.
                    //
                    // And not tappable while it is dimmed, so a queue that is
                    // about to change cannot be walked into.
                    VStack(spacing: DesignTokens.Spacing.large) {
                        // First of the day's blocks, above whichever hero the
                        // day has, with only the account, sign-in and status
                        // rows over it: the owner put how far the learner has
                        // come ahead of what to do next (#497). It is the one
                        // block that is never a zero after the first answer,
                        // so it is what a returning learner reads first; the
                        // hero and its action follow right under it.
                        knownLearnedCard
                            .devBlockID("home.known-learned")
                        todayPane(sections)
                        queuePane(sections)
                            .devBlockID("home.queue")
                        if isFirstVisit {
                            flagOfTheDayCard(sections)
                                .devBlockID("home.flag-of-the-day")
                            regionsShelf(sections)
                                .devBlockID("home.regions")
                        }
                    }
                    .opacity(isVerifying ? 0.55 : 1)
                    .disabled(isVerifying)
                    .animation(.easeInOut(duration: 0.2), value: isVerifying)
                    .transition(.opacity)
                }
            }
            // The shape does not blink out when the numbers land; they arrive
            // into it. Motion reports the state change and nothing else.
            .animation(
                .easeInOut(duration: 0.2),
                value: isAwaitingProgress || isSettling
            )
        }
        .sheet(item: $detailsSubject) { subject in
            if let assets {
                CountryDetailsSheet(subject: subject, store: store, assets: assets)
            }
        }
    }

    /// The hero in its first wave: what the device knows, and a placeholder
    /// where the backend's answer will go.
    ///
    /// The deck's name is real — it comes off the catalogue, which is already
    /// stored. Everything the counts decide waits: the figure, the action,
    /// and the fan, which is blank because a pile of flags beside a number
    /// reads as the cards that number counts.
    ///
    /// Which hero this becomes is not known: a launch has not resolved
    /// whether the day owes anything, so the deck the screen would offer is
    /// what it names meanwhile. The label changes when the answer arrives,
    /// and the cross-fade carries it.
    ///
    /// The height is not pinned to a constant. It used to be, and the
    /// constant did not match what the hero settles at; built from the same
    /// pieces, this is that height.
    private func homeLoader(_ sections: [CatalogSection]) -> some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    if let deck = recommended(sections) {
                        SectionLabel(deck.name)
                    } else {
                        // No catalogue to name yet — the label waits too.
                        SkeletonBlock(height: labelBarHeight, radius: DesignTokens.Radius.small)
                            .frame(width: 132)
                            .accessibilityHidden(true)
                    }

                    HStack(alignment: .center, spacing: DesignTokens.Spacing.medium) {
                        SkeletonBlock(height: figureBarHeight, radius: DesignTokens.Radius.medium)
                            .frame(width: 88)
                            .accessibilityHidden(true)

                        Spacer(minLength: 0)

                        // Blank cards rather than the deck's own flags: the
                        // fan stands beside the number and reads as the cards
                        // that number counts, and until the counts land there
                        // is no queue for it to be about.
                        SkeletonFanView()
                    }

                    // The one line of words on the screen, and the only thing
                    // here VoiceOver has to read.
                    Text(L10n.homeLoading)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                        .accessibilityIdentifier(AccessibilityIdentifier.homeLoading)
                }

                // The action is a capsule, so its placeholder is one too.
                SkeletonBlock(
                    height: DesignTokens.Layout.actionHeight,
                    radius: DesignTokens.Layout.actionHeight / 2
                )
                .accessibilityHidden(true)
            }
        }
    }

    /// The list under the hero, waiting.
    ///
    /// Which regions it will hold is the one thing the catalogue cannot say:
    /// it keeps only the regions that owe something today, and that is the
    /// answer still coming. So the rows carry no names — a named row that
    /// disappeared would read as a fault, where an unnamed one that did is
    /// just a list that came back shorter.
    ///
    /// Four of them. The block is the last thing on the screen, so a list of
    /// any length moves nothing above it; the count is how it looks rather
    /// than how it lays out.
    private var queueLoader: some View {
        GlassCard(padding: DesignTokens.Spacing.small) {
            VStack(spacing: 0) {
                ForEach(Array(Self.loadingRowWidths.enumerated()), id: \.offset) { index, width in
                    if index > 0 {
                        Divider()
                            .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                    }

                    HStack(spacing: DesignTokens.Spacing.small) {
                        // One flag rather than the row's whole handful, and no
                        // continent: the placeholder stands for the row, not
                        // for its ornaments.
                        SkeletonBlock(height: 18, radius: 3)
                            .frame(width: 24)

                        SkeletonBlock(height: labelBarHeight, radius: DesignTokens.Radius.small)
                            .frame(width: width)

                        Spacer(minLength: DesignTokens.Spacing.small)

                        SkeletonBlock(height: labelBarHeight, radius: DesignTokens.Radius.small)
                            .frame(width: 22)
                    }
                    .padding(.horizontal, DesignTokens.Spacing.small)
                    .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                }
            }
        }
        // The block says nothing yet, and the line above it has already said
        // the screen is loading.
        .accessibilityHidden(true)
    }

    /// Varied so the rows read as names rather than as a stack of one bar.
    private static let loadingRowWidths: [CGFloat] = [96, 74, 86, 68]

    /// What the previews are a function of: the catalogue they are drawn
    /// from, and the counts that decide which cards to draw.
    private struct PreviewInputs: Equatable {
        let hasCatalog: Bool
        let decks: [DeckProgressRow]
    }

    private var previewInputs: PreviewInputs {
        if case .ready = store.catalog {
            return PreviewInputs(hasCatalog: true, decks: progress?.decks ?? [])
        }
        return PreviewInputs(hasCatalog: false, decks: progress?.decks ?? [])
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
        // The unfinished sitting leads. It used to be a thin row above a
        // full pane offering a new start, which asked a learner seven cards
        // in whether to begin again; now it comes first, and the deck pane
        // that may stand under it is the other door, not that question.
        if let continuable {
            resumePane(continuable, sections)
                .devBlockID("home.resume")
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
                run: { startDueSession(deckID: deckID) },
                isProminent: continuable == nil
            )
            .devBlockID("home.today")
        }
        // The day's tally is no pane of its own any more: a finished day says
        // so at the top, in the known/learned card (#497). The pane repeated
        // that card's learned figure, and its hour of the next portion was a
        // promise the day could not keep — with the allowance spent, nothing
        // opens at that hour.

        // The all-countries deck, when the day asks nothing: a queue pane
        // and a deck pane together were two heroes fighting for the same
        // tap, so the deck yields whenever something is due. It leads with
        // its own name — "All countries" is what the block is, and the count
        // is the detail under it, not the headline.
        //
        // An open sitting no longer hides it. It used to, on the grounds that
        // "start studying" beside "continue" asked the same question twice;
        // but the two are separate things — one is a place to go back to,
        // the other is the deck itself — and hiding the deck behind a sitting
        // left the learner no way to it from here until the sitting was
        // finished (#497).
        if due == 0, let deck = recommended(sections) {
            deckPane(deck)
                .devBlockID("home.deck")
        }
    }

    /// The all-countries deck as a pane: its name as the title, its size in
    /// a quiet line under it, its flags beside both, and the way in.
    ///
    /// No figure and no section label (#497). The pane said "0 / 195 стран
    /// выучено", the learner's standing out of the deck, which could not
    /// move on the first day however much was studied; then, briefly, the
    /// deck's size as a counter, "195" over "флагов", which was turned down
    /// as well. The standing is the card at the top now. This pane is about
    /// the deck: it names it in a card heading's face, the one the first
    /// visit's flag is named in, and says how big it is the way the regions
    /// shelf does.
    ///
    /// Its own pane rather than `pane(...)`, which is built around a figure.
    ///
    /// The action is always the white one, the "continue" beside it
    /// included: the one place two white actions share the screen, decided
    /// by the owner on #497. Each pane is a door of its own, offered at full
    /// weight.
    private func deckPane(_ deck: DeckRecord) -> some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                HStack(alignment: .center, spacing: DesignTokens.Spacing.medium) {
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                        Text(deck.name)
                            .font(DesignTokens.Typography.cardAnswer)
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(L10n.deckItemCount(deck.cardCount, contentKinds: deck.contentKinds))
                            .font(DesignTokens.Typography.body)
                            .foregroundStyle(.white.opacity(0.6))
                    }

                    Spacer(minLength: 0)

                    if !fanCards.isEmpty {
                        FlagFanView(cards: fanCards, store: store, assets: assets)
                    }
                }
                // Read as "All countries, 195 flags": the fan is a picture of
                // the deck and is not read.
                .accessibilityElement(children: .combine)

                Button(L10n.studyStart) { onOpenDeck(deck.id) }
                    .buttonStyle(PrimaryActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.homeDeckRow(deck.code))
            }
        }
    }

    /// The sitting left half-finished, as the screen's hero: how far in, in
    /// the hero's figure and a bar, and the one white button.
    private func resumePane(
        _ continuable: ContinuableSession,
        _ sections: [CatalogSection]
    ) -> some View {
        let answered = continuable.answeredCards
        let total = continuable.totalCards
        let fraction = total > 0 ? min(1, Double(answered) / Double(total)) : 0
        let name = deckName(continuable.deckID, in: sections) ?? ""

        return GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                    SectionLabel(L10n.homeSessionInProgress)

                    HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.extraSmall) {
                        Text("\(answered)")
                            .font(DesignTokens.Typography.heroNumber)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                        Text("/ \(total)")
                            .font(DesignTokens.Typography.sectionTitle)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                    .foregroundStyle(.white)

                    ProgressTrackView(started: fraction, learned: fraction)

                    Text(
                        name.isEmpty
                            ? L10n.homeSessionLeft(max(0, total - answered))
                            : "\(name) · \(L10n.homeSessionLeft(max(0, total - answered)))"
                    )
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.6))
                }
                .accessibilityElement(children: .combine)

                Button(L10n.homeContinue) { onContinueSession?(continuable) }
                    .buttonStyle(PrimaryActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.homeContinue)
            }
        }
    }

    /// Whether today is over, as far as this screen can tell.
    ///
    /// It used to be "nothing is due and something was ever answered", so
    /// seven answers into a first sitting the screen announced a finished
    /// day — zero countries learned, come back later — over a session that
    /// was still waiting and a hundred and eighty cards nobody had seen. The
    /// day is done when the allowance is spent and nothing is left open; until
    /// then the way forward is the deck below, for a guest and an account
    /// alike.
    private var isDayDone: Bool {
        hasAnyProgress
            && progress?.continuable == nil
            && answeredToday >= DailyReviewAllowance.limit
    }

    /// Whether the card at the top says the day is done: the day is over and
    /// nothing on the screen offers more of it. Not while a repeat is still
    /// on offer below — "done for today" over a pane with a review button is
    /// the screen contradicting itself — which is the same rule the separate
    /// day-done pane kept when it stood in the queue's place.
    private var closesTheDay: Bool {
        isDayDone && totalDue == 0
    }

    /// A first visit: nothing answered yet, nothing waiting. The screen would
    /// otherwise be one pane on an empty scene, so it offers two more ways in
    /// made from blocks the app already has — a flag to guess and the regions
    /// with their outlines.
    private var isFirstVisit: Bool {
        progress?.isLoaded == true
            && !hasAnyProgress
            && progress?.continuable == nil
            && totalDue == 0
    }

    // MARK: - A first visit

    /// One flag, the same all day, to guess before anything else: the app's
    /// whole idea in a single card, with the answer a tap away and the
    /// country's own sheet a tap after that.
    @ViewBuilder
    private func flagOfTheDayCard(_ sections: [CatalogSection]) -> some View {
        Group {
            if let card = flagOfTheDay, let assets {
                GlassCard(padding: DesignTokens.Spacing.large) {
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                        SectionLabel(L10n.homeFlagOfTheDay)

                        FlagImageView(
                            assetID: card.promptAssetID,
                            accessibilityLabel: isFlagRevealed
                                ? card.displayName : L10n.homeFlagOfTheDayQuestion,
                            store: store,
                            assets: assets
                        )
                        .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fit)
                        .clipShape(
                            RoundedRectangle(
                                cornerRadius: DesignTokens.Radius.medium, style: .continuous
                            )
                        )
                        .overlay {
                            RoundedRectangle(
                                cornerRadius: DesignTokens.Radius.medium, style: .continuous
                            )
                            .strokeBorder(
                                .white.opacity(DesignTokens.Card.borderOpacity),
                                lineWidth: 1 / displayScale
                            )
                        }
                        .frame(maxHeight: 180)
                        .frame(maxWidth: .infinity)

                        Text(isFlagRevealed ? card.displayName : L10n.homeFlagOfTheDayQuestion)
                            .font(DesignTokens.Typography.cardAnswer)
                            .foregroundStyle(.white)
                            .contentTransition(.opacity)

                        Button(
                            isFlagRevealed
                                ? L10n.homeFlagOfTheDayDetails : L10n.homeFlagOfTheDayReveal
                        ) {
                            if isFlagRevealed {
                                detailsSubject = CountryDetailsSubject(card: card)
                            } else {
                                withAnimation(.snappy) { isFlagRevealed = true }
                            }
                        }
                        .buttonStyle(GlassActionStyle())
                        .accessibilityIdentifier(AccessibilityIdentifier.homeFlagOfTheDay)
                    }
                }
            }
        }
        .task(id: recommended(sections)?.id) { await loadFlagOfTheDay(sections) }
    }

    /// The day's flag: the same one all day and a different one tomorrow,
    /// picked from the deck the hero offers. The order is by identifier, not
    /// by name, so the days do not walk the alphabet.
    private func loadFlagOfTheDay(_ sections: [CatalogSection]) async {
        guard let deck = recommended(sections) else { return }
        let cards = await store.cards(inDeck: deck.id)
            .filter { !$0.isRetired }
            .sorted { $0.id.uuidString < $1.id.uuidString }
        guard !cards.isEmpty else { return }
        let day = Calendar.current.ordinality(of: .day, in: .era, for: Date()) ?? 0
        let card = cards[day % cards.count]
        if card.id != flagOfTheDay?.id {
            flagOfTheDay = card
            isFlagRevealed = false
        }
    }

    /// The regions, each with its outline: the catalogue's own rows, folded
    /// into a grid, as a second way in for somebody who would rather start
    /// with one continent than with the whole world.
    @ViewBuilder
    private func regionsShelf(_ sections: [CatalogSection]) -> some View {
        let regions = sections
            .filter { !$0.isFeatured && $0.kind != .curated }
            .flatMap(\.decks)
            .filter { ContinentSilhouettes.shipped.silhouette(forDeckCode: $0.code) != nil }
        if !regions.isEmpty {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                SectionLabel(L10n.homeRegionsLabel)

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: DesignTokens.Spacing.small + 4),
                        GridItem(.flexible()),
                    ],
                    spacing: DesignTokens.Spacing.small + 4
                ) {
                    ForEach(regions, id: \.id) { deck in
                        Button {
                            onOpenDeck(deck.id)
                        } label: {
                            GlassCard(padding: DesignTokens.Spacing.medium) {
                                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                                    ContinentSilhouetteView(code: deck.code, opacity: 0.55)
                                        .frame(height: 56)
                                        .frame(maxWidth: .infinity)

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(deck.name)
                                            .font(DesignTokens.Typography.sectionTitle)
                                            .foregroundStyle(.white)
                                            .lineLimit(1)
                                            .minimumScaleFactor(0.8)
                                        Text(L10n.deckItemCount(deck.cardCount, contentKinds: deck.contentKinds))
                                            .font(DesignTokens.Typography.caption)
                                            .foregroundStyle(.white.opacity(0.55))
                                    }
                                }
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier(AccessibilityIdentifier.homeRegion(deck.code))
                    }
                }
            }
        }
    }

    /// A sign-in the backend has stopped honouring, above everything: from
    /// that moment every answer stays on the phone, and the caption says how
    /// many already do. It goes away when the person signs in again.
    @ViewBuilder
    private var expiredSignInPrompt: some View {
        if let onSignIn, isSignInExpired {
            AccountPromptRow(
                symbol: "person.crop.circle.badge.exclamationmark",
                title: L10n.homeSignInExpiredTitle,
                caption: sync.status.pendingCount > 0
                    ? L10n.homeSignInExpiredPending(sync.status.pendingCount)
                    : L10n.syncSignInRequired,
                identifier: AccessibilityIdentifier.homeSignInExpired,
                action: onSignIn
            )
        }
    }

    /// A guest with something to lose: countries learned on this phone and
    /// nowhere else. Told from the first answer on, with the number of
    /// countries once there is one; a fresh install with nothing answered is
    /// not nagged. It cannot be dismissed, goes away when they sign in, and
    /// opens the sign-in screen straight away.
    @ViewBuilder
    private var guestPrompt: some View {
        if let onSignIn, !isSignInExpired, isGuestWithSomethingToLose {
            AccountPromptRow(
                symbol: "person.crop.circle",
                title: L10n.homeGuestPromptTitle,
                caption: learnedCountries > 0
                    ? L10n.homeGuestPromptCount(learnedCountries)
                    : L10n.accountGuestNote,
                identifier: AccessibilityIdentifier.homeGuestPrompt,
                action: onSignIn
            )
        }
    }

    /// The session coordinator is the judge of an expired sign-in, and the
    /// account store repeats its verdict; the shell re-reads it whenever a
    /// run comes back refused, so this screen never has to guess from a
    /// failure code alone.
    private var isSignInExpired: Bool {
        if case .authenticationExpired? = account?.state { return true }
        return false
    }

    private var isGuestWithSomethingToLose: Bool {
        guard case .guest? = account?.state else { return false }
        return hasAnyProgress
    }

    /// Whether the learner has ever answered anything: what separates a
    /// cleared queue from a fresh install.
    private var hasAnyProgress: Bool {
        progress?.decks.contains { $0.startedCards > 0 } ?? false
    }

    /// Countries carried all the way to learned, and countries under way.
    ///
    /// The whole-world deck's own figures, the same ones the progress screen
    /// puts under its map: that deck holds every country exactly once, which
    /// is what lets the label call the number "countries". These used to be
    /// summed over the curated decks, which was the same thing while the
    /// whole-world deck was the only curated one; the catalogue since gained
    /// special areas as a second, and the sum quietly began counting places
    /// that are not countries — 98 here against 91 on the progress screen,
    /// for the same phone. A release without a whole-world deck falls back to
    /// the sum, which is then all there is.
    private var learnedCountries: Int {
        progress?.whole?.learnedCards
            ?? curatedDecks.reduce(0) { $0 + $1.learnedCards }
    }

    private var countriesInProgress: Int {
        progress?.whole.map { max(0, $0.startedCards - $0.learnedCards) }
            ?? curatedDecks.reduce(0) { $0 + max(0, $1.startedCards - $1.learnedCards) }
    }

    /// Countries met at all: the learned ones and the ones under way. Added
    /// up from the two figures above rather than read off a third, so the
    /// learned part of the bar can never outrun the known part it sits in.
    private var knownCountries: Int {
        learnedCountries + countriesInProgress
    }

    /// What the bar is out of: the whole-world deck's size, with the same
    /// fallback the figures take, so the three numbers describe one deck.
    private var totalCountries: Int {
        progress?.whole?.totalCards ?? curatedDecks.reduce(0) { $0 + $1.totalCards }
    }

    // All of these read the deck rows, and the rows are the backend's own
    // counts whenever the backend has the facts — `ProgressStore` decides
    // that once, for every screen, rather than each of them deciding again.

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

    /// A hero pane: the label, the figure beside the fan, a caption, the one
    /// action.
    ///
    /// The figure is optional, though no pane leaves it out now (#497). Without
    /// it the caption takes its place beside the fan rather than under an
    /// empty row: the fan is drawn at the figure's height, and a line of
    /// words beside it reads as the pane's subject where a gap would read as
    /// a number that failed to load.
    private func pane(
        label: String,
        count: Int?,
        total: Int?,
        caption: String?,
        action: String,
        identifier: String,
        run: @escaping () -> Void,
        showsFan: Bool = true,
        isProminent: Bool = true
    ) -> some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    SectionLabel(label)

                    HStack(alignment: .center, spacing: DesignTokens.Spacing.medium) {
                        if let count {
                            HStack(
                                alignment: .firstTextBaseline,
                                spacing: DesignTokens.Spacing.extraSmall
                            ) {
                                Text("\(count)")
                                    .font(DesignTokens.Typography.heroNumber)
                                    .monospacedDigit()
                                    // The number moves rather than being
                                    // replaced when a session changes it.
                                    .contentTransition(.numericText())
                                if let total {
                                    Text("/ \(total)")
                                        .font(DesignTokens.Typography.sectionTitle)
                                        .foregroundStyle(.white.opacity(0.55))
                                }
                            }
                            .foregroundStyle(.white)
                        } else if let caption {
                            paneCaption(caption)
                        }

                        Spacer(minLength: 0)

                        // The cards the number is counting, as a small pile of
                        // themselves. Only where the number is the queue: the
                        // fan is drawn from the due cards and would be a lie
                        // beside a session's answered count.
                        if showsFan, !fanCards.isEmpty {
                            FlagFanView(cards: fanCards, store: store, assets: assets)
                        }
                    }

                    if count != nil, let caption {
                        paneCaption(caption)
                    }
                }
                .accessibilityElement(children: .combine)

                // White is spent once per screen: under an open sitting this
                // pane's action is glass, and the sitting's is the white one.
                if isProminent {
                    Button(action, action: run)
                        .buttonStyle(PrimaryActionStyle())
                        .accessibilityIdentifier(identifier)
                } else {
                    Button(action, action: run)
                        .buttonStyle(GlassActionStyle())
                        .accessibilityIdentifier(identifier)
                }

            }
        }
    }

    private func paneCaption(_ caption: String) -> some View {
        Text(caption)
            .font(DesignTokens.Typography.caption)
            .foregroundStyle(.white.opacity(0.6))
    }

    // MARK: - Known and learned

    /// How far the learner has come, in two numbers that only grow (#497).
    ///
    /// The deck pane used to say it as "0 / 195 стран выучено", and on the
    /// first day that figure cannot move. A country counts as learned only
    /// once it has been remembered on different days: for an account, three
    /// correct answers on the backend's steps, the third about twenty-seven
    /// hours after the first; for a guest, the card reaching review on the
    /// device's own ladder. A learner who studied all evening came back to a
    /// zero.
    ///
    /// So the block leads with the countries met at all, which moves with
    /// every new card, and keeps the learned figure beside it as what those
    /// grow into. One bar holds both: learned is a subset of known, so its
    /// share starts at the same left edge, inside the known one. The bar is
    /// the catalogue's deck-row bar, known in grey and learned in white over
    /// it; a green learned share over a white known one met in a third
    /// colour, and the owner turned it down (13.10). While nothing is
    /// learned, one line answers the question a zero raises — why not yet —
    /// and goes away with the first learned country, when the answer is on
    /// the screen.
    ///
    /// On an ordinary day nothing else is on it: no label, no legend, no
    /// third figure. The captions name the numbers, and a symbol before each
    /// says which is which at a glance: a white flag for the countries met,
    /// a green seal for the learned.
    ///
    /// A finished day is said here too. It used to be a pane of its own in
    /// the queue's place, which repeated the learned figure, offered the
    /// catalogue beside the deck pane's own offer, and named the hour of the
    /// next portion — a promise the day could not keep, because with the
    /// allowance spent nothing opens at that hour. Now the card gains a title
    /// over its figures, in the section label's type and nothing more, and
    /// the line under the bar gives the day's limit and when repeats come
    /// back. Still one button to the progress tab with its chevron, and
    /// nothing inside it to press.
    ///
    /// Shown whenever anything has been answered, first of the day's blocks
    /// above whichever hero the day has, and never on a first visit, where both
    /// numbers would be zero and the block a caption for something absent.
    /// The whole block is the one way to the progress tab from here; nothing
    /// on it navigates alone.
    @ViewBuilder
    private var knownLearnedCard: some View {
        let known = knownCountries
        let learned = learnedCountries
        let total = totalCountries
        let isDayClosed = closesTheDay
        // A closed day is drawn even in the corner where nothing counts as
        // known, so the day's end is never left unsaid.
        if known > 0 || isDayClosed {
            Button {
                onOpenProgress?()
            } label: {
                GlassCard(padding: DesignTokens.Spacing.large) {
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                        if isDayClosed {
                            SectionLabel(L10n.homeDayDoneTitle)
                        }

                        HStack(alignment: .center, spacing: DesignTokens.Spacing.large) {
                            knownLearnedFigure(known, caption: L10n.homeKnownCaption(known)) {
                                Image(systemName: "flag.fill")
                                    .foregroundStyle(.white)
                            }
                            // White like the known figure: the green is the
                            // seal's alone, so the two numbers read alike and
                            // the colour says what is counted, not how much.
                            // At zero the figure dims, which is how a zero
                            // says "not yet". The seal is drawn as the
                            // finished-day seal was, the tick dark on the
                            // green so it reads as a mark rather than a hole.
                            knownLearnedFigure(
                                learned,
                                caption: L10n.homeLearnedCaption,
                                tint: learned > 0 ? .white : Self.unearnedTint
                            ) {
                                Image(systemName: "checkmark.seal.fill")
                                    .symbolRenderingMode(.palette)
                                    .foregroundStyle(.black.opacity(0.75), Self.learnedTint)
                            }

                            Spacer(minLength: 0)

                            if onOpenProgress != nil {
                                Image(systemName: "chevron.right")
                                    .font(DesignTokens.Typography.caption)
                                    .foregroundStyle(.white.opacity(0.4))
                            }
                        }

                        ProgressTrackView(
                            started: share(known, of: total),
                            learned: share(learned, of: total)
                        )

                        if let line = knownLearnedFootnote(
                            learned: learned, isDayClosed: isDayClosed
                        ) {
                            Text(line)
                                .font(DesignTokens.Typography.caption)
                                .foregroundStyle(.white.opacity(0.55))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(onOpenProgress == nil)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                knownLearnedAccessibilityLabel(known, learned, total, isDayClosed: isDayClosed)
            )
            .accessibilityHint(onOpenProgress == nil ? "" : L10n.homeKnownLearnedHint)
            .accessibilityIdentifier(AccessibilityIdentifier.homeKnownLearned)
        }
    }

    /// The one line under the bar, when there is one: on a closed day, the
    /// day's limit and when repeats come back; otherwise, while nothing is
    /// learned, why the second figure is still zero.
    private func knownLearnedFootnote(learned: Int, isDayClosed: Bool) -> String? {
        if isDayClosed { return L10n.homeDayDoneLimit(DailyReviewAllowance.limit) }
        if learned == 0 { return L10n.homeLearnedExplanation }
        return nil
    }

    /// One figure and the word for it, in the hero face every other number
    /// on this screen wears.
    ///
    /// The symbol stands on the figure's line, set in the figure's own face
    /// a scale down, so it grows with the number under Dynamic Type instead
    /// of shrinking beside it. Each caller draws and colours its own symbol,
    /// because the two are not drawn alike. It is a picture of the caption
    /// under it and is not read.
    private func knownLearnedFigure<Symbol: View>(
        _ value: Int,
        caption: String,
        tint: Color = .white,
        @ViewBuilder symbol: () -> Symbol
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.small) {
                symbol()
                    .font(DesignTokens.Typography.heroNumber)
                    .imageScale(.small)
                    .accessibilityHidden(true)
                Text("\(value)")
                    .font(DesignTokens.Typography.heroNumber)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .foregroundStyle(tint)
            }
            Text(caption)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.6))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Both figures in one sentence, with the numbers inside the words this
    /// time, the closed day's title before them and the line under the bar
    /// after them when those are on screen: VoiceOver hears what the screen
    /// shows, not a shorter version of it.
    private func knownLearnedAccessibilityLabel(
        _ known: Int,
        _ learned: Int,
        _ total: Int,
        isDayClosed: Bool
    ) -> String {
        let figures = "\(L10n.homeKnownCount(known)), \(L10n.homeLearnedOf(learned, total))"
        var parts = isDayClosed ? ["\(L10n.homeDayDoneTitle)."] : []
        // The footnote ends its own sentence; the figures before it need
        // their full stop, and alone they need none.
        if let line = knownLearnedFootnote(learned: learned, isDayClosed: isDayClosed) {
            parts += ["\(figures).", line]
        } else {
            parts.append(figures)
        }
        return parts.joined(separator: " ")
    }

    /// Clamped for the reason `DeckProgressRow.fraction` is: a deck whose
    /// membership shrank in a republished release can report more cards than
    /// it now holds, and a bar drawn from that ratio runs past its track.
    private func share(_ count: Int, of total: Int) -> Double {
        total > 0 ? min(1, Double(count) / Double(total)) : 0
    }

    /// The green of "learned" on this screen, which only the seal wears (the
    /// learned figure stays white, and the bar is the catalogue's white and
    /// grey): the saturated system green the design tokens name for it, the
    /// one the finished-day seal wore.
    private static let learnedTint = DesignTokens.Colors.learned
    /// A learned figure at zero: present, and plainly not yet.
    private static let unearnedTint = Color.white.opacity(0.35)

    // MARK: - The queue, deck by deck

    @ViewBuilder
    private func queuePane(_ sections: [CatalogSection]) -> some View {
        if let progress, progress.isLoaded {
            // Regions only: the curated deck spans every card, so its row
            // would restate the pane above it in different words.
            let curated = Set((sections.first { $0.isOpenCurated }?.decks ?? []).map(\.id))
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
    ///
    /// Never a deck that has to be bought: Home is where the app says what to
    /// study next, and recommending something the learner cannot open is an
    /// advertisement wearing a recommendation's clothes.
    private func recommended(_ sections: [CatalogSection]) -> DeckRecord? {
        let open = sections.filter { !$0.isFeatured }
        return (open.first { $0.kind == .curated }?.decks ?? open.flatMap(\.decks)).first
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

    /// Reads the flags the pane and the rows show: in every place, the cards
    /// the button beside them is about to deal.
    ///
    /// It runs before the counts exist as well, because the first wave draws
    /// real flags and has only the catalogue to draw them from. With no card
    /// states to rank by, the deck's own opening cards are what there is —
    /// which is the honest answer while there is no queue to be about.
    private func reloadPreviews() async {
        let decks = progress?.decks ?? []
        let states = progress?.isLoaded == true
            ? await progress?.cardStatesByID() ?? [:]
            : [:]
        let now = Date()
        // The same count the sessions cut owed cards by, so the card that
        // says the day is done and the session that stops dealing owed cards
        // agree on when that is.
        answeredToday = DailyReviewAllowance.answeredToday(Array(states.values), now: now)

        var fresh: [UUID: [LearningCardRecord]] = [:]
        for deck in decks where deck.dueCards > 0 {
            fresh[deck.id] = opening(
                await store.cards(inDeck: deck.id),
                states: states,
                now: now
            )
        }
        previews = fresh

        if let top = decks.filter({ $0.dueCards > 0 })
            .max(by: { $0.dueCards < $1.dueCards }),
            let cards = fresh[top.id], !cards.isEmpty
        {
            fanCards = cards
        } else if case .ready(let sections, _, _) = store.catalog,
            let deck = recommended(sections)
        {
            fanCards = opening(
                await store.cards(inDeck: deck.id),
                states: states,
                now: now
            )
        }
    }

    /// The three cards a session started here would open with.
    ///
    /// The bands are the session's own — what the day owes first, then what
    /// has never been seen, then the rest — because the pile stands next to
    /// the button that deals them, and `LocalCardSelection` ranks the real
    /// session the same way. Inside a band the oldest debt leads and the name
    /// breaks ties, so the fan is stable between reloads instead of
    /// reshuffling under the learner.
    ///
    /// Both callers go through here. The fan used to fall back to the first
    /// three cards in store order, which is alphabetical — so whenever the
    /// device had no card states to rank by, the app fanned Antarctica and its
    /// alphabetical neighbours next to a queue they were no part of.
    private func opening(
        _ cards: [LearningCardRecord],
        states: [UUID: CardStateRecord],
        now: Date
    ) -> [LearningCardRecord] {
        func band(_ card: LearningCardRecord) -> Int {
            guard let state = states[card.id], state.state != "NEW" else { return 1 }
            return LocalProgressProjection.isOwed(state, at: now) ? 0 : 2
        }
        return Array(
            cards
                // A retired card is never dealt into a new session, so it has
                // no business advertising one.
                .filter { !$0.isRetired }
                .sorted { left, right in
                    let leftBand = band(left)
                    let rightBand = band(right)
                    if leftBand != rightBand { return leftBand < rightBand }
                    let leftDue = states[left.id]?.dueAt ?? .distantFuture
                    let rightDue = states[right.id]?.dueAt ?? .distantFuture
                    if leftDue != rightDue { return leftDue < rightDue }
                    return left.displayName < right.displayName
                }
                .prefix(3)
        )
    }
}

/// Three cards of a deck, thrown the way the study pile lies.
struct FlagFanView: View {
    let cards: [LearningCardRecord]
    let store: ContentStore
    let assets: (any AssetLoading)?
    /// How much larger than the home fan. The sign-in screen throws the same
    /// pile as its hero, twice the size; the lie of the cards is the same so
    /// it reads as the same pile, not a different drawing of one.
    var scale: CGFloat = 1

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
                    .frame(width: Self.size.width * scale, height: Self.size.height * scale)
                    .clipShape(
                        RoundedRectangle(
                            cornerRadius: DesignTokens.Radius.small * scale, style: .continuous
                        )
                    )
                    .overlay {
                        RoundedRectangle(
                            cornerRadius: DesignTokens.Radius.small * scale, style: .continuous
                        )
                        .strokeBorder(
                            .white.opacity(DesignTokens.Card.borderOpacity),
                            lineWidth: 1 / displayScale
                        )
                    }
                    .shadow(color: .black.opacity(0.35), radius: 5 * scale, y: 2 * scale)
                    .rotationEffect(.degrees(Self.poses[index].rotation))
                    .offset(x: Self.poses[index].x * scale, y: Self.poses[index].y * scale)
                }
            }
            .frame(width: Self.frame.width * scale, height: Self.frame.height * scale)
            .accessibilityHidden(true)
        }
    }

    /// Shared with the fan's placeholder, so the cards land exactly where the
    /// waiting shape said they would.
    static let size = CGSize(width: 76, height: 57)
    static let frame = CGSize(width: 120, height: 74)
    static let poses: [(rotation: Double, x: CGFloat, y: CGFloat)] = [
        (-2, 0, 0),
        (-10, -20, 3),
        (8, 20, 5),
    ]
}

/// The pile, before there is a queue for it to be about.
///
/// It used to show the deck's own first three flags while the counts were on
/// their way, which is a promise the screen could not keep: the fan sits
/// beside the number and reads as "these are the ones", and until the counts
/// land nothing knows which three those are. Blank cards say the same thing
/// the number's placeholder says — this is coming — and say nothing untrue
/// on the way.
///
/// Same cards, same sizes, same lie of the pile, so the flags arrive into
/// the shape rather than displacing it.
struct SkeletonFanView: View {
    var body: some View {
        ZStack {
            ForEach(Array(FlagFanView.poses.enumerated().reversed()), id: \.offset) { _, pose in
                SkeletonBlock(
                    height: FlagFanView.size.height,
                    radius: DesignTokens.Radius.small
                )
                .frame(width: FlagFanView.size.width)
                // No shadow: a card that is not there yet is not an object
                // casting one.
                .rotationEffect(.degrees(pose.rotation))
                .offset(x: pose.x, y: pose.y)
            }
        }
        .frame(width: FlagFanView.frame.width, height: FlagFanView.frame.height)
        .accessibilityHidden(true)
    }
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


extension CatalogSection {
    /// The curated shelf a learner already owns. A curated deck that is for
    /// sale and unbought is a different thing, and Home must not count it as
    /// the whole picture.
    fileprivate var isOpenCurated: Bool { kind == .curated && !isFeatured }
}
