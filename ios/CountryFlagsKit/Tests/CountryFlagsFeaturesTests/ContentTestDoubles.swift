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

    init(
        decks: [DeckRecord] = [],
        cards: [UUID: [LearningCardRecord]] = [:],
        manifest: ContentManifestRecord? = nil,
        assets: [UUID: AssetRecord] = [:]
    ) {
        decksByID = decks
        cardsByDeck = cards
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

    func card(id: UUID) async throws -> LearningCardRecord? {
        cardsByDeck.values.flatMap { $0 }.first { $0.id == id }
    }

    func entity(id: UUID) async throws -> GeoEntityRecord? { nil }

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
}
