import Foundation

import CountryFlagsDomain

struct FixedDates: DateProviding {
    let instant: Date

    func now() -> Date { instant }
}

/// A store that answers from what a test handed it. The view models are meant
/// to be driven by a repository, so this is the whole seam they need.
final class FakeContentRepository: ContentRepository, @unchecked Sendable {
    private let decksByID: [DeckRecord]
    private let cardsByDeck: [UUID: [LearningCardRecord]]
    private let storedManifest: ContentManifestRecord?
    private let assetsByID: [UUID: AssetRecord]
    private let entitiesByID: [UUID: GeoEntityRecord]

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

    init(status: ContentSyncStatus) {
        self.status = status
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
        return cardsArrive
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
