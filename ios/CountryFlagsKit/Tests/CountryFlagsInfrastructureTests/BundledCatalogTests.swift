import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// The catalogue this build ships, and what happens to it when a real one
/// arrives.
///
/// The claim being tested is the one issue #301 is about: a device that has
/// never reached the backend still has decks, cards and countries — and the
/// moment it does reach the backend, what the server said wins whole.
final class BundledCatalogTests: XCTestCase {
    private let dates = FixedDateProvider(instant: ContentTestClient.now)

    // MARK: - The document

    func testTheShippedCatalogueIsAWholeRelease() throws {
        let seed = try shippedSeed()

        XCTAssertFalse(seed.page.decks.isEmpty)
        XCTAssertFalse(seed.page.cards.isEmpty)
        XCTAssertFalse(seed.page.entities.isEmpty)
        XCTAssertFalse(seed.page.assets.isEmpty)
        // A deck with no memberships is a deck that opens on nothing, and it
        // is what a renamed field in the generated document looks like from
        // here — the decoder reads an absent list as an empty one.
        XCTAssertFalse(seed.page.deckCards.isEmpty)
        for deck in seed.page.decks where deck.isFree {
            XCTAssertEqual(
                seed.page.deckCards.filter { $0.deckID == deck.id }.count,
                deck.cardCount,
                deck.code
            )
        }

        // Nothing in it points at something it does not carry: a card with no
        // prompt draws an empty frame, and a membership naming a card that is
        // not there is a deck that counts wrong.
        let assets = Set(seed.page.assets.map(\.id))
        let cards = Set(seed.page.cards.map(\.id))
        let entities = Set(seed.page.entities.map(\.id))
        for card in seed.page.cards {
            XCTAssertTrue(assets.contains(card.promptAssetID), card.displayName)
            XCTAssertTrue(entities.contains(card.subjectEntityID), card.displayName)
            XCTAssertFalse(card.displayName.isEmpty)
        }
        for membership in seed.page.deckCards {
            XCTAssertTrue(cards.contains(membership.learningCardID))
        }
    }

    /// The load-bearing detail of the whole design. The identifiers in the
    /// bundle are derived from content keys and a server allocates its own, so
    /// the two releases must never be readable at once — which is what a
    /// version of its own buys.
    func testTheSeededReleaseIsStoredUnderAVersionOfItsOwn() throws {
        let seed = try shippedSeed()

        XCTAssertTrue(
            seed.manifest.contentVersion.hasPrefix("bundled:"),
            seed.manifest.contentVersion
        )
        for deck in seed.page.decks {
            XCTAssertEqual(deck.contentVersion, seed.manifest.contentVersion)
        }
        for card in seed.page.cards {
            XCTAssertEqual(card.contentVersion, seed.manifest.contentVersion)
        }
    }

    /// A build that ships a catalogue must ship the flags of the same release,
    /// or the first launch draws 250 placeholders. The checksum a card's
    /// prompt carries is what the bundled index is keyed by.
    func testEveryPromptIsADrawingThisBuildAlreadyHas() throws {
        let seed = try shippedSeed()
        let bundled = try bundledFlagChecksums()

        for asset in seed.page.assets {
            XCTAssertTrue(
                bundled.contains(asset.sha256),
                "\(asset.id) is prompted with a drawing the build does not ship"
            )
        }
    }

    // MARK: - Seeding

    func testAFirstLaunchWithNoNetworkStillHasACatalogue() async throws {
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        // A transport that answers nothing, which is what a fresh install on a
        // plane has.
        let coordinator = makeCoordinator(
            transport: MockClientTransport(fallbacks: [:]),
            repository: repository
        )

        await coordinator.seedFromBundleIfEmpty()
        let status = await coordinator.synchronize(locale: "en")

        XCTAssertEqual(status.lastFailure, .offline)
        let decks = try await repository.decks()
        XCTAssertFalse(decks.isEmpty)
        let cards = try await repository.cards(inDeck: try XCTUnwrap(decks.first).id)
        XCTAssertFalse(cards.isEmpty)
        // And the screens read from a release that is current, not from one
        // still being staged.
        let manifest = try await repository.currentManifest()
        XCTAssertEqual(manifest?.contentVersion.hasPrefix("bundled:"), true)
    }

    func testSeedingTwiceChangesNothing() async throws {
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let coordinator = makeCoordinator(
            transport: MockClientTransport(fallbacks: [:]),
            repository: repository
        )

        await coordinator.seedFromBundleIfEmpty()
        let first = try await repository.decks()
        XCTAssertFalse(first.isEmpty)
        await coordinator.seedFromBundleIfEmpty()

        let second = try await repository.decks()
        XCTAssertEqual(second, first)
    }

    /// The bundle is a baseline, never the truth: a device that already holds
    /// a release is left exactly as it is, however old the release.
    func testADeviceThatAlreadyHasAReleaseIsNotSeeded() async throws {
        let transport = MockClientTransport(
            fallbacks: SyntheticContent.responses(now: ContentTestClient.now)
        )
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let coordinator = makeCoordinator(transport: transport, repository: repository)
        await coordinator.synchronize(locale: "en")
        let downloaded = try await repository.decks()

        await coordinator.seedFromBundleIfEmpty()

        let afterSeed = try await repository.decks()
        XCTAssertEqual(afterSeed, downloaded)
        let manifest = try await repository.currentManifest()
        XCTAssertEqual(manifest?.contentVersion, SyntheticContent.contentVersion)
    }

    /// The reconciliation the whole design rests on: the first sync that
    /// answers replaces the seed whole, and the catalogue is the server's —
    /// not the server's plus the bundle's.
    func testTheFirstSuccessfulSyncSupersedesTheSeed() async throws {
        let transport = MockClientTransport(
            fallbacks: SyntheticContent.responses(now: ContentTestClient.now)
        )
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let coordinator = makeCoordinator(transport: transport, repository: repository)
        await coordinator.seedFromBundleIfEmpty()
        let seeded = try await repository.decks()
        XCTAssertGreaterThan(seeded.count, 0)

        let status = await coordinator.synchronize(locale: "en")

        XCTAssertNil(status.lastFailure)
        XCTAssertEqual(status.contentVersion, SyntheticContent.contentVersion)
        let decks = try await repository.decks()
        XCTAssertEqual(decks.map(\.code), ["ALL_COUNTRIES", "EUROPE"])
    }

    // MARK: - What the device reads

    func testTheCatalogueIsSeededInTheLanguageTheDeviceReads() throws {
        let catalog = try XCTUnwrap(BundledCatalog.shipped())

        let english = try XCTUnwrap(
            catalog.seed(preferredLanguages: ["en"], displayScale: 2, at: dates.now())
        )
        let russian = try XCTUnwrap(
            catalog.seed(preferredLanguages: ["ru-RU"], displayScale: 2, at: dates.now())
        )

        let englishNames = Set(english.page.cards.map(\.displayName))
        let russianNames = Set(russian.page.cards.map(\.displayName))
        XCTAssertNotEqual(englishNames, russianNames)
        XCTAssertFalse(russianNames.contains(where: \.isEmpty))
        // Both languages describe the same release, card for card.
        XCTAssertEqual(
            Set(english.page.cards.map(\.id)),
            Set(russian.page.cards.map(\.id))
        )
    }

    /// A 3x phone stores the 3x raster, the way it would have if the release
    /// had been downloaded. The checksum in the record is the one the cache
    /// verifies against and the one the bundled index is keyed by, so getting
    /// this wrong is a screen full of placeholders.
    func testTheRasterStoredIsTheOneThisScreenDraws() throws {
        let catalog = try XCTUnwrap(BundledCatalog.shipped())

        let two = try XCTUnwrap(
            catalog.seed(preferredLanguages: ["en"], displayScale: 2, at: dates.now())
        )
        let three = try XCTUnwrap(
            catalog.seed(preferredLanguages: ["en"], displayScale: 3, at: dates.now())
        )

        let atTwo = Dictionary(
            two.page.assets.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        var differed = 0
        for asset in three.page.assets {
            XCTAssertTrue(RenderableRepresentation.canRender(asset.mimeType), asset.mimeType)
            if atTwo[asset.id]?.sha256 != asset.sha256 { differed += 1 }
        }
        XCTAssertEqual(differed, three.page.assets.count)
    }

    // MARK: - Helpers

    private func shippedSeed() throws -> BundledContentSeed {
        let catalog = try XCTUnwrap(
            BundledCatalog.shipped(),
            "This build ships no catalogue; run ios/Scripts/sync-bundled-catalog.mjs"
        )
        return try XCTUnwrap(
            catalog.seed(preferredLanguages: ["en"], displayScale: 2, at: dates.now())
        )
    }

    /// The index `sync-flag-assets.mjs` writes beside the asset catalog, read
    /// from the repository rather than through the feature module this target
    /// does not depend on.
    private func bundledFlagChecksums() throws -> Set<String> {
        struct Index: Decodable { let assetNames: [String: String] }
        let url = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appending(
                path: "Sources/CountryFlagsFeatures/Resources/BundledFlags.json"
            )
        let index = try JSONDecoder().decode(Index.self, from: try Data(contentsOf: url))
        return Set(index.assetNames.keys)
    }

    private func makeCoordinator(
        transport: MockClientTransport,
        repository: any ContentRepository
    ) -> ContentBootstrapCoordinator {
        ContentBootstrapCoordinator(
            service: ContentTestClient.makeService(transport: transport, dates: dates),
            repository: repository,
            dates: dates,
            appVersion: "1.2.3",
            pageLimit: 50,
            bundledCatalog: ContentBootstrapCoordinator.shippedCatalog(
                preferredLanguages: ["en"],
                displayScale: 2,
                dates: dates
            )
        )
    }
}
