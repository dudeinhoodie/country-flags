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
                deckName: deckName,
                mastery: runner.deckMastery,
                store: store,
                assets: assets,
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
                palette: palette,
                onReveal: { runner.revealAnswer() },
                onRate: { rating in Task { await runner.rate(rating) } },
                onDetails: { isShowingDetails = true },
                isShowingBack: $isShowingBack,
                swipeProgress: $swipeProgress,
                commandedThrow: $commandedThrow
            )
            // The rating bar that used to sit under a revealed card is gone —
            // the swipe is the answer, and the hints below say where each one
            // leads. VoiceOver cannot swipe a throw, so the four ratings ride
            // on the card as actions instead of as buttons everyone else must
            // scroll past.
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

            Spacer(minLength: 0)

            if runner.lastCommitFailed {
                Text(L10n.studyNotSaved)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.75))
                    .accessibilityIdentifier(AccessibilityIdentifier.studyNotSaved)
            }

            // The button turns the card over and stays: once the answer is
            // up it offers the way back, and either side can be returned to
            // as often as the learner likes. The swipe is the answer either
            // way; the hints above say where each one leads.
            //
            // Glass, not the white capsule: white is the scene's loudest
            // voice and belongs to the one action a screen recommends —
            // here that is answering the card, and this button is the way
            // to peek.
            Button {
                toggleCard()
            } label: {
                Label(
                    isShowingBack ? L10n.studyHide : L10n.studyReveal,
                    systemImage: "arrow.2.squarepath"
                )
            }
                .buttonStyle(GlassActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.studyReveal)
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
        .padding(.horizontal, DesignTokens.Spacing.medium)
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget * 0.7)
        .glassEffect(.regular, in: Capsule(style: .continuous))
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

    private func loadPalette(for card: StudySessionCardRecord) async {
        guard let record = await store.asset(id: card.promptAssetID) else { return }
        palette = await FlagPaletteReader.palette(for: record, assets: assets) ?? .neutral
    }

}

/// The session's verdict, told as an open gauge.
///
/// The hero is a half-circle scale of the sitting itself — zero to the cards
/// it dealt — filled to the remembered count with the scene's aurora. The
/// score stands inside the bowl, the deck's own gain worn as a pill under
/// it, and its floor sits on the line of the scale's end labels. Below, the
/// answers: every flag of the sitting, a missed one slightly translucent and
/// nothing more, rows centred whatever the count. Nothing is said twice and
/// nothing is judged — the screen shows results, the learner draws the
/// conclusions.
struct StudySessionResultView: View {
    let summary: StudySessionSummary
    /// Feeds the pill alone; the gauge is the session's own arithmetic.
    let mastery: StudySessionDeckMastery?
    let deckName: String
    let store: ContentStore
    let assets: any AssetLoading
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hasArrived = false
    /// The gauge's sweep position, 0...1 of the half-circle.
    @State private var gaugeFill: Double = 0
    /// One soft tap per step of the sweep, and a firmer one at the level.
    @State private var fillTick = 0
    @State private var hasFilled = false

    /// The pill's green, and where the gauge's gradient sets off from.
    static let green = Color(red: 122 / 255, green: 224 / 255, blue: 150 / 255)
    /// Where the gradient arrives: a bright, cheerful cyan — livelier than
    /// the scene's own muted blue, which read as overcast.
    static let gaugeCyan = Color(red: 86 / 255, green: 200 / 255, blue: 245 / 255)

    /// The fill is smooth, unhurried, and over before it is waited for.
    private static let fillDuration: TimeInterval = 1.25

    init(
        summary: StudySessionSummary,
        deckName: String,
        mastery: StudySessionDeckMastery?,
        store: ContentStore,
        assets: any AssetLoading,
        onDone: @escaping () -> Void
    ) {
        self.summary = summary
        self.deckName = deckName
        self.mastery = mastery
        self.store = store
        self.assets = assets
        self.onDone = onDone
    }

    private var sessionFraction: Double {
        summary.plannedCards > 0
            ? Double(summary.rememberedCards) / Double(summary.plannedCards)
            : 0
    }

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            header
                .settled(hasArrived, step: 0, reduceMotion: reduceMotion)
                .padding(.top, DesignTokens.Spacing.large)

            gauge
                // Dropped from the header by the owner's eye on the device.
                .padding(.top, 30)
                .settled(hasArrived, step: 1, reduceMotion: reduceMotion)

            if !summary.answered.isEmpty {
                answers
                    // Sunk below the gauge by the owner's eye, like the
                    // gauge below the header.
                    .padding(.top, DesignTokens.Spacing.large)
                    .settled(hasArrived, step: 2, reduceMotion: reduceMotion)
            }

            Spacer(minLength: 0)

            // The congratulation is earned, not printed: a full house leaves
            // on "Excellent!", anything else on a plain "Done".
            Button(
                summary.rememberedCards == summary.plannedCards
                    ? L10n.studyResultExcellent
                    : L10n.studyResultDone,
                action: onDone
            )
            .buttonStyle(PrimaryActionStyle())
            .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
            .settled(hasArrived, step: 3, reduceMotion: reduceMotion)
        }
        .onAppear {
            hasArrived = true
            if reduceMotion {
                gaugeFill = sessionFraction
                hasFilled = true
            } else {
                // A plain ease-out: the spring's bounce read as a jitter at
                // the tip, and a gauge does not tremble.
                withAnimation(.easeOut(duration: Self.fillDuration).delay(0.15)) {
                    gaugeFill = sessionFraction
                }
                // The fill is felt as much as seen: a soft tap per step of
                // the sweep, then the firmer arrival at the level.
                Task {
                    for _ in 0..<8 {
                        try? await Task.sleep(for: .milliseconds(160))
                        fillTick += 1
                    }
                    try? await Task.sleep(for: .milliseconds(120))
                    hasFilled = true
                }
            }
        }
        .hapticFeedback(.impact(weight: .light, intensity: 0.45), trigger: fillTick)
        .hapticFeedback(.impact(weight: .medium, intensity: 1.0), trigger: hasFilled) {
            _, filled in filled
        }
    }

    /// The verdict in words, quiet on purpose: the gauge is the loud part.
    /// The deck's name is not here — it stands over its own flags below.
    private var header: some View {
        Text(L10n.studyResultTitle)
            .font(DesignTokens.Typography.caption.weight(.semibold))
            .kerning(DesignTokens.Typography.labelKerning)
            .textCase(.uppercase)
            .foregroundStyle(.white.opacity(0.55))
            .multilineTextAlignment(.center)
    }

    /// The scale and what stands in its bowl, one element for VoiceOver.
    private var gauge: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: DesignTokens.Spacing.small) {
                ZStack {
                    SessionGaugeArc(fill: 1)
                        .stroke(
                            .white.opacity(0.22),
                            style: StrokeStyle(lineWidth: SessionGauge.trackLine, lineCap: .round)
                        )
                    // The app's success green pouring into a bright cyan:
                    // one cheerful sweep. A fill sampled off the deck's flags
                    // gave every deck its own gauge, and some a muddy one.
                    SessionGaugeArc(fill: gaugeFill)
                        .stroke(
                            LinearGradient(
                                colors: [Self.green, Self.gaugeCyan],
                                startPoint: .bottomLeading,
                                endPoint: .topTrailing
                            ),
                            style: StrokeStyle(lineWidth: SessionGauge.line, lineCap: .round)
                        )
                }
                .frame(width: SessionGauge.width, height: SessionGauge.arcHeight)

                // The scale's own ends: zero, and the cards this sitting
                // dealt — which is why the size is not repeated anywhere.
                // Each label is centred exactly under its end of the arc,
                // not flushed to the box's edge beside it.
                ZStack {
                    Text(verbatim: "0")
                        .position(x: SessionGauge.line / 2, y: 8)
                    Text(verbatim: "\(summary.plannedCards)")
                        .position(x: SessionGauge.width - SessionGauge.line / 2, y: 8)
                }
                .font(DesignTokens.Typography.caption.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.55))
                .frame(width: SessionGauge.width, height: 16)
            }

            // The verdict stack, its floor on the end labels' line. The
            // score stands alone: the scale's ends say what it is out of,
            // and the spoken label says what it counts. The pill's slot is
            // held even when nothing is earned — the score keeps its place
            // whatever happens under it.
            VStack(spacing: DesignTokens.Spacing.extraSmall) {
                Text(verbatim: "\(summary.rememberedCards)")
                    .font(.system(size: 64, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)

                deltaPill(mastery?.deltaPercent ?? 0)
                    .opacity((mastery?.deltaPercent ?? 0) > 0 ? 1 : 0)
                    .padding(.top, DesignTokens.Spacing.small)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(gaugeAccessibilityLabel)
        .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)
    }

    /// Everything the visuals say, in one spoken sentence: the score, the
    /// deck's gain, and — because the flags below carry it only as
    /// translucency — how many cards are coming back.
    private var gaugeAccessibilityLabel: String {
        var parts = [
            L10n.studyResultRemembered(summary.rememberedCards, summary.plannedCards)
        ]
        if let mastery, mastery.deltaPercent > 0 {
            parts.append(L10n.studyResultMasteryDelta(mastery.deltaPercent))
        }
        let returning = summary.answeredCards - summary.rememberedCards
        if returning > 0 {
            parts.append(L10n.studyResultReturning(returning))
        }
        return parts.joined(separator: ", ")
    }

    /// What the sitting added to the deck, worn as the one green word.
    private func deltaPill(_ delta: Int) -> some View {
        Text(L10n.studyResultMasteryDelta(delta))
            .font(DesignTokens.Typography.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(Self.green)
            .padding(.horizontal, DesignTokens.Spacing.medium)
            .padding(.vertical, DesignTokens.Spacing.small)
            .background(Self.green.opacity(0.18), in: Capsule(style: .continuous))
            .overlay {
                Capsule(style: .continuous)
                    .strokeBorder(Self.green.opacity(0.4), lineWidth: 1)
            }
    }

    /// Every card of the sitting under one quiet word: a missed flag is
    /// slightly translucent and nothing more — a flag is content and is
    /// never desaturated. Spoken by the gauge's label, not repeated here.
    private var answers: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            // The deck's name, wearing the section word's type. Not
            // `SectionLabel`: that one pins itself to the leading edge, and
            // everything on this screen stands on the centre line.
            if !deckName.isEmpty {
                Text(deckName)
                    .font(DesignTokens.Typography.caption.weight(.semibold))
                    .kerning(DesignTokens.Typography.labelKerning)
                    .textCase(.uppercase)
                    .foregroundStyle(.white.opacity(0.5))
            }

            // Scrolls only when a fifty-card sitting outgrows the screen;
            // the usual five to twenty stand still.
            ScrollView(.vertical, showsIndicators: false) {
                CenteredFlow(spacing: DesignTokens.Spacing.small) {
                    ForEach(Array(summary.answered.enumerated()), id: \.offset) { _, card in
                        let missed = card.rating == .again || card.rating == .hard
                        FlagImageView(
                            assetID: card.promptAssetID,
                            accessibilityLabel: "",
                            store: store,
                            assets: assets
                        )
                        .frame(width: 40, height: 30)
                        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                        // The card's own hairline, at the card's own opacity:
                        // what keeps a white flag from dissolving.
                        .overlay {
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .strokeBorder(
                                    .white.opacity(DesignTokens.Card.borderOpacity),
                                    lineWidth: 1
                                )
                        }
                        .opacity(missed ? 0.55 : 1)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: SessionGauge.answersMaxHeight)
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityHidden(true)
    }
}

/// The measures of the approved mockup, taken as they are.
private enum SessionGauge {
    static let width: CGFloat = 330
    static let line: CGFloat = 10
    static let trackLine: CGFloat = 2.5
    /// The arc's box: its radius plus half the band over the apex.
    static let arcHeight: CGFloat = 160
    /// Five rows of flags; a longer sitting scrolls inside its box.
    static let answersMaxHeight: CGFloat = 182
}

/// The half-circle scale, swept by `fill` from the left end over the top.
private struct SessionGaugeArc: Shape {
    var fill: Double

    var animatableData: Double {
        get { fill }
        set { fill = newValue }
    }

    func path(in rect: CGRect) -> Path {
        guard fill > 0 else { return Path() }
        let radius = min(rect.width, rect.height * 2) / 2 - SessionGauge.line / 2
        var arc = Path()
        arc.addArc(
            center: CGPoint(x: rect.midX, y: rect.maxY),
            radius: radius,
            startAngle: .degrees(180),
            endAngle: .degrees(180 + 180 * min(fill, 1)),
            clockwise: false
        )
        return arc
    }
}

/// Rows of as many tiles as fit the width, every row centred — the last,
/// however short, included. `LazyVGrid` fills columns and leaves the tail
/// row hanging on the left; the flags read as one set, and a set is centred.
private struct CenteredFlow: Layout {
    let spacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) -> CGSize {
        let width = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var widestRow: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            let grown = rowWidth == 0 ? size.width : rowWidth + spacing + size.width
            if grown > width, rowWidth > 0 {
                totalHeight += (totalHeight == 0 ? 0 : spacing) + rowHeight
                widestRow = max(widestRow, rowWidth)
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth = grown
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += (totalHeight == 0 ? 0 : spacing) + rowHeight
        widestRow = max(widestRow, rowWidth)
        return CGSize(width: proposal.width ?? widestRow, height: totalHeight)
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        var index = 0
        var y = bounds.minY
        while index < subviews.count {
            var rowEnd = index
            var rowWidth: CGFloat = 0
            var rowHeight: CGFloat = 0
            while rowEnd < subviews.count {
                let size = subviews[rowEnd].sizeThatFits(.unspecified)
                let grown = rowWidth == 0 ? size.width : rowWidth + spacing + size.width
                if grown > bounds.width, rowWidth > 0 { break }
                rowWidth = grown
                rowHeight = max(rowHeight, size.height)
                rowEnd += 1
            }
            var x = bounds.minX + (bounds.width - rowWidth) / 2
            for i in index..<rowEnd {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(
                    at: CGPoint(x: x, y: y + (rowHeight - size.height) / 2),
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
            }
            y += rowHeight + spacing
            index = rowEnd
        }
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

/// The result screen's arrival: fade and settle, one step after another.
private struct SettledModifier: ViewModifier {
    let isSettled: Bool
    let step: Double
    let reduceMotion: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isSettled || reduceMotion ? 1 : 0)
            .offset(y: isSettled || reduceMotion ? 0 : 10)
            .animation(
                reduceMotion ? nil : .easeOut(duration: 0.4).delay(step * 0.08),
                value: isSettled
            )
    }
}

extension View {
    fileprivate func settled(_ isSettled: Bool, step: Double, reduceMotion: Bool) -> some View {
        modifier(SettledModifier(isSettled: isSettled, step: step, reduceMotion: reduceMotion))
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
