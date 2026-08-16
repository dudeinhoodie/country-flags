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
    @State private var continuable: ContinuableSession?
    private let deckID: UUID
    private let store: ContentStore
    private let assets: any AssetLoading
    private let makeSettings: (() -> SettingsStore)?
    private let makeProgress: (() -> ProgressStore)?
    private let isObjectiveModeEnabled: Bool
    private let onStartStudy: ((UUID, StudySessionSize, StudyAnswerMode) -> Void)?

    public init(
        deckID: UUID,
        store: ContentStore,
        assets: any AssetLoading,
        defaultSessionSize: StudySessionSize = .ten,
        makeSettings: (() -> SettingsStore)? = nil,
        makeProgress: (() -> ProgressStore)? = nil,
        isObjectiveModeEnabled: Bool = false,
        onStartStudy: ((UUID, StudySessionSize, StudyAnswerMode) -> Void)? = nil
    ) {
        _model = State(wrappedValue: DeckDetailsModel(deckID: deckID, store: store))
        _sessionSize = State(wrappedValue: defaultSessionSize)
        self.deckID = deckID
        self.store = store
        self.assets = assets
        self.makeSettings = makeSettings
        self.makeProgress = makeProgress
        self.isObjectiveModeEnabled = isObjectiveModeEnabled
        self.onStartStudy = onStartStudy
    }

    public var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: searchBinding, prompt: L10n.deckSearchPrompt)
            .refreshable {
                await store.refresh()
                await model.load()
            }
            .task { await model.load() }
            // On appearance rather than once: finishing the session pops back
            // here, and the offer to continue has to disappear with it.
            .onAppear {
                guard let makeProgress else { return }
                Task {
                    let progress = makeProgress()
                    await progress.load()
                    continuable =
                        progress.continuable?.deckID == deckID ? progress.continuable : nil
                }
            }
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

            if let onStartStudy {
                startCard(details, onStartStudy: onStartStudy)
            }

            countries(details)
        }
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

    private func startCard(
        _ details: DeckDetails,
        onStartStudy: @escaping (UUID, StudySessionSize, StudyAnswerMode) -> Void
    ) -> some View {
        GlassCard(padding: DesignTokens.Spacing.medium) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                if let continuable {
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

                    Button(L10n.homeContinue) {
                        onStartStudy(deckID, continuable.size, continuable.mode)
                    }
                    .buttonStyle(PrimaryActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.studyStart)
                } else {
                    startControls(details, onStartStudy: onStartStudy)
                }
            }
        }
    }

    @ViewBuilder
    private func startControls(
        _ details: DeckDetails,
        onStartStudy: @escaping (UUID, StudySessionSize, StudyAnswerMode) -> Void
    ) -> some View {
        // The quiz is a released feature rather than a permanent one:
        // the flag is server-enforced and defaults to off, so the mode
        // is simply absent until it is turned on.
        if isObjectiveModeEnabled {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                SectionLabel(L10n.studyModeSection)
                GlassSegmentedPicker(
                    selection: $mode,
                    options: [StudyAnswerMode.selfRated, .multipleChoice],
                    label: { option in
                        option == .selfRated
                            ? L10n.studyModeSelfRated : L10n.studyModeObjective
                    },
                    identifier: { option in
                        option == .selfRated
                            ? AccessibilityIdentifier.studyModeSelfRated
                            : AccessibilityIdentifier.studyModeObjective
                    }
                )
            }
        }

        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            SectionLabel(L10n.studySessionSize)
            // The choice slides rather than snaps: the thumb travels to the
            // tapped size, the way the system's own control moves everywhere
            // the scene is not glass.
            GlassSegmentedPicker(
                selection: $sessionSize,
                options: StudySessionSize.allCases,
                label: { "\($0.rawValue)" },
                identifier: { AccessibilityIdentifier.studySizeOption($0) }
            )
        }

        // A session can start with no network at all: the cards and
        // their flags are already on the device.
        Button(L10n.studyStart) {
            onStartStudy(deckID, sessionSize, mode)
        }
        .buttonStyle(PrimaryActionStyle())
        .disabled(details.deck.cardCount == 0)
        .accessibilityIdentifier(AccessibilityIdentifier.studyStart)
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
                GlassCard(padding: DesignTokens.Spacing.small) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(details.cards.enumerated()), id: \.element.id) { index, card in
                            if index > 0 {
                                Divider()
                                    .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                                    .padding(.leading, DesignTokens.Layout.rowFlagWidth)
                            }
                            CountryRow(card: card, store: store, assets: assets)
                                .padding(.horizontal, DesignTokens.Spacing.small)
                                .accessibilityIdentifier(
                                    AccessibilityIdentifier.deckCountryRow(card.id)
                                )
                        }
                    }
                }
            }
        }
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.searchText }, set: { model.searchText = $0 })
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
        }
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
        .padding(.vertical, DesignTokens.Spacing.extraSmall)
        // One row is one thing to hear — and combining is also what lets the
        // call site put an identifier on the row without SwiftUI handing that
        // identifier down to the flag and the name inside.
        .accessibilityElement(children: .combine)
    }
}
