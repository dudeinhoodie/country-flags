import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The bootstrap as a whole: manifest, paged decks, paged cards, tombstones and
/// what survives an interruption.
final class ContentBootstrapTests: XCTestCase {
    private let dates = FixedDateProvider(instant: ContentTestClient.now)

    // MARK: - Fresh install

    func testAFreshInstallEndsWithADeckTheCatalogCanShow() async throws {
        let (coordinator, repository, _) = try makeSubject()

        let status = await coordinator.synchronize(locale: "en")

        XCTAssertNil(status.lastFailure)
        XCTAssertEqual(status.contentVersion, SyntheticContent.contentVersion)
        let decks = try await repository.decks()
        XCTAssertEqual(decks.map(\.code), ["ALL_COUNTRIES", "EUROPE"])
        let cards = try await repository.cards(inDeck: UUID(uuidString: SyntheticContent.allDeckID)!)
        XCTAssertEqual(cards.count, SyntheticContent.flags.count)
        // The manifest is what makes a release readable, and it only lands once
        // every page has.
        let manifest = try await repository.currentManifest()
        XCTAssertEqual(manifest?.contentVersion, SyntheticContent.contentVersion)
    }

    /// The acceptance criterion for a repeated bootstrap: the second run must
    /// converge on the same store rather than doubling every record.
    func testASecondBootstrapCreatesNoDuplicates() async throws {
        let (coordinator, repository, transport) = try makeSubject()

        await coordinator.synchronize(locale: "en")
        let afterFirst = try await repository.decks().count
        let cardsAfterFirst = try await repository.cards(
            inDeck: UUID(uuidString: SyntheticContent.allDeckID)!
        ).count

        // A fresh coordinator, as a relaunch would build, against the same
        // store and the same release.
        let second = makeCoordinator(transport: transport, repository: repository)
        await second.synchronize(locale: "en")

        let afterSecond = try await repository.decks().count
        let cardsAfterSecond = try await repository.cards(
            inDeck: UUID(uuidString: SyntheticContent.allDeckID)!
        ).count
        XCTAssertEqual(afterSecond, afterFirst)
        XCTAssertEqual(cardsAfterSecond, cardsAfterFirst)
    }

    /// A language change re-imports the release: the version being current
    /// says nothing about the words being in the right language, so the same
    /// version asked for in a new locale is fetched and applied again.
    func testALanguageChangeReimportsTheRelease() async throws {
        let (coordinator, repository, transport) = try makeSubject()
        await coordinator.synchronize(locale: "en")
        let first = try await repository.currentManifest()
        XCTAssertEqual(first?.importedLocale, "en")

        let switched = makeCoordinator(transport: transport, repository: repository)
        await switched.synchronize(locale: "ru")

        let manifest = try await repository.currentManifest()
        XCTAssertEqual(manifest?.importedLocale, "ru")
        // The store still holds one coherent release, not a doubled one.
        let decks = try await repository.decks()
        XCTAssertEqual(decks.count, 2)
    }

    // MARK: - Paging

    func testASecondPageIsFetchedAndOrderedAfterTheFirst() async throws {
        let transport = MockClientTransport()
        await transport.always(
            SyntheticContent.manifestResponse(now: ContentTestClient.now),
            for: "getContentManifest"
        )
        await transport.always(SyntheticContent.changesResponse(), for: "getContentChanges")
        // One deck delivered over two pages.
        await transport.enqueue(
            .json("""
                {"items":[{"id":"\(SyntheticContent.allDeckID)","code":"ALL_COUNTRIES",\
                "kind":"CURATED","name":"All","description":"","cardCount":2,\
                "dueCount":null,"contentVersion":"\(SyntheticContent.contentVersion)"}],\
                "page":{"nextCursor":"deck-page-2","hasMore":true}}
                """),
            .json("""
                {"items":[{"id":"\(SyntheticContent.europeDeckID)","code":"EUROPE",\
                "kind":"TAXONOMY","name":"Europe","description":"","cardCount":1,\
                "dueCount":null,"contentVersion":"\(SyntheticContent.contentVersion)"}],\
                "page":{"nextCursor":null,"hasMore":false}}
                """),
            for: "listDecks"
        )
        await transport.always(SyntheticContent.deckCardsResponse(), for: "listDeckCards")

        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let coordinator = makeCoordinator(transport: transport, repository: repository)

        await coordinator.synchronize(locale: "en")

        let decks = try await repository.decks()
        XCTAssertEqual(decks.map(\.code), ["ALL_COUNTRIES", "EUROPE"])
        // The second page continues the order rather than restarting at zero.
        XCTAssertEqual(decks.map(\.sortOrder), [0, 1])
        let requests = await transport.requests(for: "listDecks")
        XCTAssertEqual(requests.count, 2)
        XCTAssertTrue(requests[1].path.contains("deck-page-2"))
    }

    /// The invariant behind resumability: the cursor only moves with the page
    /// it belongs to, so a run that died mid-release restarts from the last
    /// page that actually landed and replaying it changes nothing.
    func testAnInterruptedBootstrapResumesAndStaysIdempotent() async throws {
        let transport = MockClientTransport()
        await transport.always(
            SyntheticContent.manifestResponse(now: ContentTestClient.now),
            for: "getContentManifest"
        )
        await transport.always(SyntheticContent.changesResponse(), for: "getContentChanges")
        await transport.always(SyntheticContent.decksResponse(), for: "listDecks")
        // The first deck's cards land; the next request fails, which is where
        // the interruption happens.
        await transport.enqueue(
            SyntheticContent.deckCardsResponse(),
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            for: "listDeckCards"
        )

        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let interrupted = makeCoordinator(transport: transport, repository: repository)

        let failed = await interrupted.synchronize(locale: "en")
        XCTAssertNotNil(failed.lastFailure)
        // Nothing is readable yet: the release was never committed.
        let uncommitted = try await repository.currentManifest()
        XCTAssertNil(uncommitted)
        let staging = try await repository.stagingState(forVersion: SyntheticContent.contentVersion)
        XCTAssertEqual(staging?.stage, .cards)

        // The retry replays the deck whose page was lost and finishes.
        await transport.always(SyntheticContent.deckCardsResponse(), for: "listDeckCards")
        let resumed = makeCoordinator(transport: transport, repository: repository)
        let succeeded = await resumed.synchronize(locale: "en")

        XCTAssertNil(succeeded.lastFailure)
        let allCards = try await repository.cards(inDeck: UUID(uuidString: SyntheticContent.allDeckID)!)
        let europeCards = try await repository.cards(
            inDeck: UUID(uuidString: SyntheticContent.europeDeckID)!
        )
        XCTAssertEqual(allCards.count, SyntheticContent.flags.count)
        XCTAssertEqual(europeCards.count, SyntheticContent.flags.count)
        // The staging row is cleared once the release is current, so the next
        // launch does not think a download is still open.
        let clearedStaging = try await repository.stagingState(forVersion: SyntheticContent.contentVersion)
        XCTAssertNil(clearedStaging)
    }

    // MARK: - Change feed

    /// A tombstone takes a card out of selection without deleting the record an
    /// unfinished session may still be rendering.
    func testATombstoneRetiresACardConsistently() async throws {
        let (coordinator, repository, transport) = try makeSubject()
        await coordinator.synchronize(locale: "en")

        let deckID = UUID(uuidString: SyntheticContent.allDeckID)!
        let retiredID = UUID(uuidString: SyntheticContent.flags[0].cardID)!
        let beforeRetire = try await repository.cards(inDeck: deckID).count
        XCTAssertEqual(beforeRetire, SyntheticContent.flags.count)

        // The release is unchanged, so the refresh runs the change feed.
        await transport.always(
            .json("""
                {"items":[{"operation":"RETIRE","resourceType":"LEARNING_CARD",\
                "resourceId":"\(SyntheticContent.flags[0].cardID)",\
                "contentVersion":"\(SyntheticContent.contentVersion)"}],\
                "nextCursor":"mock-cursor-1","hasMore":false,\
                "contentVersion":"\(SyntheticContent.contentVersion)"}
                """),
            for: "getContentChanges"
        )
        let refreshed = makeCoordinator(transport: transport, repository: repository)
        await refreshed.synchronize(locale: "en")

        let cards = try await repository.cards(inDeck: deckID)
        XCTAssertEqual(cards.count, SyntheticContent.flags.count - 1)
        XCTAssertFalse(cards.contains { $0.id == retiredID })
    }

    /// The cursor advances with the feed, so the next launch does not replay
    /// changes it has already applied.
    func testTheChangeCursorAdvancesAfterAFeedPage() async throws {
        let (coordinator, repository, transport) = try makeSubject()
        await coordinator.synchronize(locale: "en")

        await transport.always(
            .json("""
                {"items":[],"nextCursor":"mock-cursor-9","hasMore":false,\
                "contentVersion":"\(SyntheticContent.contentVersion)"}
                """),
            for: "getContentChanges"
        )
        let refreshed = makeCoordinator(transport: transport, repository: repository)
        await refreshed.synchronize(locale: "en")

        let manifest = try await repository.currentManifest()
        XCTAssertEqual(manifest?.changeCursor, "mock-cursor-9")
    }

    // MARK: - Failure

    /// Being offline must not cost the catalog that is already on the device.
    func testAFailedRefreshKeepsTheStoredRelease() async throws {
        let (coordinator, repository, transport) = try makeSubject()
        await coordinator.synchronize(locale: "en")

        await transport.always(
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            for: "getContentManifest"
        )
        let refreshed = makeCoordinator(transport: transport, repository: repository)
        let status = await refreshed.synchronize(locale: "en")

        XCTAssertNotNil(status.lastFailure)
        let survivingDecks = try await repository.decks().count
        let survivingVersion = try await repository.currentManifest()?.contentVersion
        XCTAssertEqual(survivingDecks, 2)
        XCTAssertEqual(survivingVersion, SyntheticContent.contentVersion)
    }

    func testAnOutdatedBuildIsToldToUpdateRatherThanRetried() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                SyntheticContent.manifestResponse(now: ContentTestClient.now).body
                    .flatMap { String(data: $0, encoding: .utf8) }?
                    .replacingOccurrences(
                        of: "\"minimumClientVersion\":\"\(SyntheticContent.minimumClientVersion)\"",
                        with: "\"minimumClientVersion\":\"9.0.0\""
                    ) ?? ""
            ),
            for: "getContentManifest"
        )

        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let coordinator = makeCoordinator(transport: transport, repository: repository)

        let status = await coordinator.synchronize(locale: "en")

        XCTAssertEqual(status.lastFailure, .clientTooOld(minimumVersion: "9.0.0"))
        XCTAssertFalse(status.lastFailure?.isRetryable ?? true)
        let nothingApplied = try await repository.currentManifest()
        XCTAssertNil(nothingApplied)
    }

    /// A string comparison would call "1.10.0" older than "1.9.0" and lock a
    /// current build out of its own content.
    func testVersionsAreComparedNumerically() {
        XCTAssertTrue(ContentBootstrapCoordinator.isClientSupported(appVersion: "1.10.0", minimum: "1.9.0"))
        XCTAssertTrue(ContentBootstrapCoordinator.isClientSupported(appVersion: "1.2.3", minimum: "1.2.3"))
        XCTAssertFalse(ContentBootstrapCoordinator.isClientSupported(appVersion: "1.2.3", minimum: "1.3.0"))
        XCTAssertTrue(ContentBootstrapCoordinator.isClientSupported(appVersion: "2.0", minimum: "1.9.9"))
    }

    // MARK: - Helpers

    private func makeSubject() throws -> (ContentBootstrapCoordinator, any ContentRepository, MockClientTransport) {
        let transport = MockClientTransport(fallbacks: SyntheticContent.responses(now: ContentTestClient.now))
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        return (makeCoordinator(transport: transport, repository: repository), repository, transport)
    }

    private func makeCoordinator(
        transport: MockClientTransport,
        repository: any ContentRepository
    ) -> ContentBootstrapCoordinator {
        ContentBootstrapCoordinator(
            service: ContentTestClient.makeService(transport: transport, dates: dates),
            repository: repository,
            tags: InMemoryContentManifestTagStore(),
            dates: dates,
            appVersion: "1.2.3",
            pageLimit: 50
        )
    }
}
