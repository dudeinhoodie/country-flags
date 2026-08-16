import SwiftUI

import CountryFlagsDomain

/// A flag and four countries, one of which is right.
public struct ObjectiveSessionView: View {
    @State private var runner: ObjectiveSessionRunner
    @State private var palette: ScenePalette = .neutral

    private let deckID: UUID
    /// The deck's own name, worn by the session. Identical flags fly over
    /// different countries — Heard Island under Australia's, Bonaire under
    /// the Dutch — and which answer is right can depend on which deck is
    /// asking. The context stays on screen rather than being remembered.
    @State private var deckName = ""
    private let size: StudySessionSize
    private let store: ContentStore
    private let assets: any AssetLoading
    private let onFinish: () -> Void

    @Environment(\.displayScale) private var displayScale

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
        ZStack {
            // The quiz is played on the same ground as the deck, lit by the
            // flag being asked about.
            AppScene(palette: palette)

            content
            .task(id: deckID) { deckName = await store.deck(id: deckID)?.name ?? "" }
                .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
                .padding(DesignTokens.Spacing.large)
        }
        .toolbar(.hidden, for: .navigationBar)
        // The flag is the screen: while a session runs, the tab bar leaves too.
        .toolbar(.hidden, for: .tabBar)
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
        } else if runner.state == nil {
            StudyLoadingView(onClose: onFinish)
        } else {
            // The beat between the last answer and the summary, held quiet for
            // the same reason as in the self-rated session.
            Color.clear
        }
    }

    private func questionView(
        state: ObjectiveSessionState,
        question: ObjectiveQuestion,
        presentation: ObjectiveQuestionPresentation
    ) -> some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            hud(state: state)

            FlagCardFace(
                assetID: question.promptAssetID,
                // The prompt never names the country, and VoiceOver must not
                // either: reading the answer out would settle the question
                // before the learner has chosen.
                accessibilityLabel: L10n.studyFlagPrompt,
                store: store,
                assets: assets
            )
            .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .background(.background, in: cardShape)
            .clipShape(cardShape)
            .overlay {
                cardShape.strokeBorder(
                    .white.opacity(DesignTokens.Card.borderOpacity),
                    lineWidth: 1 / displayScale
                )
            }
            .shadow(
                color: .black.opacity(DesignTokens.Card.shadowOpacity),
                radius: DesignTokens.Card.shadowRadius,
                y: DesignTokens.Card.shadowOffset
            )

            ScrollView {
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

                    if presentation.isAnswered {
                        CardBackFactsView(learningCardID: question.learningCardID, store: store)
                            .foregroundStyle(.white)
                    }
                }
            }
            .scrollIndicators(.hidden)

            if runner.lastCommitFailed {
                Text(L10n.studyNotSaved)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.75))
                    .accessibilityIdentifier(AccessibilityIdentifier.studyNotSaved)
            }

            if presentation.isAnswered {
                Button(L10n.studyNext) {
                    Task { await runner.advance() }
                }
                .buttonStyle(PrimaryActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.studyNext)
            }
        }
        .task(id: question.promptAssetID) { await loadPalette(for: question) }
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
    }

    /// The counter and the way out, the same pair the deck carries.
    private func hud(state: ObjectiveSessionState) -> some View {
        HStack {
            Text(L10n.studyProgress(state.position, state.questions.count))
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

            Button(action: onFinish) {
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

    private func loadPalette(for question: ObjectiveQuestion) async {
        guard let record = await store.asset(id: question.promptAssetID) else { return }
        palette = await FlagPaletteReader.palette(for: record, assets: assets) ?? .neutral
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

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.Spacing.small) {
                Text(option.displayName)
                    // A long country name wraps rather than truncating, and the
                    // row grows with it.
                    .font(DesignTokens.Typography.body.weight(.medium))
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let symbol {
                    Image(systemName: symbol)
                        .symbolRenderingMode(.hierarchical)
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, DesignTokens.Spacing.medium)
            .frame(minHeight: DesignTokens.Layout.actionHeight)
            .frame(maxWidth: .infinity)
            .glassEffect(.regular, in: shape)
            // The verdict is painted as an edge rather than a fill: a tinted
            // fill under a material turns into a wash the whole row wears, and
            // two of them side by side stop reading as two answers.
            .overlay {
                shape.strokeBorder(border, lineWidth: outcome == .undecided ? 1 / displayScale : 2)
            }
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        // Every option locks once one is chosen: the answer is immutable.
        .disabled(isAnswered || isBusy)
        .opacity(isAnswered && outcome == .undecided ? 0.5 : 1)
        .accessibilityIdentifier(AccessibilityIdentifier.studyOption(option.position))
        .accessibilityLabel(accessibilityLabel)
    }

    private var shape: Capsule { Capsule(style: .continuous) }

    private var symbol: String? {
        switch outcome {
        case .correct: "checkmark.circle.fill"
        case .incorrect: "xmark.circle.fill"
        case .undecided: nil
        }
    }

    private var border: some ShapeStyle {
        switch outcome {
        case .correct: AnyShapeStyle(.green)
        case .incorrect: AnyShapeStyle(.red)
        case .undecided: AnyShapeStyle(.white.opacity(DesignTokens.Card.borderOpacity))
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

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hasArrived = false

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            Spacer(minLength: 0)

            VStack(spacing: DesignTokens.Spacing.small) {
                Text(L10n.studyResultTitle)
                    .font(DesignTokens.Typography.caption)
                    .textCase(.uppercase)
                    .kerning(DesignTokens.Typography.labelKerning)
                    .foregroundStyle(.white.opacity(0.7))
                    .accessibilityIdentifier(AccessibilityIdentifier.studyResultTitle)

                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.extraSmall) {
                    Text("\(summary.correctAnswers)")
                        .font(DesignTokens.Typography.resultScore)
                        .monospacedDigit()
                    Text("/ \(summary.answeredQuestions)")
                        .font(DesignTokens.Typography.sectionTitle)
                        .foregroundStyle(.white.opacity(0.55))
                }
                .foregroundStyle(.white)
                .scaleEffect(hasArrived || reduceMotion ? 1 : 0.86)

                Text(L10n.studyObjectiveScore(summary.correctAnswers, summary.answeredQuestions))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.7))
                    .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)
            }

            Spacer(minLength: 0)

            Button(L10n.studyResultDone, action: onDone)
                .buttonStyle(PrimaryActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
        }
        .onAppear { hasArrived = true }
        .animation(reduceMotion ? nil : .bouncy(duration: 0.5), value: hasArrived)
        // Raised once, behind the number: the shower celebrates the deck,
        // and the summary stays readable through it.
        .background { CelebrationView() }
        .sensoryFeedback(.success, trigger: hasArrived) { _, arrived in arrived }
    }
}

struct ObjectiveUnavailableView: View {
    let failure: ObjectiveStartFailure
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

            if !message.isEmpty {
                Text(message)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.65))
                    .multilineTextAlignment(.center)
            }

            Spacer(minLength: 0)

            Button(L10n.studyResultDone, action: onDone)
                .buttonStyle(PrimaryActionStyle())
        }
    }

    /// Three different problems, three different shapes.
    private var symbol: String {
        switch failure {
        case .distractorPoolInsufficient: "square.stack.3d.up.slash"
        case .noUsableCards: "checkmark.circle"
        case .storeUnavailable: "exclamationmark.triangle"
        }
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
