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

            // The verdict is poured over the scene itself, not into the
            // padded column: green water rising to the share of remembered
            // answers, edge to edge.
            if let summary = runner.summary, summary.plannedCards > 0 {
                ResultWaterView(
                    fraction: Double(summary.rememberedCards)
                        / Double(summary.plannedCards)
                )
            }

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

/// The session's verdict, read off the waterline.
///
/// The scene fills with green water to the share of remembered answers — the
/// level is the result, and a perfect session reaches the brim. Over the
/// water only what the water cannot say: the two counts, the flags that were
/// answered with the misses dimmed, and the way out. Nothing is said twice.
struct StudySessionResultView: View {
    let summary: StudySessionSummary
    let store: ContentStore
    let assets: any AssetLoading
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hasArrived = false
    /// One soft tap per step of the pour, and a firmer one at the waterline.
    @State private var pourTick = 0
    @State private var hasFilled = false

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            score
                .settled(hasArrived, step: 0, reduceMotion: reduceMotion)
                .padding(.top, DesignTokens.Spacing.large)

            if !summary.answered.isEmpty {
                answeredFlags
                    .settled(hasArrived, step: 1, reduceMotion: reduceMotion)
            }

            Spacer(minLength: 0)

            Button(L10n.studyResultExcellent, action: onDone)
                .buttonStyle(PrimaryActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
                .settled(hasArrived, step: 2, reduceMotion: reduceMotion)
        }
        .onAppear {
            hasArrived = true
            if reduceMotion {
                hasFilled = true
            } else {
                // The pour is felt as much as seen: a soft tap per step of
                // the rise, then the firmer arrival at the waterline, timed
                // to the water view's 2.4-second fill.
                Task {
                    for _ in 0..<16 {
                        try? await Task.sleep(for: .milliseconds(150))
                        pourTick += 1
                    }
                    hasFilled = true
                }
            }
        }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.45), trigger: pourTick)
        .sensoryFeedback(.impact(weight: .medium, intensity: 1.0), trigger: hasFilled) {
            _, filled in filled
        }
    }

    /// "7 / 10", always: the remembered count over the session's size — the
    /// same fraction the water stands at.
    private var score: some View {
        HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.extraSmall) {
            Text("\(summary.rememberedCards)")
                .font(.system(size: 46, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
            Text(verbatim: "/ \(summary.plannedCards)")
                .font(.system(size: 30, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.5))
        }
        .monospacedDigit()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)
    }

    /// The answered flags on a dark pane so they read over saturated water:
    /// a remembered country carries a green mark, a missed one stands dimmed
    /// — the dimming is the app's own word for "not yet yours".
    private var answeredFlags: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 44), spacing: DesignTokens.Spacing.small)],
            spacing: DesignTokens.Spacing.small
        ) {
            ForEach(Array(summary.answered.enumerated()), id: \.offset) { _, card in
                let missed = card.rating == .again || card.rating == .hard
                VStack(spacing: 3) {
                    FlagImageView(
                        assetID: card.promptAssetID,
                        accessibilityLabel: "",
                        store: store,
                        assets: assets
                    )
                    .frame(width: 44, height: 33)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                    .saturation(missed ? 0.5 : 1)
                    .opacity(missed ? 0.45 : 1)

                    if !missed {
                        Capsule()
                            .fill(ResultWaterView.green.opacity(0.9))
                            .frame(width: 20, height: 3)
                    }
                }
            }
        }
        .padding(DesignTokens.Spacing.medium)
        .background(
            .black.opacity(0.25),
            in: RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                .strokeBorder(.white.opacity(0.14), lineWidth: 1)
        }
        .accessibilityHidden(true)
    }
}

/// The green water the finish screen stands in.
///
/// One Canvas shape — a sine surface over a filled body — so the waterline is
/// the water's own edge and can never split from it. Time drives everything:
/// the pour eases the level up over 2.4 seconds, then the surface keeps
/// drifting sideways under a slow swell, on the same clock that moves the
/// scene's lamps and sways the waiting cards.
struct ResultWaterView: View {
    /// The share of answers remembered, 0...1: the level the water settles at.
    let fraction: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var poursFrom = Date()

    static let green = Color(red: 143 / 255, green: 212 / 255, blue: 160 / 255)

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            Canvas { canvas, size in
                let time = context.date.timeIntervalSince(poursFrom)
                let poured = reduceMotion ? 1.0 : min(1, max(0, time / 2.4))
                // Ease-out into the level, and the brim is 90% of the
                // screen: even a perfect session leaves the score dry air.
                let level = fraction * 0.9 * (1 - pow(1 - poured, 3))
                guard level > 0.001 else { return }

                let drift = reduceMotion ? 0 : time * 0.55
                let swell = reduceMotion ? 0 : sin(time * 0.9) * 3.5
                let amplitude = reduceMotion ? 5.0 : 5 + 1.5 * sin(time * 0.6 + 1)
                let surfaceY = size.height * (1 - CGFloat(level)) + CGFloat(swell)
                let wavelength = max(size.width / 1.5, 1)

                func greenY(_ x: CGFloat) -> CGFloat {
                    let angle = Double(x / wavelength) * 2 * .pi + drift
                    return surfaceY + CGFloat(sin(angle) * amplitude)
                }
                let greyDrift = reduceMotion ? 0.9 : time * 0.4 + 2
                func greyY(_ x: CGFloat) -> CGFloat {
                    let angle = Double(x / wavelength) * 2 * .pi + greyDrift
                    return surfaceY - 8 + CGFloat(sin(angle) * amplitude * 1.25)
                }

                let step: CGFloat = 4
                let end = size.width + step

                // The grey swell trails the green wave on its own phase and
                // pace, and lives only where it rises above the green
                // surface — the water always overlaps the swell, never the
                // other way around. Its lower edge is clamped to the green
                // curve, so the band closes to nothing where the swell dips
                // under.
                var swellBand = Path()
                var x: CGFloat = 0
                while x <= end {
                    let point = CGPoint(x: x, y: min(greyY(x), greenY(x)))
                    if x == 0 { swellBand.move(to: point) } else { swellBand.addLine(to: point) }
                    x += step
                }
                x = end
                while x >= 0 {
                    swellBand.addLine(to: CGPoint(x: x, y: greenY(x)))
                    x -= step
                }
                swellBand.closeSubpath()
                canvas.fill(swellBand, with: .color(Color(white: 0.78).opacity(0.3)))

                var water = Path()
                x = 0
                while x <= end {
                    let point = CGPoint(x: x, y: greenY(x))
                    if x == 0 { water.move(to: point) } else { water.addLine(to: point) }
                    x += step
                }
                water.addLine(to: CGPoint(x: end, y: size.height))
                water.addLine(to: CGPoint(x: 0, y: size.height))
                water.closeSubpath()
                canvas.fill(
                    water,
                    with: .linearGradient(
                        Gradient(stops: [
                            .init(color: Self.green.opacity(0.28), location: 0),
                            .init(color: Self.green.opacity(0.1), location: 0.65),
                            .init(color: Self.green.opacity(0.07), location: 1),
                        ]),
                        startPoint: CGPoint(x: 0, y: surfaceY),
                        endPoint: CGPoint(x: 0, y: size.height)
                    )
                )
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
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
