import Foundation

import CountryFlagsDomain

struct FixedDates: DateProviding {
    let instant: Date

    func now() -> Date { instant }
}

/// A store that answers from what a test handed it. The view models are meant
/// to be driven by a repository, so this is the whole seam they need.
final class FakeContentRepository: ContentRepository, @unchecked Sendable {
    private var decksByID: [DeckRecord]
    private var cardsByDeck: [UUID: [LearningCardRecord]]
    private let storedManifest: ContentManifestRecord?
    private var assetsByID: [UUID: AssetRecord]
    private let entitiesByID: [UUID: GeoEntityRecord]
    /// The decks a cleanup was asked to forget, in the order it was asked.
    private(set) var removedDeckIDs: [UUID] = []

    init(
        decks: [DeckRecord] = [],
        cards: [UUID: [LearningCardRecord]] = [:],
        manifest: ContentManifestRecord? = nil,
        assets: [UUID: AssetRecord] = [:],
        entities: [UUID: GeoEntityRecord] = [:]
    ) {
        decksByID = decks
        cardsByDeck = cards
        entitiesByID = entities
        // A store holding decks has necessarily applied a release, so the
        // default manifest follows the decks rather than being set separately
        // in every test.
        storedManifest = manifest ?? (decks.isEmpty ? nil : Self.defaultManifest)
        assetsByID = assets
    }

    func currentManifest() async throws -> ContentManifestRecord? { storedManifest }

    func applyContent(
        manifest: ContentManifestRecord,
        entities: [GeoEntityRecord],
        decks: [DeckRecord],
        cards: [LearningCardRecord],
        deckCards: [DeckCardRecord]
    ) async throws {}

    func applyStagedPage(_ page: ContentPage, staging: ContentStagingState) async throws {}

    func stagingState(forVersion contentVersion: String) async throws -> ContentStagingState? { nil }

    func commitRelease(manifest: ContentManifestRecord) async throws {}

    func decks() async throws -> [DeckRecord] { decksByID }

    func cards(inDeck deckID: UUID) async throws -> [LearningCardRecord] {
        cardsByDeck[deckID] ?? []
    }

    func cardIdentifiersByDeck() async throws -> [UUID: [UUID]] {
        cardsByDeck.mapValues { $0.map(\.id) }
    }

    func card(id: UUID) async throws -> LearningCardRecord? {
        cardsByDeck.values.flatMap { $0 }.first { $0.id == id }
    }

    func entity(id: UUID) async throws -> GeoEntityRecord? { entitiesByID[id] }

    func asset(id: UUID) async throws -> AssetRecord? { assetsByID[id] }

    func retire(cardIDs: [UUID], entityIDs: [UUID]) async throws {}

    /// Drops the cards of those decks, keeping any a surviving deck still
    /// holds — the same rule the store follows, small enough to read.
    @discardableResult
    func removeContent(ofDecks deckIDs: [UUID]) async throws -> RemovedDeckContent {
        removedDeckIDs.append(contentsOf: deckIDs)
        let dropped = Set(deckIDs)
        let doomed = dropped.flatMap { cardsByDeck[$0] ?? [] }
        guard !doomed.isEmpty else { return .none }
        let kept = Set(
            cardsByDeck
                .filter { !dropped.contains($0.key) }
                .values
                .flatMap { $0 }
                .map(\.id)
        )
        for deckID in dropped { cardsByDeck[deckID] = [] }
        let removed = doomed.filter { !kept.contains($0.id) }
        var assets: [AssetRecord] = []
        for card in removed {
            if let asset = assetsByID.removeValue(forKey: card.promptAssetID) {
                assets.append(asset)
            }
        }
        return RemovedDeckContent(
            membershipCount: doomed.count,
            cardIDs: removed.map(\.id),
            assets: assets
        )
    }

    /// Puts a deck's cards back, which is what a download after a purchase
    /// does. The fake synchronizer has no store to write into, so the test
    /// that proves a re-login restores the deck states it here.
    func restore(cards: [LearningCardRecord], inDeck deckID: UUID) {
        cardsByDeck[deckID] = cards
    }

    private static let defaultManifest = ContentManifestRecord(
        contentVersion: "v1",
        defaultLocale: "en",
        supportedLocales: ["en", "ru"],
        supportedTemplateSchemaVersions: [1],
        assetBaseURL: URL(string: "https://cdn.test.invalid/")!,
        changeCursor: "cursor",
        checksum: "checksum",
        appliedAt: Date(timeIntervalSince1970: 1_800_000_000)
    )
}

/// Reports a fixed outcome and counts how often the screens asked for one.
actor FakeSynchronizer: ContentSynchronizing {
    private let status: ContentSyncStatus
    private(set) var synchronizeCount = 0
    private(set) var requestedLocales: [String] = []
    private(set) var loadedDeckIDs: [UUID] = []
    /// What `loadCards` answers. False is a deck the guard refused.
    var cardsArrive = true
    /// Run when a deck's cards are asked for, so a test can put them into the
    /// store the way a real download would.
    private var onLoad: (@Sendable (UUID) async -> Void)?

    init(status: ContentSyncStatus) {
        self.status = status
    }

    func whenLoadingCards(_ handler: @escaping @Sendable (UUID) async -> Void) {
        onLoad = handler
    }

    func currentStatus() async -> ContentSyncStatus { status }

    func restoreStatus() async {}

    @discardableResult
    func synchronize(locale: String) async -> ContentSyncStatus {
        synchronizeCount += 1
        requestedLocales.append(locale)
        return status
    }

    @discardableResult
    func loadCards(inDeck deckID: UUID, locale: String) async -> Bool {
        loadedDeckIDs.append(deckID)
        guard cardsArrive else { return false }
        await onLoad?(deckID)
        return true
    }
}

/// Keeps every event it was handed, in order.
///
/// The events themselves are the registry's — `AnalyticsEvent`'s initialiser
/// is private — so what a test reads here is exactly what would have left the
/// device, which is what makes a leak assertion mean anything.
actor RecordingAnalytics: AnalyticsTracking {
    private var events: [AnalyticsEvent] = []

    func track(_ event: AnalyticsEvent) async {
        events.append(event)
    }

    func setIdentity(_ identity: AnalyticsIdentity?) async {}
    func flush() async {}

    var recorded: [AnalyticsEvent] { events }

    var names: [String] { events.map(\.name.rawValue) }

    func properties(of name: AnalyticsEventName) -> [[String: AnalyticsValue]] {
        events.filter { $0.name == name }.map(\.properties)
    }

    /// Every string anything about these events could carry — names, property
    /// names and property values — as one haystack.
    var everyString: [String] {
        events.flatMap { event -> [String] in
            [event.name.rawValue]
                + event.properties.keys
                + event.properties.values.compactMap {
                    if case .string(let text) = $0 { return text }
                    return nil
                }
        }
    }
}

/// Keeps every operational error it was handed, so a test can say what the app
/// reported rather than that it reported something.
final class RecordingErrorReporter: ErrorReporting, @unchecked Sendable {
    private let lock = NSLock()
    private var captured: [(error: any Error, context: ErrorContext)] = []

    func capture(error: any Error, context: ErrorContext) {
        lock.lock()
        defer { lock.unlock() }
        captured.append((error, context))
    }

    func addBreadcrumb(_ breadcrumb: SafeBreadcrumb) {}
    func setUserContext(_ context: ErrorUserContext?) {}

    var reports: [(error: any Error, context: ErrorContext)] {
        lock.lock()
        defer { lock.unlock() }
        return captured
    }

    func contexts(forOperation operation: String) -> [ErrorContext] {
        reports.map(\.context).filter { $0.operation == operation }
    }
}
