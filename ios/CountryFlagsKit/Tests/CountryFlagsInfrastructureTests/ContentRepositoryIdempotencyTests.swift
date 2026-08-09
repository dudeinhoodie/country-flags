import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The store half of resumability: applying the same page twice has to be
/// indistinguishable from applying it once, because a download interrupted
/// between the request and the commit will do exactly that.
final class ContentRepositoryIdempotencyTests: XCTestCase {
    private let version = "v1"

    func testReplayingAPageDoesNotDuplicateRecords() async throws {
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let page = Self.page(version: version)
        let staging = ContentStagingState(
            contentVersion: version,
            stage: .ready,
            cursor: nil,
            pendingDeckIDs: [],
            updatedAt: .distantPast
        )

        try await repository.applyStagedPage(page, staging: staging)
        try await repository.applyStagedPage(page, staging: staging)
        try await repository.commitRelease(manifest: Self.manifest(version: version))

        let decks = try await repository.decks()
        XCTAssertEqual(decks.count, 1)
        let cards = try await repository.cards(inDeck: Self.deckID)
        XCTAssertEqual(cards.count, 1)
        let assets = try await repository.asset(id: Self.assetID)
        XCTAssertNotNil(assets)
    }

    /// A replay carrying corrected values overwrites rather than accumulates.
    func testReplayingAPageUpdatesTheRecordInPlace() async throws {
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let staging = ContentStagingState(
            contentVersion: version,
            stage: .ready,
            cursor: nil,
            pendingDeckIDs: [],
            updatedAt: .distantPast
        )

        try await repository.applyStagedPage(Self.page(version: version), staging: staging)
        try await repository.applyStagedPage(
            Self.page(version: version, deckName: "Renamed"),
            staging: staging
        )
        try await repository.commitRelease(manifest: Self.manifest(version: version))

        let decks = try await repository.decks()
        XCTAssertEqual(decks.count, 1)
        XCTAssertEqual(decks.first?.name, "Renamed")
    }

    /// A release that is still downloading must not appear in the catalog: a
    /// listing that mixed two versions would show decks that lead nowhere.
    func testAStagedReleaseIsInvisibleUntilItIsCommitted() async throws {
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()

        try await repository.applyStagedPage(
            Self.page(version: version),
            staging: ContentStagingState(
                contentVersion: version,
                stage: .cards,
                cursor: "next",
                pendingDeckIDs: [Self.deckID],
                updatedAt: .distantPast
            )
        )

        let decksBefore = try await repository.decks()
        XCTAssertTrue(decksBefore.isEmpty)

        try await repository.commitRelease(manifest: Self.manifest(version: version))

        let decksAfter = try await repository.decks()
        XCTAssertEqual(decksAfter.count, 1)
    }

    func testTheStagingStateSurvivesAndCarriesTheResumePoint() async throws {
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()

        try await repository.applyStagedPage(
            Self.page(version: version),
            staging: ContentStagingState(
                contentVersion: version,
                stage: .cards,
                cursor: "page-2",
                pendingDeckIDs: [Self.deckID],
                appliedInStage: 50,
                updatedAt: .distantPast
            )
        )

        let staging = try await repository.stagingState(forVersion: version)
        XCTAssertEqual(staging?.stage, .cards)
        XCTAssertEqual(staging?.cursor, "page-2")
        XCTAssertEqual(staging?.pendingDeckIDs, [Self.deckID])
        XCTAssertEqual(staging?.appliedInStage, 50)

        // Committing the release closes the download, so the next launch does
        // not resume one that already finished.
        try await repository.commitRelease(manifest: Self.manifest(version: version))
        let cleared = try await repository.stagingState(forVersion: version)
        XCTAssertNil(cleared)
    }

    // MARK: - Fixtures

    private static let deckID = UUID(uuidString: "70000000-0000-4000-8000-0000000000f1")!
    private static let cardID = UUID(uuidString: "50000000-0000-4000-8000-0000000000f1")!
    private static let assetID = UUID(uuidString: "40000000-0000-4000-8000-0000000000f1")!

    private static func page(version: String, deckName: String = "Deck") -> ContentPage {
        ContentPage(
            decks: [
                DeckRecord(
                    id: deckID,
                    code: "DECK",
                    kind: "CURATED",
                    name: deckName,
                    deckDescription: "",
                    cardCount: 1,
                    contentVersion: version,
                    sortOrder: 0
                )
            ],
            cards: [
                LearningCardRecord(
                    id: cardID,
                    subjectEntityID: UUID(),
                    templateCode: "FLAG_TO_COUNTRY",
                    templateSchemaVersion: 1,
                    semanticVersion: 1,
                    revision: 1,
                    answerMode: "SELF_RATED",
                    promptAssetID: assetID,
                    displayName: "France",
                    aliases: [],
                    contentVersion: version
                )
            ],
            deckCards: [DeckCardRecord(deckID: deckID, learningCardID: cardID, sortOrder: 0)],
            assets: [
                AssetRecord(
                    id: assetID,
                    type: "FLAG",
                    url: URL(string: "https://cdn.test.invalid/fr.svg")!,
                    mimeType: "image/svg+xml",
                    sha256: String(repeating: "d", count: 64),
                    contentVersion: version
                )
            ]
        )
    }

    private static func manifest(version: String) -> ContentManifestRecord {
        ContentManifestRecord(
            contentVersion: version,
            defaultLocale: "en",
            supportedLocales: ["en", "ru"],
            supportedTemplateSchemaVersions: [1],
            assetBaseURL: URL(string: "https://cdn.test.invalid/")!,
            changeCursor: "cursor-0",
            checksum: "checksum",
            appliedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}
