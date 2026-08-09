import SwiftUI

import CountryFlagsDomain

/// One deck: what it is, how big it is, and what is in it.
///
/// Session size and the two study modes arrive with the study work packages.
/// What this screen owns is the content half: the deck can be read, searched
/// and browsed with no network at all.
public struct DeckDetailsView: View {
    @State private var model: DeckDetailsModel
    @State private var sessionSize: StudySessionSize
    @State private var mode: StudyAnswerMode = .selfRated
    private let deckID: UUID
    private let store: ContentStore
    private let assets: any AssetLoading
    private let isObjectiveModeEnabled: Bool
    private let onStartStudy: ((UUID, StudySessionSize, StudyAnswerMode) -> Void)?

    public init(
        deckID: UUID,
        store: ContentStore,
        assets: any AssetLoading,
        defaultSessionSize: StudySessionSize = .ten,
        isObjectiveModeEnabled: Bool = false,
        onStartStudy: ((UUID, StudySessionSize, StudyAnswerMode) -> Void)? = nil
    ) {
        _model = State(wrappedValue: DeckDetailsModel(deckID: deckID, store: store))
        _sessionSize = State(wrappedValue: defaultSessionSize)
        self.deckID = deckID
        self.store = store
        self.assets = assets
        self.isObjectiveModeEnabled = isObjectiveModeEnabled
        self.onStartStudy = onStartStudy
    }

    public var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .refreshable {
                await store.refresh()
                await model.load()
            }
            .task { await model.load() }
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
            list(details, isStale: isStale, failure: failure)
        }
    }

    private func list(
        _ details: DeckDetails,
        isStale: Bool,
        failure: ContentSyncFailure?
    ) -> some View {
        List {
            if isStale || failure != nil {
                Section {
                    ContentStatusBanner(isStale: isStale, failure: failure)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }

            Section {
                if !details.deck.deckDescription.isEmpty {
                    Text(details.deck.deckDescription)
                        .font(DesignTokens.Typography.body)
                }
                Text(L10n.deckCardCount(details.deck.cardCount))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(AccessibilityIdentifier.deckCardCount)
            }

            if let onStartStudy {
                // The quiz is a released feature rather than a permanent one:
                // the flag is server-enforced and defaults to off, so the mode
                // is simply absent until it is turned on.
                if isObjectiveModeEnabled {
                    Section(L10n.studyModeSection) {
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

                Section(L10n.studySessionSize) {
                    Picker(L10n.studySessionSize, selection: $sessionSize) {
                        ForEach(StudySessionSize.allCases) { size in
                            Text(verbatim: "\(size.rawValue)")
                                .tag(size)
                                .accessibilityIdentifier(
                                    AccessibilityIdentifier.studySizeOption(size)
                                )
                        }
                    }
                    .pickerStyle(.segmented)

                    // A session can start with no network at all: the cards and
                    // their flags are already on the device.
                    Button(L10n.studyStart) {
                        onStartStudy(deckID, sessionSize, mode)
                    }
                    .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
                    .disabled(details.deck.cardCount == 0)
                    .accessibilityIdentifier(AccessibilityIdentifier.studyStart)
                }
            }

            Section(L10n.deckCountriesSection) {
                if details.cards.isEmpty {
                    Text(L10n.deckNoMatches)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier(AccessibilityIdentifier.deckNoMatches)
                }
                ForEach(details.cards, id: \.id) { card in
                    CountryRow(card: card, store: store, assets: assets)
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.deckCountryRow(card.id)
                        )
                }
            }
        }
        .searchable(text: searchBinding, prompt: L10n.deckSearchPrompt)
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.searchText }, set: { model.searchText = $0 })
    }
}

struct CountryRow: View {
    let card: LearningCardRecord
    let store: ContentStore
    let assets: any AssetLoading

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.medium) {
            FlagImageView(
                assetID: card.promptAssetID,
                accessibilityLabel: card.displayName,
                store: store,
                assets: assets
            )
            .frame(width: 48, height: 32)

            Text(card.displayName)
                .font(DesignTokens.Typography.body)
        }
        .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
    }
}
