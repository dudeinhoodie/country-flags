import SwiftUI

import CountryFlagsDomain

/// One self-rated card at a time: the flag, then the country, then a rating.
public struct StudySessionView: View {
    @State private var runner: StudySessionRunner
    @State private var palette: ScenePalette = .neutral
    @State private var isShowingDetails = false
    @State private var isShowingBack = false
    @State private var swipeProgress: CGFloat = 0
    @State private var commandedThrow: StudyRating?
    /// The name surfacing over the deck, held apart from the card on top:
    /// tied to the card, a throw's full opacity outlived the throw by a
    /// frame and lit the next country's name. The card change zeroes this
    /// instantly; only the gesture itself may raise it.
    @State private var surfacedName = ""
    @State private var surfacedOpacity: Double = 0
    /// The deck's own name, worn by the session. Identical flags fly over
    /// different countries — Heard Island under Australia's, Bonaire under
    /// the Dutch — and which answer is right can depend on which deck is
    /// asking. The context stays on screen rather than being remembered.
    @State private var deckName = ""
    /// Which face each card of the sitting wears. Read from the store once
    /// the session's composition is known, because the snapshot does not
    /// carry the template and the deck's name is never allowed to imply one.
    @State private var templates = CardTemplates()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let deckID: UUID
    private let composition: StudySessionComposition
    private let size: StudySessionSize
    private let store: ContentStore
    private let assets: any AssetLoading
    private let onFinish: () -> Void

    public init(
        deckID: UUID,
        size: StudySessionSize,
        composition: StudySessionComposition = .standard,
        runner: StudySessionRunner,
        store: ContentStore,
        assets: any AssetLoading,
        onFinish: @escaping () -> Void
    ) {
        self.deckID = deckID
        self.composition = composition
        self.size = size
        _runner = State(wrappedValue: runner)
        self.store = store
        self.assets = assets
        self.onFinish = onFinish
    }

    public var body: some View {
        ZStack {
            // The ground belongs to the session rather than to one of its
            // states: it stays put while the session loads, is answered and
            // ends, so nothing flashes white between them.
            AppScene(palette: palette, drifts: true)

            content
            .task(id: deckID) { deckName = await store.deck(id: deckID)?.name ?? "" }
                .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
                .padding(DesignTokens.Spacing.large)
        }
        // The flag is the screen: the chrome shrinks to the counter and a way
        // out, both of which live on the scene rather than above it.
        .toolbar(.hidden, for: .navigationBar)
        // The tab bar is hidden by the root, keyed on the router: hidden from
        // this screen it reappeared only after the pop finished, and a bar
        // that arrives late under a moving thumb is a mis-tap machine.
        .task { await runner.startOrResume(deckID: deckID, size: size, composition: composition) }
    }

    @ViewBuilder
    private var content: some View {
        if let summary = runner.summary {
            StudySessionResultView(
                summary: summary,
                tally: runner.tally,
                store: store,
                assets: assets,
                onMore: { Task { await runner.startAnother() } },
                onDone: onFinish
            )
        } else if runner.startFailure == .nothingDue {
            // An empty queue is not a screen.
            //
            // The learner tapped "repeat" on a pane that had just counted the
            // day's work; if the queue is empty by the time the session opens,
            // the two numbers disagreed, and the answer to that is the first
            // screen — which recounts and says the day is clear, with the
            // learner's own total on it. It used to be a dead end that
            // announced the good news and then offered a session nobody had
            // asked for.
            Color.clear.onAppear(perform: onFinish)
        } else if let failure = runner.startFailure {
            StudyUnavailableView(failure: failure, onDone: onFinish)
        } else if let state = runner.state, let card = state.currentCard {
            cardView(state: state, card: card)
        } else if runner.state == nil {
            StudyLoadingView(onClose: onFinish)
        } else {
            // The beat between the last answer and the summary: the session is
            // finished and the store is being read. The scene simply holds —
            // flashing the loading skeleton here read as a fourth state that
            // does not exist.
            Color.clear
        }
    }

    /// One flip for every entrance: the button, a tap on the card, and a tap
    /// beside it all go through here, so the reveal is recorded exactly once
    /// and the sides stay symmetrical.
    private func toggleCard() {
        if !isShowingBack {
            runner.revealAnswer()
        }
        isShowingBack.toggle()
    }

    private func cardView(state: StudySessionState, card: StudySessionCardRecord) -> some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            hud(state: state)
                .devBlockID("study.hud")

            Spacer(minLength: 0)

            // The answer, surfacing with the throw: transparent while the
            // card rests, fading in as the swipe commits — the learner has
            // already decided by then, and the name confirms rather than
            // spoils. Dragging back to centre takes it away again. The slot
            // keeps its height so the deck never jumps.
            Text(surfacedName)
                .font(DesignTokens.Typography.screenTitle)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .frame(maxWidth: .infinity)
                .frame(height: DesignTokens.Spacing.extraLarge)
                .opacity(surfacedOpacity)
                .scaleEffect(0.92 + 0.08 * surfacedOpacity)
                .accessibilityHidden(true)
                .padding(.bottom, DesignTokens.Spacing.small)
                // The fifth power, so the name belongs to the very end of
                // the gesture: half a swipe still shows almost nothing, three
                // quarters a ghost, and only a throw at the threshold reads
                // in full. A release fades it out; a card change above zeroes
                // it before this runs.
                .onChange(of: swipeProgress) { _, progress in
                    if progress != 0 {
                        surfacedName = card.displayName
                        surfacedOpacity = pow(min(1, Double(abs(progress))), 5)
                    } else {
                        withAnimation(.easeOut(duration: 0.25)) { surfacedOpacity = 0 }
                    }
                }
                .onChange(of: card.id) { _, _ in
                    // Instant and unanimated: the thrown card's opacity must
                    // never light the next country's name, even for a frame.
                    var transaction = Transaction()
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { surfacedOpacity = 0 }
                }

            StudyCardStackView(
                state: state,
                store: store,
                assets: assets,
                templates: templates,
                palette: palette,
                onReveal: { runner.revealAnswer() },
                onRate: { rating in Task { await runner.rate(rating) } },
                onDetails: { isShowingDetails = true },
                isShowingBack: $isShowingBack,
                swipeProgress: $swipeProgress,
                commandedThrow: $commandedThrow
            )
            // The swipe answers, and since #526 two equal buttons under the
            // card do as well. VoiceOver cannot swipe a throw, so both
            // answers also ride on the card as actions. Both, and only both: an action offering a grade the
            // swipe cannot reach is a second scheduler behind an accessibility
            // affordance, which is how HARD used to strand a card on a
            // three-hour step no sighted learner could land on.
            .accessibilityActions {
                if state.isAnswerRevealed {
                    ForEach(StudyRating.allCases, id: \.self) { rating in
                        Button(L10n.studyRating(rating)) { commandedThrow = rating }
                    }
                }
            }

            // Where each throw leads, said before the first one is made. The
            // side the throw is heading for lights up as it goes.
            swipeHints
                .devBlockID("study.hints")

            Spacer(minLength: 0)

            if runner.lastCommitFailed {
                Text(L10n.studyNotSaved)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.75))
                    .accessibilityIdentifier(AccessibilityIdentifier.studyNotSaved)
            }

            // The front's one action is the white "Показать ответ" (#526):
            // until the answer is out, turning the card is the thing to do.
            // Once it is, two equal buttons answer it — "Снова" and "Хорошо"
            // — where "Скрыть ответ" used to stand; the swipe still answers
            // too, and a tap beside the card still turns it back.
            if isShowingBack {
                HStack(spacing: DesignTokens.Spacing.small) {
                    Button(L10n.studyRating(.again)) { commandedThrow = .again }
                        .buttonStyle(GlassActionStyle())
                        .accessibilityIdentifier(AccessibilityIdentifier.studyRateAgain)
                    Button(L10n.studyRating(.good)) { commandedThrow = .good }
                        .buttonStyle(GlassActionStyle())
                        .accessibilityIdentifier(AccessibilityIdentifier.studyRateGood)
                }
            } else {
                Button(L10n.studyReveal) { toggleCard() }
                    .buttonStyle(PrimaryActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.studyReveal)
            }
        }
        // A tap that lands beside the card closes it, and only closes: the
        // back is often read at arm's length and dismissed with whatever
        // finger is free, while revealing stays a deliberate act on the card
        // or its button — a stray touch must not spend the reveal. The
        // gesture sits behind the interactive children, so buttons and
        // swipes keep winning.
        .contentShape(Rectangle())
        .onTapGesture { if isShowingBack { toggleCard() } }
        .animation(reduceMotion ? nil : .default, value: state.isAnswerRevealed)
        // The one this moment is given in docs/16, §6.
        .hapticFeedback(.impact(flexibility: .soft), trigger: state.isAnswerRevealed) { _, revealed in
            revealed
        }
        .task(id: card.promptAssetID) { await loadPalette(for: card) }
        // Keyed on the session rather than on the card: the answer is the
        // same for every card of the sitting, and re-reading it per card
        // would read the deck twenty times over.
        .task(id: state.sessionID) { await loadTemplates(for: state) }
        .sheet(isPresented: $isShowingDetails) {
            // The sheet was opened from the back of the card; leaving it face
            // down would strand the reader on a side with nothing left to do.
            isShowingBack = false
        } content: {
            CountryDetailsSheet(
                subject: CountryDetailsSubject(card: card),
                store: store,
                assets: assets
            )
        }
    }

    /// The standing answer to "what does a swipe do": one arrow pointing both
    /// ways, again to the left, good to the right. The half a throw is heading
    /// for takes on its answer's colour — only that half, and gently.
    private var swipeHints: some View {
        HStack(spacing: DesignTokens.Spacing.medium) {
            SwipeHintHalf(
                symbol: "arrow.left",
                text: L10n.studyRating(.again),
                tint: .red,
                isLeading: true,
                emphasis: max(-swipeProgress, 0)
            )

            // The gesture itself, between the two destinations: the arrows
            // say where, the hand says how.
            Image(systemName: "hand.draw")
                .font(DesignTokens.Typography.caption)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.white.opacity(0.5))

            SwipeHintHalf(
                symbol: "arrow.right",
                text: L10n.studyRating(.good),
                tint: .green,
                isLeading: false,
                emphasis: max(swipeProgress, 0)
            )
        }
        // A quiet line rather than a glass capsule (#526): the capsule looked
        // like buttons, and the buttons are under the card now.
        .opacity(0.8)
        .frame(maxWidth: .infinity)
        .padding(.top, DesignTokens.Spacing.small)
        .accessibilityHidden(true)
    }

    /// The counter and the way out, as capsules over the scene.
    private func hud(state: StudySessionState) -> some View {
        SessionHUD(
            position: state.position,
            total: state.cards.count,
            deckName: deckName,
            onClose: onFinish
        )
    }

    /// Resolves the sitting's templates, and says so when one of them is a
    /// pair this build cannot draw.
    ///
    /// A new session never contains such a card — the selector drops it, and
    /// the runner reports the drop. What lands here is a session composed
    /// elsewhere: resumed from a later build, or selected by the backend. The
    /// card wears the unsupported plate and the fact goes out once.
    private func loadTemplates(for state: StudySessionState) async {
        templates = await CardTemplates.resolve(
            deckID: deckID,
            cardIDs: state.cards.map(\.learningCardID),
            store: store
        )
        var reported = Set<CardTemplateKey>()
        for card in state.cards {
            guard case .unsupported(let key) = templates.face(for: card.learningCardID),
                reported.insert(key).inserted
            else { continue }
            runner.reportUnsupportedTemplate(key)
        }
    }

    private func loadPalette(for card: StudySessionCardRecord) async {
        guard let record = await store.asset(id: card.promptAssetID) else { return }
        palette = await FlagPaletteReader.palette(for: record, assets: assets) ?? .neutral
    }

}

/// A session that could not be dealt, said out loud.
///
/// `.nothingDue` never reaches here: an empty queue is good news and is
/// answered by returning to the first screen, which counts the day again and
/// shows the tally. The cases left are the ones a learner can do nothing
/// about, and the screen offers them the way out rather than another session.
struct StudyUnavailableView: View {
    let failure: StudySessionStartFailure
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Spacer(minLength: 0)

            Image(systemName: symbol)
                .font(DesignTokens.Typography.screenTitle)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.white.opacity(0.8))

            Text(title)
                .font(DesignTokens.Typography.sectionTitle)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier(AccessibilityIdentifier.studyUnavailable)

            Spacer(minLength: 0)

            Button(L10n.studyResultDone, action: onDone)
                .buttonStyle(PrimaryActionStyle())
        }
    }

    private var title: String {
        switch failure {
        // An empty deck and an empty queue read the same to a learner standing
        // in front of one; the queue is handled before this screen, and this
        // stays total so a new failure has to choose its own words.
        case .noUsableCards, .nothingDue: L10n.studyNoCards
        case .storeUnavailable: L10n.studyStoreUnavailable
        }
    }

    /// Shape as well as words: an empty deck and a store that will not open are
    /// different problems and should not look like the same one.
    private var symbol: String {
        switch failure {
        case .noUsableCards, .nothingDue: "checkmark.circle"
        case .storeUnavailable: "exclamationmark.triangle"
        }
    }
}



/// One half of the deck's promise: the direction, and the rating a throw
/// that way commits.
///
/// The half is drawn twice — once quiet and white, once in its answer's
/// colour laid over it — and the coloured layer's opacity follows the throw.
/// Drawing it as two layers is what makes the colour change a fade rather
/// than a switch, and it lights exactly this half and nothing beside it.
/// The colour is never the only carrier: the arrow, the word and the side
/// say the same thing.
private struct SwipeHintHalf: View {
    let symbol: String
    let text: String
    let tint: Color
    let isLeading: Bool
    /// 0...1, how far the current throw has gone this way.
    let emphasis: CGFloat

    var body: some View {
        content
            .foregroundStyle(.white.opacity(0.45))
            .overlay {
                content
                    .foregroundStyle(tint)
                    .opacity(emphasis)
            }
            // The follow is continuous while the finger moves; this smooths
            // the snap back to quiet when the card is released.
            .animation(.easeOut(duration: 0.25), value: emphasis == 0)
    }

    private var content: some View {
        HStack(spacing: DesignTokens.Spacing.extraSmall) {
            if isLeading {
                Image(systemName: symbol)
                Text(text)
            } else {
                Text(text)
                Image(systemName: symbol)
            }
        }
        .font(DesignTokens.Typography.caption.weight(.medium))
    }
}

/// What the session looks like while it is being put together.
///
/// A card-shaped placeholder rather than a spinner: the screen already knows
/// the shape it will take, so it takes it, and the cards arrive into it instead
/// of replacing it. The table in docs/16 §7 asks for exactly this and names the
/// spinner over content as the thing not to build.
struct StudyLoadingView: View {
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            HStack {
                Capsule()
                    .fill(.ultraThinMaterial)
                    .frame(width: DesignTokens.Layout.progressPlaceholderWidth, height: DesignTokens.Layout.minimumTouchTarget * 0.75)
                    .skeletonPulse()
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(DesignTokens.Typography.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(
                            width: DesignTokens.Layout.minimumTouchTarget,
                            height: DesignTokens.Layout.minimumTouchTarget
                        )
                        .glassEffect(.regular, in: Circle())
                }
                .accessibilityLabel(L10n.studyClose)
                .accessibilityIdentifier(AccessibilityIdentifier.studyClose)
            }

            Spacer(minLength: 0)

            RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                .fill(.ultraThinMaterial)
                .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .skeletonPulse()
                .accessibilityLabel(L10n.contentLoading)
                .accessibilityIdentifier(AccessibilityIdentifier.contentLoadingLabel)

            Spacer(minLength: 0)

            Capsule()
                .fill(.ultraThinMaterial)
                .frame(height: DesignTokens.Layout.actionHeight)
                .skeletonPulse()
        }
    }
}
