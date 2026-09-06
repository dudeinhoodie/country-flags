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
    /// When the catalogue was last brought up to date. What "stale" is measured
    /// against when the app comes back to the foreground.
    ///
    /// It says nothing about whether there is content: it is in-memory state
    /// about *this run*, nil on every launch however full the store is. A
    /// launch gated on it kept a device holding the whole catalogue behind a
    /// spinner every time it started (#266) — ask `hasSomethingToShow`.
    public private(set) var lastSyncedAt: Date?
    /// What the account may open, as commerce last worked it out.
    ///
    /// The catalogue carries access beside kind because the shelf a deck
    /// belongs on is decided by both: a deck that is for sale and not owned is
    /// featured, and the same deck bought is an ordinary row again. It is
    /// pushed in rather than read out because the store must not depend on
    /// commerce — a build with no store at all leaves it empty, which is a
    /// catalogue of free decks.
    public private(set) var entitlementKeys: Set<String> = []

    /// Whether the store holds a catalogue the app could draw right now.
    ///
    /// False only before the first read finishes, or when the store is
    /// genuinely empty and the sync that would fill it has not answered.
    /// An empty release and a failed first sync are answers, not waits: the
    /// app has screens for both.
    public var hasSomethingToShow: Bool {
        switch catalog {
        case .loading: false
        case .empty, .ready, .failed: true
        }
    }

    private let repository: any ContentRepository
    private let coordinator: any ContentSynchronizing
    private let dates: any DateProviding
    private let preferredLanguages: [String]
    /// Fetches one entity from the API when the store has no row for it. The
    /// pages a bootstrap imports carry cards without their entities — only
    /// the change feed delivers those — so on a fresh install this is how a
    /// card back learns an official name. The composition wires it to the
    /// content service and persists what it fetched; nil leaves the store's
    /// answer final.
    private let fetchEntity: (@Sendable (UUID, String) async -> GeoEntityRecord?)?
    private let analytics: (any AnalyticsTracking)?
    /// Whether the launch's first read and sync have already run.
    private var hasStarted = false
    /// The catalogue catch-up in flight, if any.
    private var catchUpTask: Task<Void, Never>?

    public init(
        repository: any ContentRepository,
        coordinator: any ContentSynchronizing,
        analytics: (any AnalyticsTracking)? = nil,
        dates: any DateProviding = SystemDateProvider(),
        preferredLanguages: [String] = Locale.preferredLanguages,
        fetchEntity: (@Sendable (UUID, String) async -> GeoEntityRecord?)? = nil
    ) {
        self.repository = repository
        self.coordinator = coordinator
        self.analytics = analytics
        self.dates = dates
        self.preferredLanguages = preferredLanguages
        self.fetchEntity = fetchEntity
    }

    /// Draws what the device already has, then brings it up to date.
    ///
    /// The order matters: a launch with a full store shows the catalog on the
    /// first frame and the sync happens behind it, so being offline costs
    /// nothing the user can see.
    ///
    /// Idempotent: every screen calls it on appearance, and only the first
    /// call does the work. It used to run in full each time, so switching
    /// tabs re-read the whole catalogue and re-ran a sync that had just
    /// finished.
    public func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        await coordinator.restoreStatus()
        status = await coordinator.currentStatus()
        await reload()
        await synchronize()
    }

    /// Pull-to-refresh and every other explicit "try again".
    public func refresh() async {
        await synchronize()
    }

    /// Brings the catalogue up to date without holding a gesture open.
    ///
    /// A pull on the home screen means "bring what I am looking at up to
    /// date", and what that screen shows is the day's numbers. Applying a
    /// release is a different job: a new publication is walked deck by deck,
    /// page by page, until the whole of it is stored — so binding the
    /// gesture's spinner to it left the spinner turning for as long as an
    /// entire catalogue took to arrive, which is what a new release costs.
    ///
    /// The screen is observed, so the shelf updates when the release lands
    /// rather than when the finger lifts.
    ///
    /// One run at a time: two would stage the same release against each
    /// other, and the staging state is a single row.
    public func catchUp() {
        guard catchUpTask == nil else { return }
        catchUpTask = Task { @MainActor [weak self] in
            await self?.synchronize()
            self?.catchUpTask = nil
        }
    }

    /// Brings the catalogue up to date only if it has had time to go stale.
    ///
    /// Called when the app returns to the foreground. Coming back after two
    /// minutes should cost nothing; coming back after an hour should not show
    /// yesterday's shelf. The threshold is the caller's, because what counts as
    /// stale is a property of the screen asking, not of the store.
    public func refreshIfStale(olderThan age: TimeInterval) async {
        guard let lastSyncedAt else {
            await synchronize()
            return
        }
        guard dates.now().timeIntervalSince(lastSyncedAt) >= age else { return }
        await synchronize()
    }

    private func synchronize() async {
        status = await coordinator.synchronize(locale: await requestLocale())
        lastSyncedAt = dates.now()
        await reload()
        // Operational, like the sync event: whether the catalog could be
        // brought up to date is how a broken release becomes visible, and it
        // says nothing about the person looking at it.
        await analytics?.track(
            .contentUpdateCompleted(
                result: status.lastFailure == nil ? .success : .failed,
                at: dates.now()
            )
        )
    }

    /// Takes commerce's word for what this account may open.
    ///
    /// Two things follow from it, and both belong here rather than in a view:
    /// the catalogue regroups — a deck that has just been bought leaves the
    /// featured shelf — and the cards of anything newly opened are fetched,
    /// because a paid deck is staged without them.
    ///
    /// - Returns: whether every newly opened deck now has its cards. False is
    ///   a download that has not landed, which is a state the deck screen
    ///   shows rather than an error.
    @discardableResult
    public func apply(entitlementKeys keys: Set<String>) async -> Bool {
        let opened = keys.subtracting(entitlementKeys)
        entitlementKeys = keys
        guard !opened.isEmpty else {
            // A refund goes down this path too: the keys shrank, nothing is
            // downloaded, and the regroup is what puts the deck back on the
            // shelf.
            await reload()
            return true
        }
        let waiting = (try? await repository.decks())?.filter { deck in
            guard let required = deck.requiredEntitlementKey else { return false }
            return opened.contains(required)
        }
        var complete = true
        for deck in waiting ?? [] where await cards(inDeck: deck.id).isEmpty {
            complete = await coordinator.loadCards(
                inDeck: deck.id,
                locale: await requestLocale()
            ) && complete
        }
        await reload()
        return complete
    }

    /// Re-reads the store and recomputes what the catalog screen shows.
    public func reload() async {
        let manifest = try? await repository.currentManifest()
        if let manifest {
            localeResolution = ContentLocaleResolver(preferredLanguages: preferredLanguages)
                .resolve(supported: manifest.supportedLocales, default: manifest.defaultLocale)
        }

        let decks = (try? await repository.decks()) ?? []
        let sections = CatalogGrouping.sections(for: decks, entitlementKeys: entitlementKeys)
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

    public func card(id: UUID) async -> LearningCardRecord? {
        try? await repository.card(id: id)
    }

    public func cardIdentifiersByDeck() async -> [UUID: [UUID]] {
        (try? await repository.cardIdentifiersByDeck()) ?? [:]
    }

    public func entity(id: UUID) async -> GeoEntityRecord? {
        if let stored = (try? await repository.entity(id: id)) ?? nil { return stored }
        guard let fetchEntity else { return nil }
        // Fetched once, persisted by the closure, and read back from the
        // store on every later ask like everything else on screen.
        return await fetchEntity(id, await requestLocale())
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
    /// The deck itself, whether or not it has any cards on this device.
    ///
    /// Separate from `state` because a deck with no cards is not the same
    /// thing as a deck that failed to arrive: a paid deck is published with
    /// its metadata and without its cards until it is bought, and a screen
    /// that read emptiness as failure would show "content unavailable" over a
    /// perfectly good paywall.
    public private(set) var deck: DeckRecord?
    /// The cards the search has left, whatever `state` makes of how many
    /// there are.
    public private(set) var visibleCards: [LearningCardRecord] = []
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
        guard let record = await store.deck(id: deckID) else {
            deck = nil
            visibleCards = []
            state = ContentViewState.resolve(
                value: DeckDetails.empty(id: deckID),
                isEmpty: true,
                status: store.status,
                now: dates.now()
            )
            return
        }
        deck = record
        loaded = DeckDetails(deck: record, cards: await store.cards(inDeck: deckID))
        recompute()
    }

    private func recompute() {
        guard let loaded else { return }
        let filtered = DeckDetails(
            deck: loaded.deck,
            cards: CatalogSearch.cards(loaded.cards, matching: searchText)
        )
        visibleCards = filtered.cards
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
