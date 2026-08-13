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
    let onReveal: () -> Void
    let onRate: (StudyRating) -> Void
    let onDetails: () -> Void
    /// Which side is up. It lives with the screen rather than here because
    /// closing the details sheet turns the card back over, and the sheet is
    /// the screen's.
    @Binding var isShowingBack: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    // A hairline is one device pixel, whatever the screen: asking the
    // environment keeps it right on every device and in a preview.
    @Environment(\.displayScale) private var displayScale
    @State private var drag: CGSize = .zero

    var body: some View {
        ZStack {
            ForEach(visible.reversed(), id: \.card.id) { entry in
                card(entry)
            }
        }
        .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fit)
        .frame(maxWidth: .infinity)
        // A new card starts square to the screen, flag up, however the last
        // one left.
        .onChange(of: state.currentCard?.id) { _, _ in
            drag = .zero
            isShowingBack = false
        }
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
    private func card(_ entry: StackEntry) -> some View {
        let isTop = entry.depth == 0
        let isTurned = isTop && isShowingBack

        ZStack {
            front(entry.card, isTurned: isTurned)
                .opacity(isTurned ? 0 : 1)

            if isTop {
                StudyCardBack(
                    card: entry.card,
                    store: store,
                    onDetails: onDetails
                )
                .opacity(isTurned ? 1 : 0)
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
        .offset(
            x: isTop ? drag.width : 0,
            y: DesignTokens.Card.stackOffset * CGFloat(entry.depth)
        )
        .rotationEffect(.degrees(isTop ? drag.width * DesignTokens.Card.swipeRotation : 0))
        .zIndex(Double(DesignTokens.Card.stackDepth - entry.depth))
        // Only the card being answered is reachable; the ones behind it are
        // depth, not content.
        .accessibilityHidden(!isTop)
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

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
    }

    private func front(_ card: StudySessionCardRecord, isTurned: Bool) -> some View {
        ZStack {
            // Flags are not all 3:2 — Switzerland is square, Sweden and Brazil
            // are neither — so a card of one shape leaves bars beside them. The
            // bars are filled with the flag itself, out of focus: the card
            // reads as full and the flag on top is still whole. Cropping the
            // flag to fit would make it a different flag, which the spec
            // forbids in as many words.
            FlagImageView(
                assetID: card.promptAssetID,
                accessibilityLabel: "",
                store: store,
                assets: assets,
                contentMode: .fill
            )
            .blur(radius: DesignTokens.Card.groundBlur)
            .opacity(DesignTokens.Card.groundOpacity)
            .accessibilityHidden(true)

            FlagImageView(
                assetID: card.promptAssetID,
                // Before the answer is out the label must not name the country,
                // or VoiceOver would answer the question for the learner.
                accessibilityLabel: isTurned ? card.displayName : L10n.studyFlagPrompt,
                store: store,
                assets: assets
            )
            .accessibilityHint(isTurned ? "" : L10n.studyCardHint)
        }
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
    let onDetails: () -> Void

    @State private var facts: [FactRecord] = []

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            Text(card.displayName)
                .font(DesignTokens.Typography.cardAnswer)
                .minimumScaleFactor(0.8)
                .lineLimit(2)
                .accessibilityIdentifier(AccessibilityIdentifier.studyAnswer)

            ForEach(facts.prefix(2), id: \.self) { fact in
                HStack(spacing: DesignTokens.Spacing.small) {
                    if let name = L10n.factType(fact.type) {
                        Text(name)
                            .foregroundStyle(.secondary)
                    }
                    Text(fact.displayValue)
                        .fontWeight(.medium)
                }
                .font(DesignTokens.Typography.caption)
            }

            Spacer(minLength: 0)

            Button(L10n.studyDetails) { onDetails() }
                .font(DesignTokens.Typography.caption.weight(.semibold))
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .accessibilityIdentifier(AccessibilityIdentifier.studyDetails)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(DesignTokens.Spacing.medium)
        .background(.regularMaterial)
        .task(id: card.learningCardID) {
            facts = await store.card(id: card.learningCardID)?.backSideFacts ?? []
        }
    }
}
