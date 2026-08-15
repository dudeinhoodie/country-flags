import SwiftUI

import CountryFlagsDomain

/// One deck's progress, country by country.
///
/// The deck row said how many; this says which. Three groups, strongest
/// first: countries that graduated to REVIEW, countries still in the
/// learning steps, countries never answered. Each started country carries
/// when its schedule comes round — the same clock the repeat queue runs on.
public struct DeckProgressDetailsView: View {
    @State private var model: DeckDetailsModel
    @State private var states: [UUID: CardStateRecord] = [:]
    private let store: ContentStore
    private let assets: any AssetLoading
    private let makeProgress: (() -> ProgressStore)?
    private let dates: any DateProviding

    public init(
        deckID: UUID,
        store: ContentStore,
        assets: any AssetLoading,
        makeProgress: (() -> ProgressStore)? = nil,
        dates: any DateProviding = SystemDateProvider()
    ) {
        _model = State(wrappedValue: DeckDetailsModel(deckID: deckID, store: store))
        self.store = store
        self.assets = assets
        self.makeProgress = makeProgress
        self.dates = dates
    }

    public var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .task { await model.load() }
            // Re-read on every return: a session answered cards while this
            // screen was covered, and the groups have to move with it.
            .onAppear {
                guard let makeProgress else { return }
                Task { states = await makeProgress().cardStatesByID() }
            }
    }

    private var title: String {
        if case .ready(let details, _, _) = model.state, !details.deck.name.isEmpty {
            return details.deck.name
        }
        return L10n.progressTitle
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ContentLoadingStateView()
        case .empty:
            ContentUnavailableStateView(failure: nil) { await store.refresh() }
        case .failed(let failure):
            ContentUnavailableStateView(failure: failure) { await store.refresh() }
        case .ready(let details, _, _):
            loaded(details)
        }
    }

    private func loaded(_ details: DeckDetails) -> some View {
        let groups = grouped(details.cards)
        return SceneScrollView {
            group(L10n.progressLearnedLabel, cards: groups.learned)
            group(L10n.progressInProgressLabel, cards: groups.inProgress)
            group(L10n.progressNotStartedLabel, cards: groups.untouched)
        }
    }

    @ViewBuilder
    private func group(_ label: String, cards: [LearningCardRecord]) -> some View {
        if !cards.isEmpty {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.small) {
                    SectionLabel(label)
                    Text("\(cards.count)")
                        .font(DesignTokens.Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.5))
                }

                GlassCard(padding: DesignTokens.Spacing.small) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                            if index > 0 {
                                Divider()
                                    .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                                    .padding(.leading, DesignTokens.Layout.rowFlagWidth)
                            }
                            row(card)
                                .padding(.horizontal, DesignTokens.Spacing.small)
                        }
                    }
                }
            }
        }
    }

    private func row(_ card: LearningCardRecord) -> some View {
        HStack(spacing: DesignTokens.Spacing.medium) {
            CountryRow(card: card, store: store, assets: assets)

            if let caption = scheduleCaption(for: card) {
                Text(caption)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// When this country's schedule comes round, in words. A country never
    /// answered has no schedule and says nothing.
    private func scheduleCaption(for card: LearningCardRecord) -> String? {
        guard let state = states[card.id], state.state != "NEW" else { return nil }
        let now = dates.now()
        if state.dueAt <= now {
            return L10n.progressReviewDue
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return L10n.progressReviewAt(
            formatter.localizedString(for: state.dueAt, relativeTo: now)
        )
    }

    private func grouped(
        _ cards: [LearningCardRecord]
    ) -> (learned: [LearningCardRecord], inProgress: [LearningCardRecord], untouched: [LearningCardRecord]) {
        var learned: [LearningCardRecord] = []
        var inProgress: [LearningCardRecord] = []
        var untouched: [LearningCardRecord] = []
        for card in cards.sorted(by: { $0.displayName < $1.displayName }) {
            switch states[card.id]?.state {
            case "REVIEW":
                learned.append(card)
            case "LEARNING", "RELEARNING":
                inProgress.append(card)
            default:
                untouched.append(card)
            }
        }
        return (learned, inProgress, untouched)
    }
}
