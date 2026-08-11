import SwiftUI

import CountryFlagsDomain

/// One self-rated card at a time: the flag, then the country, then a rating.
public struct StudySessionView: View {
    @State private var runner: StudySessionRunner
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let deckID: UUID
    private let size: StudySessionSize
    private let store: ContentStore
    private let assets: any AssetLoading
    private let onFinish: () -> Void

    public init(
        deckID: UUID,
        size: StudySessionSize,
        runner: StudySessionRunner,
        store: ContentStore,
        assets: any AssetLoading,
        onFinish: @escaping () -> Void
    ) {
        self.deckID = deckID
        self.size = size
        _runner = State(wrappedValue: runner)
        self.store = store
        self.assets = assets
        self.onFinish = onFinish
    }

    public var body: some View {
        content
            .navigationTitle(L10n.studyTitle)
            .navigationBarTitleDisplayMode(.inline)
            .task { await runner.startOrResume(deckID: deckID, size: size) }
    }

    @ViewBuilder
    private var content: some View {
        if let summary = runner.summary {
            StudySessionResultView(summary: summary, onDone: onFinish)
        } else if let failure = runner.startFailure {
            StudyUnavailableView(failure: failure, onDone: onFinish)
        } else if let state = runner.state, let card = state.currentCard {
            cardView(state: state, card: card)
        } else {
            ContentLoadingStateView()
        }
    }

    private func cardView(state: StudySessionState, card: StudySessionCardRecord) -> some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            Text(L10n.studyProgress(state.position, state.cards.count))
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.studyProgress)

            FlagImageView(
                assetID: card.promptAssetID,
                // Before the flip the label must not name the country, or
                // VoiceOver would answer the question for the learner.
                accessibilityLabel: state.isAnswerRevealed
                    ? card.displayName
                    : L10n.studyFlagPrompt,
                store: store,
                assets: assets
            )
            .frame(maxWidth: .infinity)
            .frame(height: 180)

            if state.isAnswerRevealed {
                Text(card.displayName)
                    .font(DesignTokens.Typography.screenTitle)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier(AccessibilityIdentifier.studyAnswer)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale))

                CardBackFactsView(learningCardID: card.learningCardID, store: store)
            }

            Spacer()

            if state.isAnswerRevealed {
                ratingButtons(disabled: state.isCommitting)
            } else {
                Button(L10n.studyReveal) {
                    runner.revealAnswer()
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                .accessibilityIdentifier(AccessibilityIdentifier.studyReveal)
            }

            if runner.lastCommitFailed {
                Text(L10n.studyNotSaved)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(AccessibilityIdentifier.studyNotSaved)
            }
        }
        .padding(DesignTokens.Spacing.large)
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
        // Reduce Motion replaces the flip with a plain change rather than
        // animating a smaller version of it.
        .animation(reduceMotion ? nil : .default, value: state.isAnswerRevealed)
    }

    private func ratingButtons(disabled: Bool) -> some View {
        HStack(spacing: DesignTokens.Spacing.small) {
            ForEach(StudyRating.allCases, id: \.self) { rating in
                Button(L10n.studyRating(rating)) {
                    Task { await runner.rate(rating) }
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity, minHeight: DesignTokens.Layout.minimumTouchTarget)
                // The buttons are disabled rather than hidden while a rating is
                // written, so a second tap lands on nothing and the layout does
                // not jump under the learner's finger.
                .disabled(disabled)
                .accessibilityIdentifier(AccessibilityIdentifier.studyRating(rating))
            }
        }
    }
}

struct StudySessionResultView: View {
    let summary: StudySessionSummary
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Text(L10n.studyResultTitle)
                .font(DesignTokens.Typography.screenTitle)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultTitle)

            // Counted from the reviews that were stored, so a session left
            // unfinished reports what really happened.
            Text(L10n.studyResultAnswered(summary.answeredCards, summary.plannedCards))
                .font(DesignTokens.Typography.body)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)

            ForEach(StudyRating.allCases, id: \.self) { rating in
                HStack {
                    Text(L10n.studyRating(rating))
                    Spacer()
                    Text("\(summary.ratings[rating] ?? 0)")
                }
                .font(DesignTokens.Typography.body)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultRating(rating))
            }

            Button(L10n.studyResultDone, action: onDone)
                .buttonStyle(.borderedProminent)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
        }
        .padding(DesignTokens.Spacing.large)
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
    }
}

struct StudyUnavailableView: View {
    let failure: StudySessionStartFailure
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Text(title)
                .font(DesignTokens.Typography.sectionTitle)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier(AccessibilityIdentifier.studyUnavailable)
            Button(L10n.studyResultDone, action: onDone)
                .buttonStyle(.bordered)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
        }
        .padding(DesignTokens.Spacing.large)
    }

    private var title: String {
        switch failure {
        case .noUsableCards: L10n.studyNoCards
        case .storeUnavailable: L10n.studyStoreUnavailable
        }
    }
}
