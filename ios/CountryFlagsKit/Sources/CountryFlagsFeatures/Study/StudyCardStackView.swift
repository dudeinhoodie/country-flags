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
/// A card cannot be answered before it is turned over. A swipe on a card whose
/// answer is still hidden reveals it instead of grading it, since a rating
/// given without seeing the answer would be a rating of nothing.
struct StudyCardStackView: View {
    let state: StudySessionState
    let store: ContentStore
    let assets: any AssetLoading
    let onReveal: () -> Void
    let onRate: (StudyRating) -> Void

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
        // A new card starts square to the screen however the last one left.
        .onChange(of: state.currentCard?.id) { _, _ in drag = .zero }
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

        FlagImageView(
            assetID: entry.card.promptAssetID,
            // Before the answer is revealed the label must not name the
            // country, or VoiceOver would answer the question for the learner.
            accessibilityLabel: isTop && state.isAnswerRevealed
                ? entry.card.displayName
                : L10n.studyFlagPrompt,
            store: store,
            assets: assets
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
        .clipShape(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
        )
        .overlay {
            // Without this a predominantly white flag — Japan is the obvious
            // case — has no edge at all against the page behind it.
            RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                .strokeBorder(
                    Color.primary.opacity(DesignTokens.Card.borderOpacity),
                    lineWidth: 1 / displayScale
                )
        }
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
        .onTapGesture { if !state.isAnswerRevealed { onReveal() } }
        .gesture(isTop ? swipe : nil)
        .animation(reduceMotion ? nil : .snappy, value: drag)
        .animation(reduceMotion ? nil : .snappy, value: state.currentIndex)
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                guard state.isAnswerRevealed, !state.isCommitting else { return }
                drag = value.translation
            }
            .onEnded { value in
                guard state.isAnswerRevealed else {
                    // Turning the card over is what a swipe means before there
                    // is anything to grade.
                    onReveal()
                    drag = .zero
                    return
                }
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
        // The card leaves the way it was thrown, and the rating is written as
        // it goes: waiting for the animation would make the app feel slower
        // than the finger.
        drag.width = drag.width > 0 ? leavingDistance : -leavingDistance
        onRate(rating)
    }

    /// Far enough that the card is gone whatever the screen width.
    private var leavingDistance: CGFloat { 900 }
}
