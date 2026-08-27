import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

/// The view models are driven by the repository, not by the network: every
/// state below is produced by what the store contains plus what the last sync
/// reported.
@MainActor
final class ContentStoreTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testAnEmptyStoreBeforeAnySyncIsLoading() async {
        let store = makeStore(repository: FakeContentRepository())

        await store.reload()

        XCTAssertEqual(store.catalog, .loading)
    }

    /// What the launch screen is allowed to wait on.
    ///
    /// It used to wait on `lastSyncedAt`, which is in-memory state about this
    /// run and nil on every launch — so a device holding the whole catalogue
    /// sat behind a spinner every time it started, and the store's whole
    /// reason for existing was thrown away (#266). The question is what the
    /// store holds.
    func testAStoredCatalogueIsSomethingToShowBeforeAnySync() async {
        let repository = FakeContentRepository(decks: [
            Self.deck(code: "ALL", kind: "CURATED")
        ])
        let store = makeStore(repository: repository)

        await store.reload()

        XCTAssertTrue(store.hasSomethingToShow)
        // The point of the regression: nothing has been synced in this run,
        // and the app must open anyway.
        XCTAssertNil(store.lastSyncedAt)
    }

    func testAnEmptyStoreHasNothingToShowUntilItIsRead() async {
        let store = makeStore(repository: FakeContentRepository())

        XCTAssertFalse(store.hasSomethingToShow)
    }

    /// A failed first sync with nothing stored is an answer, not a wait: the
    /// app shows its own unavailable screen, which offers a retry.
    func testAFailedFirstSyncCountsAsSomethingToShow() async {
        let store = makeStore(
            repository: FakeContentRepository(),
            synchronizer: FakeSynchronizer(status: ContentSyncStatus(lastFailure: .offline))
        )

        await store.start()

        XCTAssertTrue(store.hasSomethingToShow)
    }

    func testAStoredCatalogIsGroupedIntoSections() async {
        let repository = FakeContentRepository(decks: [
            Self.deck(code: "ALL", kind: "CURATED"),
            Self.deck(code: "EUROPE", kind: "TAXONOMY"),
        ])
        let store = makeStore(repository: repository, synchronizer: FakeSynchronizer(
            status: ContentSyncStatus(lastSuccessAt: now)
        ))

        await store.start()

        guard case .ready(let sections, let isStale, let failure) = store.catalog else {
            return XCTFail("Expected a ready catalog, got \(store.catalog)")
        }
        XCTAssertEqual(sections.map(\.kind), [.curated, .taxonomy])
        XCTAssertFalse(isStale)
        XCTAssertNil(failure)
    }

    /// The offline requirement: a relaunch with no network still shows what was
    /// downloaded, marked but not blocked.
    func testAFailedSyncStillShowsTheStoredCatalog() async {
        let repository = FakeContentRepository(decks: [Self.deck(code: "ALL", kind: "CURATED")])
        let store = makeStore(repository: repository, synchronizer: FakeSynchronizer(
            status: ContentSyncStatus(lastSuccessAt: now, lastFailure: .offline)
        ))

        await store.start()

        guard case .ready(let sections, _, let failure) = store.catalog else {
            return XCTFail("Expected a ready catalog, got \(store.catalog)")
        }
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(failure, .offline)
    }

    func testAFailedSyncWithNothingStoredIsAFailure() async {
        let store = makeStore(
            repository: FakeContentRepository(),
            synchronizer: FakeSynchronizer(status: ContentSyncStatus(lastFailure: .offline))
        )

        await store.start()

        XCTAssertEqual(store.catalog, .failed(.offline))
    }

    /// The screen may say which language it is showing, but only when the user
    /// is not reading one they asked for.
    func testTheLocaleFallbackIsReportedToTheScreen() async {
        let repository = FakeContentRepository(
            decks: [Self.deck(code: "ALL", kind: "CURATED")],
            manifest: Self.manifest(supported: ["en", "ru"], default: "en")
        )
        let store = makeStore(
            repository: repository,
            synchronizer: FakeSynchronizer(status: ContentSyncStatus(lastSuccessAt: now)),
            preferredLanguages: ["ja"]
        )

        await store.start()

        XCTAssertEqual(store.localeResolution?.locale, "en")
        XCTAssertTrue(store.localeResolution?.isFallback ?? false)
    }

    func testAMatchedLocaleIsNotReportedAsAFallback() async {
        let repository = FakeContentRepository(
            decks: [Self.deck(code: "ALL", kind: "CURATED")],
            manifest: Self.manifest(supported: ["en", "ru"], default: "en")
        )
        let store = makeStore(
            repository: repository,
            synchronizer: FakeSynchronizer(status: ContentSyncStatus(lastSuccessAt: now)),
            preferredLanguages: ["ru-RU"]
        )

        await store.start()

        XCTAssertEqual(store.localeResolution?.locale, "ru")
        XCTAssertFalse(store.localeResolution?.isFallback ?? true)
    }

    /// Pull-to-refresh goes through the same boundary as the launch sync, so
    /// there is one place that can be in flight and one status to show.
    func testRefreshDrivesTheSharedSyncBoundary() async {
        let synchronizer = FakeSynchronizer(status: ContentSyncStatus(lastSuccessAt: now))
        let store = makeStore(
            repository: FakeContentRepository(decks: [Self.deck(code: "ALL", kind: "CURATED")]),
            synchronizer: synchronizer
        )

        await store.start()
        await store.refresh()

        let count = await synchronizer.synchronizeCount
        XCTAssertEqual(count, 2)
    }

    // MARK: - Deck details

    func testDeckDetailsLoadTheCardsOfTheDeck() async {
        let deck = Self.deck(code: "ALL", kind: "CURATED")
        let repository = FakeContentRepository(
            decks: [deck],
            cards: [deck.id: [Self.card(name: "Косово", aliases: ["Kosovo"])]]
        )
        let store = makeStore(
            repository: repository,
            synchronizer: FakeSynchronizer(status: ContentSyncStatus(lastSuccessAt: now))
        )
        await store.start()

        let model = DeckDetailsModel(deckID: deck.id, store: store)
        await model.load()

        guard case .ready(let details, _, _) = model.state else {
            return XCTFail("Expected deck details, got \(model.state)")
        }
        XCTAssertEqual(details.deck.code, "ALL")
        XCTAssertEqual(details.cards.map(\.displayName), ["Косово"])
    }

    /// Searching by the alternative name is what makes "Kosovo" find "Косово"
    /// while the app is in Russian.
    func testDeckDetailsSearchMatchesAliases() async {
        let deck = Self.deck(code: "ALL", kind: "CURATED")
        let repository = FakeContentRepository(
            decks: [deck],
            cards: [
                deck.id: [
                    Self.card(name: "Косово", aliases: ["Kosovo"]),
                    Self.card(name: "Сербия", aliases: ["Serbia"]),
                ]
            ]
        )
        let store = makeStore(
            repository: repository,
            synchronizer: FakeSynchronizer(status: ContentSyncStatus(lastSuccessAt: now))
        )
        await store.start()

        let model = DeckDetailsModel(deckID: deck.id, store: store)
        await model.load()
        model.searchText = "kosovo"

        guard case .ready(let details, _, _) = model.state else {
            return XCTFail("Expected deck details, got \(model.state)")
        }
        XCTAssertEqual(details.cards.map(\.displayName), ["Косово"])
    }

    /// A search that matches nothing leaves the deck itself present: the empty
    /// state belongs to the deck, not to the query.
    func testAnEmptySearchResultIsNotAnEmptyDeck() async {
        let deck = Self.deck(code: "ALL", kind: "CURATED")
        let repository = FakeContentRepository(
            decks: [deck],
            cards: [deck.id: [Self.card(name: "Косово", aliases: [])]]
        )
        let store = makeStore(
            repository: repository,
            synchronizer: FakeSynchronizer(status: ContentSyncStatus(lastSuccessAt: now))
        )
        await store.start()

        let model = DeckDetailsModel(deckID: deck.id, store: store)
        await model.load()
        model.searchText = "антарктида"

        guard case .ready(let details, _, _) = model.state else {
            return XCTFail("Expected a ready deck, got \(model.state)")
        }
        XCTAssertTrue(details.cards.isEmpty)
    }

    // MARK: - Helpers

    private func makeStore(
        repository: FakeContentRepository,
        synchronizer: FakeSynchronizer = FakeSynchronizer(status: ContentSyncStatus()),
        preferredLanguages: [String] = ["en"]
    ) -> ContentStore {
        ContentStore(
            repository: repository,
            coordinator: synchronizer,
            dates: FixedDates(instant: now),
            preferredLanguages: preferredLanguages
        )
    }

    private static func deck(code: String, kind: String) -> DeckRecord {
        DeckRecord(
            id: UUID(),
            code: code,
            kind: kind,
            name: code,
            deckDescription: "",
            cardCount: 0,
            contentVersion: "v1",
            sortOrder: 0
        )
    }

    private static func card(name: String, aliases: [String]) -> LearningCardRecord {
        LearningCardRecord(
            id: UUID(),
            subjectEntityID: UUID(),
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: UUID(),
            displayName: name,
            aliases: aliases,
            contentVersion: "v1"
        )
    }

    private static func manifest(supported: [String], default defaultLocale: String)
        -> ContentManifestRecord
    {
        ContentManifestRecord(
            contentVersion: "v1",
            defaultLocale: defaultLocale,
            supportedLocales: supported,
            supportedTemplateSchemaVersions: [1],
            assetBaseURL: URL(string: "https://cdn.test.invalid/")!,
            changeCursor: "cursor",
            checksum: "checksum",
            appliedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}
