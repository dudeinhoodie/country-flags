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
            AppScene(palette: palette)

            content
            .task(id: deckID) { deckName = await store.deck(id: deckID)?.name ?? "" }
                .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
                .padding(DesignTokens.Spacing.large)
        }
        // The flag is the screen: the chrome shrinks to the counter and a way
        // out, both of which live on the scene rather than above it.
        .toolbar(.hidden, for: .navigationBar)
        // The flag is the screen: while a session runs, the tab bar leaves too.
        .toolbar(.hidden, for: .tabBar)
        .task { await runner.startOrResume(deckID: deckID, size: size, composition: composition) }
    }

    @ViewBuilder
    private var content: some View {
        if let summary = runner.summary {
            StudySessionResultView(
                summary: summary, store: store, assets: assets, onDone: onFinish
            )
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
                // Cubed, so the name belongs to the end of the gesture: a
                // quarter-swipe shows almost nothing, half shows a ghost, and
                // only a throw about to commit reads clearly. A release fades
                // it out; a card change above zeroes it before this runs.
                .onChange(of: swipeProgress) { _, progress in
                    if progress != 0 {
                        surfacedName = card.displayName
                        surfacedOpacity = pow(min(1, Double(abs(progress))), 3)
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

            if state.isAnswerRevealed {
                // The swipe reaches two of the four ratings; these reach all of
                // them, and they are the only way in for VoiceOver.
                ratingButtons(disabled: state.isCommitting)
            } else {
                // The button says it will show the answer, so it turns the
                // card over. Unlocking the ratings without turning it left the
                // learner looking at the same flag and no answer anywhere.
                //
                // Glass, not the white capsule: white is the scene's loudest
                // voice and belongs to the one action a screen recommends —
                // here that is answering the card, and this button is the way
                // to peek, sitting where the rating pane is about to appear.
                Button {
                    runner.revealAnswer()
                    isShowingBack = true
                } label: {
                    Label(L10n.studyReveal, systemImage: "arrow.2.squarepath")
                }
                    .buttonStyle(GlassActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.studyReveal)
            }
        }
        .animation(reduceMotion ? nil : .default, value: state.isAnswerRevealed)
        // The one this moment is given in docs/16, §6.
        .sensoryFeedback(.impact(flexibility: .soft), trigger: state.isAnswerRevealed) { _, revealed in
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
        HStack {
            Text(L10n.studyProgress(state.position, state.cards.count))
                .font(DesignTokens.Typography.caption.weight(.medium))
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(.white)
                .padding(.horizontal, DesignTokens.Spacing.medium)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget * 0.75)
                .glassEffect(.regular, in: Capsule())
                .accessibilityIdentifier(AccessibilityIdentifier.studyProgress)

            Spacer()

            if !deckName.isEmpty {
                Text(deckName)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.65))
                    .lineLimit(1)
                    .accessibilityIdentifier(AccessibilityIdentifier.studyDeckName)
            }

            Spacer()

            Button {
                onFinish()
            } label: {
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
    }

    private func loadPalette(for card: StudySessionCardRecord) async {
        guard let record = await store.asset(id: card.promptAssetID) else { return }
        palette = await FlagPaletteReader.palette(for: record, assets: assets) ?? .neutral
    }

    /// One pane of glass holding four targets rather than four floating
    /// buttons: the row is a single object the thumb learns the position of,
    /// and the material behind it belongs to the scene rather than to each
    /// button separately.
    private func ratingButtons(disabled: Bool) -> some View {
        // One bar, four words: separate glass buttons read as four floating
        // pills and broke the row into confetti — one pane holding four
        // targets is the object the thumb learns the position of.
        HStack(spacing: DesignTokens.Spacing.extraSmall) {
            ForEach(StudyRating.allCases, id: \.self) { rating in
                // The button does not rate directly: it asks the stack to
                // throw, and the throw rates — one path, so the card always
                // visibly takes the answer with it.
                Button {
                    commandedThrow = rating
                } label: {
                    Text(L10n.studyRating(rating))
                        .font(DesignTokens.Typography.body.weight(rating == .good ? .semibold : .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: DesignTokens.Layout.actionHeight)
                        .foregroundStyle(tint(for: rating))
                        // "Good" is the answer most cards get, so it is the
                        // one the thumb finds without aiming.
                        .background {
                            if rating == .good {
                                Capsule(style: .continuous).fill(.white)
                            }
                        }
                        .contentShape(Capsule(style: .continuous))
                }
                // The buttons are disabled rather than hidden while a rating is
                // written, so a second tap lands on nothing and the layout does
                // not jump under the learner's finger.
                .disabled(disabled)
                .accessibilityIdentifier(AccessibilityIdentifier.studyRating(rating))
            }
        }
        .padding(DesignTokens.Spacing.extraSmall)
        .glassEffect(.regular, in: Capsule(style: .continuous))
    }

    /// The rating's lean, worn quietly. Whitened well past pastel so the row
    /// stays one calm object; the word, not the colour, is the carrier.
    private func tint(for rating: StudyRating) -> Color {
        switch rating {
        case .again: Color.red.mix(with: .white, by: 0.55)
        case .hard: Color.orange.mix(with: .white, by: 0.6)
        case .good: .black
        case .easy: Color.green.mix(with: .white, by: 0.6)
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

struct StudySessionResultView: View {
    let summary: StudySessionSummary
    let store: ContentStore
    let assets: any AssetLoading
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hasArrived = false
    @State private var beamRevealed = false
    @State private var deltaRevealed = false
    @State private var deckName: String?

    /// The award family's gold — the same the celebration pulse and the
    /// delta's gained tail wear.
    static let gold = Color(red: 0.94, green: 0.82, blue: 0.55)

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            Spacer(minLength: 0)

            VStack(spacing: DesignTokens.Spacing.small) {
                Text(L10n.studyResultTitle)
                    .font(DesignTokens.Typography.caption)
                    .textCase(.uppercase)
                    .foregroundStyle(.white.opacity(0.7))
                    .accessibilityIdentifier(AccessibilityIdentifier.studyResultTitle)

                // The number is the screen. Everything else on it explains the
                // number.
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.extraSmall) {
                    Text("\(summary.answeredCards)")
                        .font(DesignTokens.Typography.resultScore)
                        .monospacedDigit()
                    Text("/ \(summary.plannedCards)")
                        .font(DesignTokens.Typography.sectionTitle)
                        .foregroundStyle(.white.opacity(0.55))
                }
                .foregroundStyle(.white)

                // The sentence stays for anyone reading rather than glancing,
                // and for the test that reads it.
                Text(L10n.studyResultAnswered(summary.answeredCards, summary.plannedCards))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.7))
                    .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)

                // The session, refracted: one beam under the score, split
                // into the answers' colours by their share. The screen's only
                // colour statement, standing on the scene rather than in a
                // pane — and a perfect session is a pure white beam.
                if summary.answeredCards > 0 {
                    SpectrumBeam(
                        segments: beamSegments,
                        total: summary.answeredCards,
                        revealed: beamRevealed
                    )
                    .padding(.top, DesignTokens.Spacing.small)
                }
            }
            .settled(hasArrived, step: 0, reduceMotion: reduceMotion)

            // What the sitting did to the deck: the level it stood at, and
            // the gained tail in gold. No gain, no gold — a review-only
            // session holds the thread steady rather than gilding nothing.
            if summary.deckTotal > 0 {
                DeckDeltaPane(
                    deckName: deckName,
                    before: summary.deckLearnedBefore,
                    after: summary.deckLearnedAfter,
                    total: summary.deckTotal,
                    revealed: deltaRevealed
                )
                .settled(hasArrived, step: 1, reduceMotion: reduceMotion)
            }

            // The flags themselves, back from the session in the order they
            // were answered, each underlined by what was said about it.
            if !summary.answered.isEmpty {
                answeredFlags
                    .settled(hasArrived, step: 2, reduceMotion: reduceMotion)
            }

            Spacer(minLength: 0)

            Button(L10n.studyResultDone, action: onDone)
                .buttonStyle(PrimaryActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
                .settled(hasArrived, step: 3, reduceMotion: reduceMotion)
        }
        .onAppear {
            hasArrived = true
            if reduceMotion {
                beamRevealed = true
                deltaRevealed = true
            } else {
                // The beam draws itself once the score has settled; the gold
                // extends once the beam has spoken.
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    beamRevealed = true
                    try? await Task.sleep(for: .milliseconds(450))
                    deltaRevealed = true
                }
            }
        }
        .task { deckName = await store.deck(id: summary.deckID)?.name }
        // Finishing is one of the two moments docs/16 gives a success
        // notification to.
        .sensoryFeedback(.success, trigger: hasArrived) { _, arrived in arrived }
    }

    /// The answers in the beam's reading order — sure to shaky — with the
    /// zeroes already gone.
    private var beamSegments: [(rating: StudyRating, count: Int)] {
        [StudyRating.good, .easy, .hard, .again].compactMap { rating in
            let count = summary.ratings[rating] ?? 0
            return count > 0 ? (rating, count) : nil
        }
    }

    private var answeredFlags: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 44), spacing: DesignTokens.Spacing.small)],
            spacing: DesignTokens.Spacing.small
        ) {
            ForEach(Array(summary.answered.enumerated()), id: \.offset) { _, card in
                VStack(spacing: 3) {
                    FlagImageView(
                        assetID: card.promptAssetID,
                        accessibilityLabel: "",
                        store: store,
                        assets: assets
                    )
                    .frame(width: 44, height: 33)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))

                    Capsule()
                        .fill(SpectrumBeam.tint(card.rating))
                        .frame(width: 20, height: 3)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// One beam of light, refracted into the session's answers by their share.
///
/// Three layers make it light rather than paint: a wide blurred halo, the
/// core, and a white sparkle blended over it. Colours meet in short blend
/// zones and the ends dissolve — the beam enters and leaves, it does not
/// stop. Each segment's count stands over its own span, tied to the beam by
/// a fading tick.
struct SpectrumBeam: View {
    let segments: [(rating: StudyRating, count: Int)]
    let total: Int
    let revealed: Bool

    var body: some View {
        VStack(spacing: 0) {
            labels
                .opacity(revealed ? 1 : 0)
                .animation(.easeOut(duration: 0.35).delay(0.3), value: revealed)

            beam
        }
    }

    private var labels: some View {
        GeometryReader { proxy in
            ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                let fraction = CGFloat(segment.count) / CGFloat(total)
                let centre = starts[index] + fraction / 2
                VStack(spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text("\(segment.count)")
                            .font(DesignTokens.Typography.body.weight(.semibold))
                            .monospacedDigit()
                        // The word only where it fits; a narrow sliver keeps
                        // its number and its colour says the rest.
                        if fraction > 0.24 {
                            Text(L10n.studyRating(segment.rating))
                                .font(DesignTokens.Typography.caption)
                                .opacity(0.85)
                        }
                    }
                    .foregroundStyle(Self.tint(segment.rating))
                    .lineLimit(1)
                    .fixedSize()

                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Self.tint(segment.rating).opacity(0),
                                    Self.tint(segment.rating).opacity(0.55),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: 1, height: 9)
                }
                .position(x: proxy.size.width * centre, y: 16)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultRating(segment.rating))
            }
        }
        .frame(height: 34)
    }

    private var beam: some View {
        ZStack {
            beamGradient
                .frame(height: 8)
                .blur(radius: 6)
                .opacity(0.55)
            beamGradient
                .frame(height: 3.5)
                .clipShape(Capsule())
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .white.opacity(0.7), location: 0.3),
                    .init(color: .white.opacity(0.45), location: 0.6),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(height: 1.2)
            .blendMode(.screen)
        }
        .frame(height: 12)
        .mask(alignment: .leading) {
            GeometryReader { proxy in
                Rectangle()
                    .frame(width: proxy.size.width * (revealed ? 1 : 0))
            }
        }
        .animation(.easeOut(duration: 0.6), value: revealed)
        .accessibilityHidden(true)
    }

    private var beamGradient: LinearGradient {
        LinearGradient(stops: stops, startPoint: .leading, endPoint: .trailing)
    }

    /// Cumulative segment starts, as fractions of the beam.
    private var starts: [CGFloat] {
        var out: [CGFloat] = []
        var running: CGFloat = 0
        for segment in segments {
            out.append(running)
            running += CGFloat(segment.count) / CGFloat(total)
        }
        return out
    }

    /// Colour stops with short refraction zones at each boundary and
    /// dissolving ends.
    private var stops: [Gradient.Stop] {
        let blend: CGFloat = 0.03
        let edge: CGFloat = 0.04
        var out: [Gradient.Stop] = [.init(color: .clear, location: 0)]
        var running: CGFloat = 0
        for (index, segment) in segments.enumerated() {
            let width = CGFloat(segment.count) / CGFloat(total)
            let colour = Self.tint(segment.rating)
            let from = index == 0 ? edge : running + blend
            let to = index == segments.count - 1 ? 1 - edge : running + width - blend
            out.append(.init(color: colour, location: max(from, running)))
            out.append(.init(color: colour, location: max(to, from)))
            running += width
        }
        out.append(.init(color: .clear, location: 1))
        return out
    }

    /// The answers' colours, shared with the flags' underlines: good is
    /// white — the scene's own emphasis — and the rest lean the way the
    /// swipe hints do.
    static func tint(_ rating: StudyRating) -> Color {
        switch rating {
        case .again: Color.red.mix(with: .white, by: 0.3)
        case .hard: Color.orange.mix(with: .white, by: 0.3)
        case .good: .white
        case .easy: Color.green.mix(with: .white, by: 0.3)
        }
    }
}

/// What the sitting did to the deck: the thread of its learned share, with
/// the gained tail in gold and the deck's name over it.
struct DeckDeltaPane: View {
    let deckName: String?
    let before: Int
    let after: Int
    let total: Int
    let revealed: Bool

    var body: some View {
        GlassCard(padding: DesignTokens.Spacing.medium) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.small) {
                    if let deckName {
                        Text(deckName)
                            .font(DesignTokens.Typography.sectionTitle)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                    }
                    Spacer(minLength: DesignTokens.Spacing.small)
                    caption
                }

                thread
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var caption: some View {
        HStack(spacing: 4) {
            if after > before {
                Text(L10n.studyResultLearnedFrom(before))
                    .foregroundStyle(.white.opacity(0.65))
                Text("\(after)")
                    .fontWeight(.bold)
                    .foregroundStyle(StudySessionResultView.gold)
            } else {
                Text(L10n.progressDeckLearned(after))
                    .foregroundStyle(.white.opacity(0.65))
            }
            Text(L10n.studyResultLearnedOf(total))
                .foregroundStyle(.white.opacity(0.65))
        }
        .font(DesignTokens.Typography.caption)
        .monospacedDigit()
        .lineLimit(1)
    }

    private var thread: some View {
        GeometryReader { proxy in
            let beforeFraction = total > 0 ? CGFloat(before) / CGFloat(total) : 0
            let afterFraction = total > 0 ? CGFloat(after) / CGFloat(total) : 0
            let shown = revealed ? afterFraction : beforeFraction
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.12))

                // The gained tail first, gold, reaching to the new level…
                if after > before {
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [
                                    .white.opacity(0.55), StudySessionResultView.gold,
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: proxy.size.width * shown)
                        .shadow(
                            color: StudySessionResultView.gold.opacity(revealed ? 0.45 : 0),
                            radius: 5
                        )
                }

                // …and the old level over it, so the gold shows only as the
                // part this sitting added.
                Capsule()
                    .fill(.white.opacity(0.55))
                    .frame(width: proxy.size.width * beforeFraction)

                if after > before {
                    Circle()
                        .fill(StudySessionResultView.gold)
                        .frame(width: 9, height: 9)
                        .shadow(color: StudySessionResultView.gold.opacity(0.7), radius: 5)
                        .offset(x: proxy.size.width * shown - 4.5)
                        .opacity(revealed ? 1 : 0)
                }
            }
            .animation(.easeOut(duration: 0.5), value: revealed)
        }
        .frame(height: 6)
    }
}
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
        case .noUsableCards: L10n.studyNoCards
        case .storeUnavailable: L10n.studyStoreUnavailable
        }
    }

    /// Shape as well as words: an empty deck and a store that will not open are
    /// different problems and should not look like the same one.
    private var symbol: String {
        switch failure {
        case .noUsableCards: "checkmark.circle"
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
