import SwiftUI

import CountryFlagsDomain

/// One self-rated card at a time: the flag, then the country, then a rating.
public struct StudySessionView: View {
    @State private var runner: StudySessionRunner
    @State private var palette: FlagPalette = .neutral
    @State private var isShowingDetails = false
    @State private var isShowingBack = false
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
        ZStack {
            // The ground belongs to the session rather than to one of its
            // states: it stays put while the session loads, is answered and
            // ends, so nothing flashes white between them.
            StudyScene(palette: palette)

            content
                .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
                .padding(DesignTokens.Spacing.large)
        }
        // The flag is the screen: the chrome shrinks to the counter and a way
        // out, both of which live on the scene rather than above it.
        .toolbar(.hidden, for: .navigationBar)
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
            StudyLoadingView(onClose: onFinish)
        }
    }

    private func cardView(state: StudySessionState, card: StudySessionCardRecord) -> some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            hud(state: state)

            Spacer(minLength: 0)

            StudyCardStackView(
                state: state,
                store: store,
                assets: assets,
                onReveal: { runner.revealAnswer() },
                onRate: { rating in Task { await runner.rate(rating) } },
                onDetails: { isShowingDetails = true },
                isShowingBack: $isShowingBack
            )

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
                Button(L10n.studyReveal) { runner.revealAnswer() }
                    .font(DesignTokens.Typography.body.weight(.semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: DesignTokens.Layout.actionHeight)
                    .background(.white, in: Capsule())
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
            StudyDetailsSheet(card: card, store: store, assets: assets)
        }
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
                .background(.ultraThinMaterial, in: Capsule())
                .accessibilityIdentifier(AccessibilityIdentifier.studyProgress)

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
                    .background(.ultraThinMaterial, in: Circle())
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
        HStack(spacing: DesignTokens.Spacing.extraSmall) {
            ForEach(StudyRating.allCases, id: \.self) { rating in
                Button {
                    Task { await runner.rate(rating) }
                } label: {
                    VStack(spacing: DesignTokens.Spacing.extraSmall) {
                        Image(systemName: symbol(for: rating))
                            .font(DesignTokens.Typography.body)
                            .symbolRenderingMode(.hierarchical)
                        Text(L10n.studyRating(rating))
                            .font(DesignTokens.Typography.caption)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: DesignTokens.Layout.actionHeight)
                    // "Good" is the answer most cards get, so it is the one the
                    // thumb finds without aiming.
                    .foregroundStyle(rating == .good ? .black : .white)
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
        .background(.ultraThinMaterial, in: Capsule(style: .continuous))
        .overlay {
            Capsule(style: .continuous)
                .strokeBorder(.white.opacity(DesignTokens.Card.borderOpacity), lineWidth: 1)
        }
    }

    /// Shape as well as word: the spec forbids colour as the only carrier, and
    /// a symbol is what a hand reaches for before it reads.
    private func symbol(for rating: StudyRating) -> String {
        switch rating {
        case .again: "arrow.counterclockwise"
        case .hard: "tortoise"
        case .good: "checkmark"
        case .easy: "hare"
        }
    }
}

struct StudySessionResultView: View {
    let summary: StudySessionSummary
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
                .scaleEffect(hasArrived || reduceMotion ? 1 : 0.86)

                // The sentence stays for anyone reading rather than glancing,
                // and for the test that reads it.
                Text(L10n.studyResultAnswered(summary.answeredCards, summary.plannedCards))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.7))
                    .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)
            }

            distribution

            Spacer(minLength: 0)

            Button(L10n.studyResultDone, action: onDone)
                .font(DesignTokens.Typography.body.weight(.semibold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .frame(minHeight: DesignTokens.Layout.actionHeight)
                .background(.white, in: Capsule(style: .continuous))
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
        }
        .onAppear { hasArrived = true }
        .animation(reduceMotion ? nil : .bouncy(duration: 0.5), value: hasArrived)
        // Finishing is one of the two moments docs/16 gives a success
        // notification to.
        .sensoryFeedback(.success, trigger: hasArrived) { _, arrived in arrived }
    }

    /// How the session went, rating by rating.
    ///
    /// Bars rather than a list of numbers: which way a session leaned is a
    /// shape, and reading four numbers to find it is work the screen can do.
    private var distribution: some View {
        VStack(spacing: DesignTokens.Spacing.small) {
            ForEach(StudyRating.allCases, id: \.self) { rating in
                let count = summary.ratings[rating] ?? 0
                HStack(spacing: DesignTokens.Spacing.small) {
                    Text(L10n.studyRating(rating))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.8))
                        .frame(width: DesignTokens.Layout.ratingLabelWidth, alignment: .leading)

                    GeometryReader { proxy in
                        Capsule()
                            .fill(.white.opacity(rating == .good ? 0.9 : 0.45))
                            .frame(width: proxy.size.width * fraction(count))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: DesignTokens.Spacing.small)

                    Text("\(count)")
                        .font(DesignTokens.Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .frame(width: DesignTokens.Spacing.large, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultRating(rating))
            }
        }
        .padding(DesignTokens.Spacing.medium)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous))
    }

    private func fraction(_ count: Int) -> CGFloat {
        let highest = summary.ratings.values.max() ?? 0
        guard highest > 0 else { return 0 }
        return CGFloat(count) / CGFloat(highest)
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
                .font(DesignTokens.Typography.body.weight(.semibold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .frame(minHeight: DesignTokens.Layout.actionHeight)
                .background(.white, in: Capsule(style: .continuous))
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
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(DesignTokens.Typography.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(
                            width: DesignTokens.Layout.minimumTouchTarget,
                            height: DesignTokens.Layout.minimumTouchTarget
                        )
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel(L10n.studyClose)
                .accessibilityIdentifier(AccessibilityIdentifier.studyClose)
            }

            Spacer(minLength: 0)

            RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                .fill(.ultraThinMaterial)
                .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(L10n.contentLoading)
                .accessibilityIdentifier(AccessibilityIdentifier.contentLoadingLabel)

            Spacer(minLength: 0)

            Capsule()
                .fill(.ultraThinMaterial)
                .frame(height: DesignTokens.Layout.actionHeight)
        }
    }
}
