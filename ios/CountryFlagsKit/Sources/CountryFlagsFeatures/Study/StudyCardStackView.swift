import SwiftUI

import CountryFlagsDomain

/// The session as a stack of cards rather than one flag on a page.
///
/// The stack is the progress bar: it thins as the session goes, so how much is
/// left is visible without reading a number. Answering is a swipe — left is
/// "again", right is "good" — and the rating buttons underneath do the same
/// thing, because a gesture cannot be the only way to answer: VoiceOver has no
/// way to perform it, and the two ratings a swipe reaches are not all four.
///
/// A card can be answered without being turned over: recognising a flag on
/// sight is the case the deck exists for. Tapping turns it, either way, so the
/// answer can be checked and put back.
struct StudyCardStackView: View {
    let state: StudySessionState
    let store: ContentStore
    let assets: any AssetLoading
    /// The colours read off the flag: the scene wears them, and the back of
    /// the card wears them too.
    let palette: ScenePalette
    let onReveal: () -> Void
    let onRate: (StudyRating) -> Void
    let onDetails: () -> Void
    /// Which side is up. It lives with the screen rather than here because
    /// closing the details sheet turns the card back over, and the sheet is
    /// the screen's.
    @Binding var isShowingBack: Bool
    /// How far the throw has gone, -1...1, negative to the left. The screen
    /// reads it to light the hint the throw is heading for.
    @Binding var swipeProgress: CGFloat
    /// A throw asked for by a button rather than a finger. The card leaves
    /// the same way it would under a swipe — the rating buttons answer the
    /// card, and the card should visibly take the answer with it.
    @Binding var commandedThrow: StudyRating?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    // A hairline is one device pixel, whatever the screen: asking the
    // environment keeps it right on every device and in a preview.
    @Environment(\.displayScale) private var displayScale
    @State private var drag: CGSize = .zero

    var body: some View {
        // Time drives the breathing, not a toggled state: a repeat-forever
        // animation only carries the views alive when it started, so cards
        // dealt later stood still. A clock has no such memory — every card
        // that ever reaches the pile sways on its own phase.
        TimelineView(
            .animation(minimumInterval: 1 / 20, paused: reduceMotion)
        ) { context in
            ZStack {
                ForEach(visible.reversed(), id: \.card.id) { entry in
                    card(entry, at: context.date.timeIntervalSinceReferenceDate)
                }
            }
        }
        .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fit)
        .frame(maxWidth: .infinity)
        // A new card starts square to the screen, flag up, however the last
        // one left.
        .onChange(of: state.currentCard?.id) { _, _ in
            drag = .zero
            swipeProgress = 0
            isShowingBack = false
        }
        // A commit that fails hands the same card back, and the same card
        // means the reset above never fires — the card had already been thrown
        // off the screen and stayed there, out of reach. When the write ends
        // without advancing, the card returns to the hand — and the throw's
        // progress returns with it, or the swipe hint would stay lit and the
        // surfaced country name would stand revealed over an unanswered card.
        .onChange(of: state.isCommitting) { _, isCommitting in
            guard !isCommitting else { return }
            drag = .zero
            swipeProgress = 0
        }
        .onChange(of: commandedThrow) { _, rating in
            guard let rating else { return }
            commandedThrow = nil
            throwCard(rating)
        }
    }

    /// The button's version of the swipe: the card flies to the side its
    /// rating lives on — the two the swipe cannot reach leave with their
    /// neighbours, hard to the left with again, easy to the right with good.
    private func throwCard(_ rating: StudyRating) {
        guard !state.isCommitting else { return }
        if !state.isAnswerRevealed { onReveal() }
        let leavesRight = rating == .good || rating == .easy
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.35)) {
            drag.width =
                leavesRight
                ? DesignTokens.Card.leavingDistance : -DesignTokens.Card.leavingDistance
            swipeProgress = leavesRight ? 1 : -1
        }
        onRate(rating)
    }

    /// The top card and the ones still to come, nearest first.
    private var visible: [StackEntry] {
        guard let index = state.currentIndex else { return [] }
        let last = min(index + DesignTokens.Card.stackDepth, state.cards.count)
        guard index < last else { return [] }
        return (index..<last).enumerated().map { depth, cardIndex in
            StackEntry(depth: depth, card: state.cards[cardIndex])
        }
    }

    private struct StackEntry {
        let depth: Int
        let card: StudySessionCardRecord
    }

    @ViewBuilder
    private func card(_ entry: StackEntry, at time: TimeInterval = 0) -> some View {
        let isTop = entry.depth == 0
        let isTurned = isTop && isShowingBack

        ZStack {
            front(entry.card, isTurned: isTurned)
                .opacity(isTurned ? 0 : 1)

            // Created when the card turns rather than kept hidden behind the
            // front: the back carries the answer, and a hidden view is still in
            // the accessibility tree — a screen reader or a UI test could read
            // the country off a card that is face up.
            if isTurned {
                StudyCardBack(
                    card: entry.card,
                    store: store,
                    palette: palette,
                    onDetails: onDetails
                )
                // The back is drawn mirrored inside a view the flip has already
                // turned, so it reads the right way round when it arrives.
                .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background, in: shape)
        .clipShape(shape)
        .overlay {
            // Without this a predominantly white flag — Japan is the obvious
            // case — has no edge at all against the scene behind it.
            shape.strokeBorder(
                Color.primary.opacity(DesignTokens.Card.borderOpacity),
                lineWidth: 1 / displayScale
            )
        }
        .overlay {
            // The answer's colour rises from the side the throw is going —
            // green for "good", red for "again" — soft and translucent, so
            // the learner knows what the throw will say before letting go.
            if isTop, drag.width != 0 {
                let wash = min(abs(drag.width) / DesignTokens.Card.swipeThreshold, 1)
                shape
                    .fill(
                        LinearGradient(
                            colors: [
                                (drag.width > 0 ? Color.green : .red)
                                    .opacity(DesignTokens.Card.swipeWashOpacity * wash),
                                .clear,
                            ],
                            startPoint: drag.width > 0 ? .trailing : .leading,
                            endPoint: drag.width > 0 ? .leading : .trailing
                        )
                    )
                    .allowsHitTesting(false)
            }
        }
        .shadow(
            color: .black.opacity(DesignTokens.Card.shadowOpacity),
            radius: DesignTokens.Card.shadowRadius,
            y: DesignTokens.Card.shadowOffset
        )
        // The flip itself. Reduce Motion gets the change without the turn,
        // which the spec asks for by name.
        .rotation3DEffect(
            .degrees(reduceMotion ? 0 : (isTurned ? 180 : 0)),
            axis: (x: 0, y: 1, z: 0)
        )
        .scaleEffect(1 - DesignTokens.Card.stackScaleStep * CGFloat(entry.depth))
        // The waiting cards lie as if thrown: each leans and drifts its own
        // way, fixed by its identity so the pile holds still, and a card
        // straightens as it comes to the top — the same move a hand makes
        // picking a card off a pile.
        .offset(
            x: isTop
                ? drag.width
                : scatter(entry.card.id).drift + breath(entry.card.id, at: time).drift,
            y: DesignTokens.Card.stackOffset * CGFloat(entry.depth)
        )
        .rotationEffect(
            .degrees(
                isTop
                    ? drag.width * DesignTokens.Card.swipeRotation
                    : scatter(entry.card.id).lean + breath(entry.card.id, at: time).lean
            )
        )
        .zIndex(Double(DesignTokens.Card.stackDepth - entry.depth))
        // Only the card being answered is reachable; the ones behind it are
        // depth, not content.
        .accessibilityHidden(!isTop)
        // A container rather than one element. An identifier put on a plain
        // SwiftUI container is handed down to every descendant and overwrites
        // the ones they set for themselves — the flag, the answer and the
        // button on the back all became "study.card" and stopped being
        // addressable at all. Declaring the container keeps the identifier on
        // the card and leaves its contents their own.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(
            isTop ? AccessibilityIdentifier.studyCard : AccessibilityIdentifier.studyCardBehind
        )
        .allowsHitTesting(isTop)
        .onTapGesture { turn() }
        .gesture(isTop ? swipe : nil)
        .animation(reduceMotion ? nil : .snappy, value: drag)
        .animation(reduceMotion ? nil : .snappy, value: state.currentIndex)
        .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: isTurned)
    }

    /// The pose a waiting card holds, from its own identity.
    ///
    /// Read out of the identifier's bytes rather than drawn from a generator:
    /// the pose must survive re-renders, and two devices dealing the same
    /// session should see the same pile.
    private func scatter(_ id: UUID) -> (lean: Double, drift: CGFloat) {
        let bytes = id.uuid
        let lean = (Double(bytes.0) / 255 * 2 - 1) * DesignTokens.Card.scatterRotation
        let drift = (Double(bytes.1) / 255 * 2 - 1) * DesignTokens.Card.scatterOffset
        return (lean, CGFloat(drift))
    }

    /// This card's share of the pile's breathing at one instant: its own
    /// reach from its identity, its own phase so the pile never sways in
    /// lockstep, and the slow sine both directions ride.
    private func breath(_ id: UUID, at time: TimeInterval) -> (lean: Double, drift: CGFloat) {
        guard time > 0 else { return (0, 0) }
        let bytes = id.uuid
        let phase = Double(bytes.4) / 255 * 2 * .pi
        let swing = sin(time * (2 * .pi / 4) + phase)
        let lean = (Double(bytes.2) / 255 * 2 - 1) * DesignTokens.Card.breathRotation
        let drift = (Double(bytes.3) / 255 * 2 - 1) * Double(DesignTokens.Card.breathOffset)
        return (lean * swing, CGFloat(drift * swing))
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
    }

    private func front(_ card: StudySessionCardRecord, isTurned: Bool) -> some View {
        FlagCardFace(
            assetID: card.promptAssetID,
            accessibilityLabel: isTurned ? card.displayName : L10n.studyFlagPrompt,
            accessibilityHint: isTurned ? "" : L10n.studyCardHint,
            store: store,
            assets: assets
        )
    }

    /// Turning the card is also what first reveals the answer: the session
    /// records that it was shown, and after that the side that is up is a
    /// question of what the reader is looking at.
    private func turn() {
        if !state.isAnswerRevealed { onReveal() }
        isShowingBack.toggle()
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                guard !state.isCommitting else { return }
                drag = value.translation
                swipeProgress = max(
                    -1, min(1, value.translation.width / DesignTokens.Card.swipeThreshold)
                )
            }
            .onEnded { value in
                guard !state.isCommitting else { return finish(nil) }
                let distance = value.translation.width
                guard abs(distance) >= DesignTokens.Card.swipeThreshold else {
                    return finish(nil)
                }
                finish(distance > 0 ? .good : .again)
            }
    }

    private func finish(_ rating: StudyRating?) {
        guard let rating else {
            drag = .zero
            swipeProgress = 0
            return
        }
        // A card can be answered without being turned over: knowing a flag on
        // sight is the case the deck exists for, and asking for the answer
        // first would slow down exactly the person who does not need it. The
        // session still records that the answer was shown, because the rating
        // it stores belongs to a card the learner has now finished with.
        if !state.isAnswerRevealed { onReveal() }
        // The card leaves the way it was thrown, and the rating is written as
        // it goes: waiting for the animation would make the app feel slower
        // than the finger.
        drag.width = drag.width > 0 ? DesignTokens.Card.leavingDistance : -DesignTokens.Card.leavingDistance
        onRate(rating)
    }
}

/// The answer, on the card itself.
///
/// Deliberately short. The back is bounded by the flag's proportion, so what
/// lives here is what a learner needs in the second they answer: the country,
/// and the two facts that place it. Everything else is a tap away in a sheet,
/// which can grow when the type does and this cannot.
private struct StudyCardBack: View {
    let card: StudySessionCardRecord
    let store: ContentStore
    let palette: ScenePalette
    let onDetails: () -> Void

    @State private var facts: [FactRecord] = []
    @State private var officialName: String?
    @State private var outline: CountryBoundaries.Outline?

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
            VStack(alignment: .leading, spacing: 0) {
                Text(card.displayName)
                    .font(DesignTokens.Typography.cardAnswer)
                    .minimumScaleFactor(0.8)
                    .lineLimit(2)
                    .foregroundStyle(.white)
                    .accessibilityIdentifier(AccessibilityIdentifier.studyAnswer)

                // The official name is part of the answer — Iran and "Islamic
                // Republic of Iran" should meet here, not in a search later.
                if let officialName {
                    Text(officialName)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.65))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }

            // The same badges the details sheet deals, at card size: a symbol
            // on its own colour is scannable in the second the answer takes,
            // where a grey label next to a grey value was not. Three facts —
            // capital, population, currency — in the release's own order.
            ForEach(facts.prefix(3), id: \.self) { fact in
                let presentation = FactDisplay.presentation(for: fact)
                HStack(spacing: DesignTokens.Spacing.small) {
                    FactBadge(fact: fact)
                    VStack(alignment: .leading, spacing: 0) {
                        if let label = presentation.label {
                            Text(label)
                                .font(DesignTokens.Typography.caption)
                                .foregroundStyle(.white.opacity(0.6))
                        }
                        Text(presentation.value)
                            .font(DesignTokens.Typography.body.weight(.medium))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
                // One fact is one thing to hear, not a label and a value in
                // sequence — and combining them is also what lets the row carry
                // an identifier without handing it to both.
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AccessibilityIdentifier.studyFact(fact.type))
            }

            Spacer(minLength: 0)

            Button {
                onDetails()
            } label: {
                HStack(spacing: DesignTokens.Spacing.extraSmall) {
                    Text(L10n.studyDetails)
                    Image(systemName: "chevron.right")
                }
                .font(DesignTokens.Typography.caption.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, DesignTokens.Spacing.medium)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget * 0.75)
            }
            .buttonStyle(.plain)
            // A material, not glass: liquid glass morphs elastically when its
            // view moves, and this button rides a card that is thrown across
            // the screen — it swelled with every swipe. The card's surface is
            // content anyway, and content wears materials.
            .background(.ultraThinMaterial, in: Capsule(style: .continuous))
            .overlay {
                Capsule(style: .continuous)
                    .strokeBorder(.white.opacity(0.25), lineWidth: 1)
            }
            .accessibilityIdentifier(AccessibilityIdentifier.studyDetails)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(DesignTokens.Spacing.medium)
        // The flag's own colours, dimmed to a wash the type can sit on: the
        // answer belongs to the flag that asked, and a flat grey material
        // said it belonged to the system.
        .background {
            ZStack {
                LinearGradient(
                    colors: [
                        palette.primary.opacity(0.75),
                        palette.secondary.opacity(0.55),
                        Color.black.opacity(0.65),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Rectangle().fill(.ultraThinMaterial)

                // The country itself, as a watermark in the corner: the
                // exhibit's plate carries a small map of where it is from.
                if let outline {
                    CountrySilhouetteView(outline: outline, opacity: 0.1)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                        .padding(DesignTokens.Spacing.small)
                        .scaleEffect(0.62, anchor: .bottomTrailing)
                }
            }
        }
        .task(id: card.learningCardID) {
            let record = await store.card(id: card.learningCardID)
            facts = record?.backSideFacts ?? []
            officialName = await CountryOfficialNameLookup.officialName(
                forEntity: record?.subjectEntityID,
                displayName: card.displayName,
                store: store
            )
            outline = await CountryOutlineLookup.outline(
                forPromptAsset: card.promptAssetID, cardID: card.learningCardID, store: store
            )
        }
    }
}
