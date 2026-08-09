import SwiftUI

import CountryFlagsDomain

/// A flag and four countries, one of which is right.
public struct ObjectiveSessionView: View {
    @State private var runner: ObjectiveSessionRunner

    private let deckID: UUID
    private let size: StudySessionSize
    private let store: ContentStore
    private let assets: any AssetLoading
    private let onFinish: () -> Void

    public init(
        deckID: UUID,
        size: StudySessionSize,
        runner: ObjectiveSessionRunner,
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
            .navigationTitle(L10n.studyObjectiveTitle)
            .navigationBarTitleDisplayMode(.inline)
            .task { await runner.startOrResume(deckID: deckID, size: size) }
    }

    @ViewBuilder
    private var content: some View {
        if let summary = runner.summary {
            ObjectiveResultView(summary: summary, onDone: onFinish)
        } else if let failure = runner.startFailure {
            ObjectiveUnavailableView(failure: failure, onDone: onFinish)
        } else if let state = runner.state,
            let question = state.currentQuestion,
            let presentation = state.presentation
        {
            questionView(state: state, question: question, presentation: presentation)
        } else {
            ContentLoadingStateView()
        }
    }

    private func questionView(
        state: ObjectiveSessionState,
        question: ObjectiveQuestion,
        presentation: ObjectiveQuestionPresentation
    ) -> some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            Text(L10n.studyProgress(state.position, state.questions.count))
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.studyProgress)

            FlagImageView(
                assetID: question.promptAssetID,
                // The prompt never names the country, and VoiceOver must not
                // either: reading the answer out would settle the question
                // before the learner has chosen.
                accessibilityLabel: L10n.studyFlagPrompt,
                store: store,
                assets: assets
            )
            .frame(maxWidth: .infinity)
            .frame(height: 160)

            VStack(spacing: DesignTokens.Spacing.small) {
                ForEach(presentation.options) { option in
                    OptionButton(
                        option: option,
                        outcome: presentation.outcome(for: option),
                        isAnswered: presentation.isAnswered,
                        isBusy: state.isCommitting
                    ) {
                        Task { await runner.choose(optionID: option.id) }
                    }
                }
            }

            if presentation.isAnswered {
                Button(L10n.studyNext) {
                    Task { await runner.advance() }
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                .accessibilityIdentifier(AccessibilityIdentifier.studyNext)
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
    }
}

/// One answer.
///
/// The outcome is carried by an icon and a spoken label as well as a colour: a
/// learner who cannot tell the two colours apart still has to know which answer
/// was right.
struct OptionButton: View {
    let option: StudyOptionRecord
    let outcome: OptionOutcome
    let isAnswered: Bool
    let isBusy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.Spacing.small) {
                Text(option.displayName)
                    // A long country name wraps rather than truncating, and the
                    // row grows with it.
                    .font(DesignTokens.Typography.body)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let symbol {
                    Image(systemName: symbol)
                }
            }
            .padding(DesignTokens.Spacing.small)
            .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
            .frame(maxWidth: .infinity)
            .background(background, in: .rect(cornerRadius: DesignTokens.Radius.small))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // Every option locks once one is chosen: the answer is immutable.
        .disabled(isAnswered || isBusy)
        .accessibilityIdentifier(AccessibilityIdentifier.studyOption(option.position))
        .accessibilityLabel(accessibilityLabel)
    }

    private var symbol: String? {
        switch outcome {
        case .correct: "checkmark.circle.fill"
        case .incorrect: "xmark.circle.fill"
        case .undecided: nil
        }
    }

    private var background: some ShapeStyle {
        switch outcome {
        case .correct: AnyShapeStyle(.green.opacity(0.2))
        case .incorrect: AnyShapeStyle(.red.opacity(0.2))
        case .undecided: AnyShapeStyle(.quaternary)
        }
    }

    /// Before an answer the label is the country alone, so nothing in the
    /// accessibility tree distinguishes the right option from the others.
    private var accessibilityLabel: String {
        switch outcome {
        case .correct: L10n.studyOptionCorrect(option.displayName)
        case .incorrect: L10n.studyOptionIncorrect(option.displayName)
        case .undecided: option.displayName
        }
    }
}

struct ObjectiveResultView: View {
    let summary: ObjectiveSessionSummary
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Text(L10n.studyResultTitle)
                .font(DesignTokens.Typography.screenTitle)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultTitle)

            Text(L10n.studyObjectiveScore(summary.correctAnswers, summary.answeredQuestions))
                .font(DesignTokens.Typography.body)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)

            Button(L10n.studyResultDone, action: onDone)
                .buttonStyle(.borderedProminent)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
        }
        .padding(DesignTokens.Spacing.large)
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
    }
}

struct ObjectiveUnavailableView: View {
    let failure: ObjectiveStartFailure
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Text(title)
                .font(DesignTokens.Typography.sectionTitle)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier(AccessibilityIdentifier.studyUnavailable)
            Text(message)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(L10n.studyResultDone, action: onDone)
                .buttonStyle(.bordered)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
        }
        .padding(DesignTokens.Spacing.large)
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
    }

    private var title: String {
        switch failure {
        case .distractorPoolInsufficient: L10n.studyNoDistractorsTitle
        case .noUsableCards: L10n.studyNoCards
        case .storeUnavailable: L10n.studyStoreUnavailable
        }
    }

    private var message: String {
        switch failure {
        case .distractorPoolInsufficient: L10n.studyNoDistractorsMessage
        case .noUsableCards, .storeUnavailable: ""
        }
    }
}
