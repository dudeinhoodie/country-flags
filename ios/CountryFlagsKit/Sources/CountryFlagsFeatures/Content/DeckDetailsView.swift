import SwiftUI

import CountryFlagsDomain

/// One deck: what it is, how big it is, and what is in it.
///
/// Built around starting a session. The size, the mode and the button are one
/// card at the top; the countries are underneath, for the learner who wants to
/// know what they are about to be asked before they are asked it.
public struct DeckDetailsView: View {
    @State private var model: DeckDetailsModel
    @State private var sessionSize: StudySessionSize
    @State private var mode: StudyAnswerMode = .selfRated
    /// Whether the stored preferences were read. Once, before the pickers are
    /// worth touching; never again, so a choice made on this screen wins over
    /// a setting that arrives late.
    @State private var didApplyStoredPreferences = false
    /// The unfinished session in this deck, when there is one. While it
    /// exists, the pickers would lie — the runner resumes the stored session
    /// whatever they say — so the card offers the way back instead.
    /// The unfinished session, when it belongs to this deck. Read from the
    /// app's progress store rather than loaded here: the store is refreshed
    /// centrally after a session ends, so the offer disappears on its own.
    private var continuable: ContinuableSession? {
        guard let session = progress?.continuable, session.deckID == deckID else { return nil }
        return session
    }
    /// The country whose drawer is open. The same sheet the session shows on
    /// the back of a card: a learner browsing a deck asks the same question
    /// about a flag as a learner answering one, and should not get a second,
    /// lesser answer for having asked it here.
    @State private var selectedCountry: CountryDetailsSubject?
    @Environment(\.displayScale) private var displayScale
    private let deckID: UUID
    private let store: ContentStore
    private let assets: any AssetLoading
    private let makeSettings: (() -> SettingsStore)?
    private let progress: ProgressStore?
    private let isObjectiveModeEnabled: Bool
    private let onStartStudy: ((UUID, StudySessionSize, StudyAnswerMode) -> Void)?
    /// Commerce, when this build has any. Nil is a deck screen that has never
    /// heard of money — every free deck, every preview, and every build made
    /// without a store — and it behaves exactly as it did before paid decks
    /// existed.
    private let commerce: CommerceCenter?
    /// Where a guest goes to get an account, because a purchase needs one to
    /// be granted to.
    private let onSignIn: (() -> Void)?

    public init(
        deckID: UUID,
        store: ContentStore,
        assets: any AssetLoading,
        defaultSessionSize: StudySessionSize = .ten,
        makeSettings: (() -> SettingsStore)? = nil,
        progress: ProgressStore? = nil,
        isObjectiveModeEnabled: Bool = false,
        commerce: CommerceCenter? = nil,
        onSignIn: (() -> Void)? = nil,
        onStartStudy: ((UUID, StudySessionSize, StudyAnswerMode) -> Void)? = nil
    ) {
        _model = State(wrappedValue: DeckDetailsModel(deckID: deckID, store: store))
        _sessionSize = State(wrappedValue: defaultSessionSize)
        self.deckID = deckID
        self.store = store
        self.assets = assets
        self.makeSettings = makeSettings
        self.progress = progress
        self.isObjectiveModeEnabled = isObjectiveModeEnabled
        self.commerce = commerce
        self.onSignIn = onSignIn
        self.onStartStudy = onStartStudy
    }

    public var body: some View {
        Group {
            switch presentation {
            case .paywall(let deck):
                paywall(deck)
            case .owned(let deck, let cards):
                owned(deck, cards: cards)
            case .standard:
                standard
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selectedCountry) { subject in
            CountryDetailsSheet(subject: subject, store: store, assets: assets)
                // One place for every way into the sheet — the free deck's
                // list, the owned deck's list, a search result — so a kind
                // that is looked at is counted wherever it was tapped.
                .task(id: subject.cardID) {
                    await store.recordCardDetailOpened(promptAssetID: subject.promptAssetID)
                }
        }
        .task { await model.load() }
        // Which of the two commerce screens this became, once the deck is
        // known. Both report once per deck: `task` re-runs whenever a purchase
        // changes the screen underneath, and a funnel counting that would be
        // counting SwiftUI rather than people.
        .task(id: model.deck?.id) { await reportOpened() }
        // A purchase that has just landed replaces the paywall with the deck,
        // on this screen, without a pop and without a relaunch: the keys
        // moved, the cards were fetched, and the deck is re-read here.
        .task(id: commerce?.entitlementKeys) { await model.load() }
        // The learner chose a session size once, in the settings; a deck
        // that ignored it and always offered ten would make that setting
        // a lie. Read once per visit, before anything is tapped.
        .task {
            guard let makeSettings, !didApplyStoredPreferences else { return }
            let settings = makeSettings()
            await settings.load()
            guard !didApplyStoredPreferences else { return }
            didApplyStoredPreferences = true
            sessionSize = StudySessionSize(storedValue: settings.settings.sessionSize)
            // The stored mode is applied only where the mode can be seen
            // and changed: with the flag off there is no picker, and a
            // quiz nobody asked for on this screen must not start.
            if isObjectiveModeEnabled,
                let stored = StudyAnswerMode(rawValue: settings.settings.defaultAnswerMode) {
                mode = stored
            }
        }
    }

    /// Which of the three screens this deck is.
    ///
    /// Derived rather than stored, so a purchase settling under an open screen
    /// moves it: `CommerceCenter` is observed, and the answer to `isOpen`
    /// changes the moment the keys do.
    private enum Presentation {
        /// A deck that has to be bought and has not been.
        case paywall(DeckRecord)
        /// A deck that was bought. Not the same screen as a free one: it
        /// carries the compact hero the design approved and the emblem names
        /// beside the countries.
        case owned(DeckRecord, [LearningCardRecord])
        /// Everything else, which is every deck the app has ever shown.
        case standard
    }

    private var presentation: Presentation {
        guard let commerce, let deck = model.deck, deck.isSold else { return .standard }
        return commerce.isOpen(deck)
            ? .owned(deck, model.visibleCards)
            : .paywall(deck)
    }

    // MARK: - The three screens

    /// The deck screen the app has always had, unchanged.
    private var standard: some View {
        content
            .navigationTitle(title)
            .searchable(text: searchBinding, prompt: L10n.deckSearchPrompt)
            .refreshable {
                await RefreshGesture.perform {
                    await store.refresh()
                    await model.load()
                }
            }
    }

    @ViewBuilder
    private func paywall(_ deck: DeckRecord) -> some View {
        if let commerce {
            LockedDeckPaywallView(
                deck: deck,
                store: store,
                assets: assets,
                commerce: commerce,
                continuable: continuable,
                // Studied and now locked is a purchase taken back, which is
                // the one case that gets the neutral "access has ended" card.
                hasProgress: (progressRow?.startedCards ?? 0) > 0,
                onSignIn: { onSignIn?() },
                onContinue: { session in
                    onStartStudy?(deckID, session.size, session.mode)
                }
            )
            .refreshable {
                await RefreshGesture.perform {
                    await commerce.refresh(trigger: .foreground)
                }
            }
        }
    }

    @ViewBuilder
    private func owned(_ deck: DeckRecord, cards: [LearningCardRecord]) -> some View {
        if let commerce {
            OwnedDeckView(
                deck: deck,
                cards: cards,
                store: store,
                assets: assets,
                progress: progressRow,
                continuable: continuable,
                // Bought a moment ago and the cards have not arrived: the
                // download is a content state, not a spinner over an empty
                // screen.
                isDownloading: isDeliveringCards(deck, cards: cards),
                isAwaitingSync: commerce.isAwaitingSync(deck),
                searchText: searchBinding,
                onOpenCard: { selectedCountry = CountryDetailsSubject(card: $0) },
                onStart: {
                    // Reported beside `study.session_started` rather than
                    // instead of it: one measures learning, this one measures
                    // whether a purchase is being used.
                    let started = continuable?.mode ?? mode
                    Task { await commerce.recordStudyStarted(in: deck, mode: started.analytics) }
                    if let continuable {
                        onStartStudy?(deckID, continuable.size, continuable.mode)
                    } else {
                        onStartStudy?(deckID, sessionSize, mode)
                    }
                }
            )
            .searchable(text: searchBinding, prompt: L10n.deckCardSearchPrompt)
            .refreshable {
                await RefreshGesture.perform {
                    await store.refresh()
                    await model.load()
                }
            }
        }
    }

    /// A deck that is for sale was opened, and — when it is locked — that the
    /// paywall was the screen. A free deck reports neither.
    private func reportOpened() async {
        guard let commerce, let deck = model.deck, deck.isSold else { return }
        await commerce.recordOpened(deck)
        await commerce.recordPaywallViewed(deck)
    }

    private func isDeliveringCards(_ deck: DeckRecord, cards: [LearningCardRecord]) -> Bool {
        guard cards.isEmpty, model.searchText.isEmpty else { return false }
        switch commerce?.phase(of: deck) {
        case .delivering, .purchasing: return true
        default: return false
        }
    }

    private var progressRow: DeckProgressRow? {
        progress?.decks.first { $0.id == deckID }
    }

    private var title: String {
        if case .ready(let details, _, _) = model.state, !details.deck.name.isEmpty {
            return details.deck.name
        }
        return L10n.deckTitle
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
        case .ready(let details, let isStale, let failure):
            loaded(details, isStale: isStale, failure: failure)
        }
    }

    private func loaded(
        _ details: DeckDetails,
        isStale: Bool,
        failure: ContentSyncFailure?
    ) -> some View {
        SceneScrollView {
            if isStale || failure != nil {
                ContentStatusBanner(isStale: isStale, failure: failure)
            }

            header(details)

            // Only when it has something to say: with the action at the
            // bottom and the size in the settings, the card is the unfinished
            // session and the mode — and an empty pane above a country list is
            // a shape the eye has to decode for nothing.
            if onStartStudy != nil, continuable != nil || isObjectiveModeEnabled {
                startCard()
            }

            countries(details)
        }
        // The same bar as the region's progress screen, in the same place with
        // the same gaps: both screens are a long list of countries with one
        // thing to do about them, and a person should not have to find the
        // button twice.
        .safeAreaInset(edge: .bottom) {
            if let onStartStudy {
                Button(continuable == nil ? L10n.studyStart : L10n.homeContinue) {
                    if let continuable {
                        onStartStudy(deckID, continuable.size, continuable.mode)
                    } else {
                        onStartStudy(deckID, sessionSize, mode)
                    }
                }
                .buttonStyle(GlassProminentActionStyle())
                .disabled(cardCount(of: details) == 0)
                .accessibilityIdentifier(AccessibilityIdentifier.studyStart)
                .padding(.horizontal, DesignTokens.Spacing.medium)
                .padding(.bottom, DesignTokens.Spacing.medium)
            }
        }
    }

    private func cardCount(of details: DeckDetails) -> Int {
        details.deck.cardCount
    }

    private func header(_ details: DeckDetails) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            Text(details.deck.name)
                .font(DesignTokens.Typography.screenTitle)
                .foregroundStyle(.white)

            if !details.deck.deckDescription.isEmpty {
                Text(details.deck.deckDescription)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.7))
            }

            Text(L10n.deckCardCount(details.deck.cardCount))
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.55))
                .accessibilityIdentifier(AccessibilityIdentifier.deckCardCount)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func startCard() -> some View {
        if let continuable {
            // The whole pane is the door back in — the same resumption the
            // bottom button offers, because a block that says "training
            // waits" and answers a tap with nothing reads as broken.
            Button {
                onStartStudy?(deckID, continuable.size, continuable.mode)
            } label: {
                GlassCard(padding: DesignTokens.Spacing.medium) {
                    HStack(spacing: DesignTokens.Spacing.medium) {
                        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                            SectionLabel(L10n.homeSessionInProgress)
                            HStack(
                                alignment: .firstTextBaseline,
                                spacing: DesignTokens.Spacing.extraSmall
                            ) {
                                Text("\(continuable.answeredCards)")
                                    .font(DesignTokens.Typography.heroNumber)
                                    .monospacedDigit()
                                Text("/ \(continuable.totalCards)")
                                    .font(DesignTokens.Typography.sectionTitle)
                                    .foregroundStyle(.white.opacity(0.55))
                            }
                            .foregroundStyle(.white)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.4))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(AccessibilityIdentifier.deckResume)
        } else {
            GlassCard(padding: DesignTokens.Spacing.medium) {
                modePicker
            }
        }
    }

    @ViewBuilder
    private var modePicker: some View {
        // The quiz is a released feature rather than a permanent one:
        // the flag is server-enforced and defaults to off, so the mode
        // is simply absent until it is turned on.
        if isObjectiveModeEnabled {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                SectionLabel(L10n.studyModeSection)
                Picker(L10n.studyModeSection, selection: $mode) {
                    Text(L10n.studyModeSelfRated)
                        .tag(StudyAnswerMode.selfRated)
                        .accessibilityIdentifier(AccessibilityIdentifier.studyModeSelfRated)
                    Text(L10n.studyModeObjective)
                        .tag(StudyAnswerMode.multipleChoice)
                        .accessibilityIdentifier(AccessibilityIdentifier.studyModeObjective)
                }
                .pickerStyle(.segmented)
            }
        }

        // The size is not asked for here. It is one setting, in the settings,
        // and a deck that asked again made it two — with the screen's answer
        // silently winning over the one the learner had already given. The
        // action is not here either: it waits at the bottom of the screen.
    }

    private func countries(_ details: DeckDetails) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            SectionLabel(L10n.deckCountriesSection)

            if details.cards.isEmpty {
                Text(L10n.deckNoMatches)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .accessibilityIdentifier(AccessibilityIdentifier.deckNoMatches)
            } else {
                // A deck can hold every country there is, so the rows are built
                // as they come into view rather than all at once.
                //
                // Drawn rather than glassed: the live glass effect is sampled
                // for what is on screen, and on a pane two hundred rows tall
                // the edge simply stopped being drawn once it scrolled past
                // the sample. A fill and a hairline are cheap, hold at any
                // height, and look the same standing still.
                LazyVStack(spacing: 0) {
                    ForEach(Array(details.cards.enumerated()), id: \.element.id) { index, card in
                        if index > 0 {
                            Divider()
                                .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                                .padding(.leading, DesignTokens.Layout.rowFlagWidth)
                        }
                        Button {
                            selectedCountry = CountryDetailsSubject(card: card)
                        } label: {
                            CountryRow(card: card, store: store, assets: assets)
                        }
                        .buttonStyle(CountryRowStyle())
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.deckCountryRow(card.id)
                        )
                    }
                }
                .padding(.vertical, DesignTokens.Spacing.small)
                .background(
                    RoundedRectangle(
                        cornerRadius: DesignTokens.Radius.large,
                        style: .continuous
                    )
                    .fill(.white.opacity(0.06))
                )
                .overlay(
                    RoundedRectangle(
                        cornerRadius: DesignTokens.Radius.large,
                        style: .continuous
                    )
                    .strokeBorder(
                        .white.opacity(DesignTokens.Card.borderOpacity),
                        lineWidth: 1 / displayScale
                    )
                )
                .clipShape(
                    RoundedRectangle(
                        cornerRadius: DesignTokens.Radius.large,
                        style: .continuous
                    )
                )
            }
        }
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.searchText }, set: { model.searchText = $0 })
    }
}

/// A row that is a button without looking like one.
///
/// The rows are a list, and a list that turned blue on touch would read as
/// five hundred links; pressing dims the row the way a table cell highlights.
private struct CountryRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, DesignTokens.Spacing.medium)
            .contentShape(.rect)
            .background(
                configuration.isPressed ? Color.white.opacity(0.08) : Color.clear
            )
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct CountryRow: View {
    let card: LearningCardRecord
    let store: ContentStore
    let assets: any AssetLoading

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.medium) {
            FlagImageView(
                assetID: card.promptAssetID,
                accessibilityLabel: card.displayName,
                store: store,
                assets: assets
            )
            .frame(width: DesignTokens.Layout.rowFlagWidth)
            .clipShape(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
            )
            // The same hairline the cards get, for the same reason: a mostly
            // white flag has no edge of its own.
            .overlay {
                RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
                    .strokeBorder(
                        .white.opacity(DesignTokens.Card.borderOpacity),
                        lineWidth: 1 / displayScale
                    )
            }

            Text(card.displayName)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.white)

            Spacer(minLength: 0)

            // The row opens something; the mark that says so is the one every
            // list on the platform uses.
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white.opacity(0.35))
        }
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
        .padding(.vertical, DesignTokens.Spacing.extraSmall)
        // One row is one thing to hear — and combining is also what lets the
        // call site put an identifier on the row without SwiftUI handing that
        // identifier down to the flag and the name inside.
        .accessibilityElement(children: .combine)
    }
}
