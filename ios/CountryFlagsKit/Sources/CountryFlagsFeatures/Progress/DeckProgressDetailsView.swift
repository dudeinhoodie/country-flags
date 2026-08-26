import SwiftUI

import CountryFlagsDomain

/// One deck's progress, country by country.
///
/// Three shelves, strongest first, each scrolling sideways the way the App
/// Store lays out what it wants browsed: countries that graduated to REVIEW,
/// countries still in the learning steps, countries never answered. A flag is
/// the card — full colour once it is learned or being learned, drained to a
/// near-silhouette while nobody has touched it — and each started country
/// carries when its schedule comes round, on the same clock the repeat queue
/// runs on.
public struct DeckProgressDetailsView: View {
    @State private var model: DeckDetailsModel
    @State private var states: [UUID: CardStateRecord] = [:]
    @State private var selectedCountry: CountryDetailsSubject?
    private let deckID: UUID
    private let store: ContentStore
    private let assets: any AssetLoading
    private let progress: ProgressStore?
    private let makeSettings: (() -> SettingsStore)?
    private let onStartStudy: ((UUID, StudySessionSize) -> Void)?
    private let dates: any DateProviding
    @State private var sessionSize = StudySessionSize.ten

    @Environment(\.displayScale) private var displayScale

    public init(
        deckID: UUID,
        store: ContentStore,
        assets: any AssetLoading,
        progress: ProgressStore? = nil,
        makeSettings: (() -> SettingsStore)? = nil,
        onStartStudy: ((UUID, StudySessionSize) -> Void)? = nil,
        dates: any DateProviding = SystemDateProvider()
    ) {
        _model = State(wrappedValue: DeckDetailsModel(deckID: deckID, store: store))
        self.deckID = deckID
        self.store = store
        self.assets = assets
        self.progress = progress
        self.makeSettings = makeSettings
        self.onStartStudy = onStartStudy
        self.dates = dates
    }

    public var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .task { await model.load() }
            // Keyed to the store's rows: the app refreshes them centrally
            // after a session, and the shelves move with them.
            .task(id: progress?.decks) {
                guard let progress else { return }
                states = await progress.cardStatesByID()
            }
            // The learner's own size setting, read once: the screen shows
            // where the deck stands, and the button starts the next sitting.
            .task {
                guard let makeSettings else { return }
                let settings = makeSettings()
                await settings.load()
                sessionSize = StudySessionSize(storedValue: settings.settings.sessionSize)
            }

            // The same sheet a card opens mid-session: one country, one
            // surface, whoever asks.
            .sheet(item: $selectedCountry) { subject in
                CountryDetailsSheet(subject: subject, store: store, assets: assets)
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
            shelf(L10n.progressLearnedLabel, cards: groups.learned, dimmed: false)
            shelf(L10n.progressInProgressLabel, cards: groups.inProgress, dimmed: false)
            shelf(L10n.progressNotStartedLabel, cards: groups.untouched, dimmed: true)
        }
        // The action rides with the thumb rather than at the top of two
        // hundred flags: this screen is scrolled, and a button that scrolls
        // away is a button you have to go back for.
        //
        // Glass on nothing, but lit: the strip of frosted backing drew a seam
        // across the scene that belonged to no part of the layout, and plain
        // glass over a shelf of flags took their colour and disappeared. A
        // tinted pane keeps both — the flags pass behind, the button stays.
        .safeAreaInset(edge: .bottom) {
            if let onStartStudy {
                Button(L10n.studyStart) {
                    onStartStudy(deckID, sessionSize)
                }
                .buttonStyle(GlassProminentActionStyle())
                .padding(.horizontal, DesignTokens.Spacing.medium)
                // Twice the gap it had: sitting one notch above the tab bar,
                // the two glass surfaces read as one bar with a seam in it.
                .padding(.bottom, DesignTokens.Spacing.medium)
            }
        }
    }

    @ViewBuilder
    private func shelf(_ label: String, cards: [LearningCardRecord], dimmed: Bool) -> some View {
        if !cards.isEmpty {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.small) {
                    SectionLabel(label)
                    Text("\(cards.count)")
                        .font(DesignTokens.Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.5))
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: DesignTokens.Spacing.small) {
                        ForEach(cards, id: \.id) { card in
                            Button {
                                selectedCountry = CountryDetailsSubject(card: card)
                            } label: {
                                tile(card, dimmed: dimmed)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                // The shelf scrolls under the screen's own margins so a card
                // half-way off is cut by the edge of the display, not by an
                // invisible wall inside it.
                .padding(.horizontal, -DesignTokens.Spacing.medium)
                .contentMargins(.horizontal, DesignTokens.Spacing.medium, for: .scrollContent)
            }
        }
    }

    private func tile(_ card: LearningCardRecord, dimmed: Bool) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
            FlagImageView(
                assetID: card.promptAssetID,
                accessibilityLabel: card.displayName,
                store: store,
                assets: assets
            )
            .frame(width: Self.tileWidth, height: Self.tileWidth * 3 / 4)
            .clipShape(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
            )
            // The same hairline the deck cards get, for the same reason: a
            // mostly white flag has no edge of its own.
            .overlay {
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
                    .strokeBorder(
                        .white.opacity(DesignTokens.Card.borderOpacity),
                        lineWidth: 1 / displayScale
                    )
            }
            // An untouched country is present but not yet in play: colour is
            // what studying earns it.
            .saturation(dimmed ? 0.25 : 1)
            .opacity(dimmed ? 0.55 : 1)

            Text(card.displayName)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(dimmed ? 0.55 : 1))
                .lineLimit(1)

            if let caption = scheduleCaption(for: card) {
                Text(caption)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)
            }
        }
        .frame(width: Self.tileWidth, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private static let tileWidth: CGFloat = 132

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
