import Foundation
import Observation

import CountryFlagsDomain

/// Reads content for the screens and asks for a sync when one is wanted.
///
/// Views read from here and never from a network response: everything on
/// screen has been through the store, which is what makes a relaunch without a
/// network indistinguishable from one with it.
@MainActor
@Observable
public final class ContentStore {
    public private(set) var catalog: ContentViewState<[CatalogSection]> = .loading
    public private(set) var status = ContentSyncStatus()
    /// The locale the catalog is actually written in, and how it was chosen.
    /// The UI says so only when the user is not reading a language they asked
    /// for.
    public private(set) var localeResolution: ContentLocaleResolution?

    private let repository: any ContentRepository
    private let coordinator: any ContentSynchronizing
    private let dates: any DateProviding
    private let preferredLanguages: [String]

    public init(
        repository: any ContentRepository,
        coordinator: any ContentSynchronizing,
        dates: any DateProviding = SystemDateProvider(),
        preferredLanguages: [String] = Locale.preferredLanguages
    ) {
        self.repository = repository
        self.coordinator = coordinator
        self.dates = dates
        self.preferredLanguages = preferredLanguages
    }

    /// Draws what the device already has, then brings it up to date.
    ///
    /// The order matters: a launch with a full store shows the catalog on the
    /// first frame and the sync happens behind it, so being offline costs
    /// nothing the user can see.
    public func start() async {
        await coordinator.restoreStatus()
        status = await coordinator.currentStatus()
        await reload()
        await synchronize()
    }

    /// Pull-to-refresh and every other explicit "try again".
    public func refresh() async {
        await synchronize()
    }

    private func synchronize() async {
        status = await coordinator.synchronize(locale: await requestLocale())
        await reload()
    }

    /// Re-reads the store and recomputes what the catalog screen shows.
    public func reload() async {
        let manifest = try? await repository.currentManifest()
        if let manifest {
            localeResolution = ContentLocaleResolver(preferredLanguages: preferredLanguages)
                .resolve(supported: manifest.supportedLocales, default: manifest.defaultLocale)
        }

        let decks = (try? await repository.decks()) ?? []
        let sections = CatalogGrouping.sections(for: decks)
        catalog = ContentViewState.resolve(
            value: sections,
            isEmpty: sections.isEmpty,
            status: status,
            now: dates.now()
        )
    }

    public func decks() async -> [DeckRecord] {
        (try? await repository.decks()) ?? []
    }

    public func deck(id: UUID) async -> DeckRecord? {
        await decks().first { $0.id == id }
    }

    public func cards(inDeck deckID: UUID) async -> [LearningCardRecord] {
        (try? await repository.cards(inDeck: deckID)) ?? []
    }

    public func asset(id: UUID) async -> AssetRecord? {
        (try? await repository.asset(id: id)) ?? nil
    }

    /// The locale to ask the backend for.
    ///
    /// Before any release is stored there is nothing to match against, so the
    /// device's own preference is sent and the manifest decides what comes
    /// back.
    private func requestLocale() async -> String {
        guard let manifest = try? await repository.currentManifest() else {
            return preferredLanguages.first ?? "en"
        }
        return ContentLocaleResolver(preferredLanguages: preferredLanguages)
            .resolve(supported: manifest.supportedLocales, default: manifest.defaultLocale)
            .locale
    }
}

/// One deck's own screen state.
///
/// It is separate from `ContentStore` because a deck is opened and closed while
/// the catalog stays: keeping its cards in the shared object would mean the
/// catalog held whatever deck happened to be visited last.
@MainActor
@Observable
public final class DeckDetailsModel {
    public private(set) var state: ContentViewState<DeckDetails> = .loading
    public var searchText = "" {
        didSet { recompute() }
    }

    private let deckID: UUID
    private let store: ContentStore
    private let dates: any DateProviding
    private var loaded: DeckDetails?

    public init(deckID: UUID, store: ContentStore, dates: any DateProviding = SystemDateProvider()) {
        self.deckID = deckID
        self.store = store
        self.dates = dates
    }

    public func load() async {
        guard let deck = await store.deck(id: deckID) else {
            state = ContentViewState.resolve(
                value: DeckDetails.empty(id: deckID),
                isEmpty: true,
                status: store.status,
                now: dates.now()
            )
            return
        }
        loaded = DeckDetails(deck: deck, cards: await store.cards(inDeck: deckID))
        recompute()
    }

    private func recompute() {
        guard let loaded else { return }
        let filtered = DeckDetails(
            deck: loaded.deck,
            cards: CatalogSearch.cards(loaded.cards, matching: searchText)
        )
        state = ContentViewState.resolve(
            value: filtered,
            // A search that matches nothing is an empty result, not an empty
            // deck: the deck itself is still there and still openable.
            isEmpty: loaded.cards.isEmpty,
            status: store.status,
            now: dates.now()
        )
    }
}

public struct DeckDetails: Equatable, Sendable {
    public let deck: DeckRecord
    public let cards: [LearningCardRecord]

    public init(deck: DeckRecord, cards: [LearningCardRecord]) {
        self.deck = deck
        self.cards = cards
    }

    static func empty(id: UUID) -> DeckDetails {
        DeckDetails(
            deck: DeckRecord(
                id: id,
                code: "",
                kind: "",
                name: "",
                deckDescription: "",
                cardCount: 0,
                contentVersion: "",
                sortOrder: 0
            ),
            cards: []
        )
    }
}
