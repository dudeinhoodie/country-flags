import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

/// What the catalogue does when what the account may open changes.
///
/// Document 18 §10.6 and document 17 §10.1: a non-owner keeps discovery
/// metadata and the public preview and nothing else, a sign-out takes the paid
/// payload off the device, and a refund blocks the next session while the
/// progress stays. The rules live in the store rather than in a screen,
/// because three screens read them and none of them should decide.
@MainActor
final class PaidDeckContentRulesTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let entitlementKey = "entitlement.european_coats"

    // MARK: - Signing out

    /// The `Done when` of #329, in one test: the deck goes, and coming back
    /// brings it back.
    func testSigningOutTakesThePaidDeckAndSigningBackInBringsItBack() async {
        let paid = paidDeck()
        let repository = FakeContentRepository(
            decks: [paid, freeDeck()],
            cards: [paid.id: [card(name: "Belgium")], freeDeck().id: [card(name: "France")]]
        )
        let synchronizer = FakeSynchronizer(status: ContentSyncStatus())
        // A download after a purchase puts the cards back, which is what a
        // re-login has to be able to do without a full bootstrap.
        await synchronizer.whenLoadingCards { [weak repository] deckID in
            repository?.restore(cards: [restoredCard], inDeck: deckID)
        }
        let store = makeStore(repository: repository, synchronizer: synchronizer)

        await store.apply(entitlementKeys: [entitlementKey])
        let owned = await store.cards(inDeck: paid.id)
        XCTAssertFalse(owned.isEmpty)

        // Signing out is commerce answering for a guest, which owns nothing.
        await store.apply(entitlementKeys: [])

        let afterSignOut = await store.cards(inDeck: paid.id)
        XCTAssertTrue(afterSignOut.isEmpty, "Somebody else's purchase is still on the device")
        XCTAssertEqual(repository.removedDeckIDs, [paid.id])
        // The deck itself stays: it is still published, still searchable, and
        // still for sale.
        let stillPublished = await store.deck(id: paid.id)
        XCTAssertNotNil(stillPublished)

        await store.apply(entitlementKeys: [entitlementKey])

        let downloaded = await synchronizer.loadedDeckIDs
        XCTAssertEqual(downloaded, [paid.id])
        let afterSignIn = await store.cards(inDeck: paid.id)
        XCTAssertFalse(afterSignIn.isEmpty, "Signing back in did not restore the deck")
    }

    /// The free flow is not touched by any of this. A catalogue with no paid
    /// deck in it behaves exactly as it did before commerce existed.
    func testAFreeDeckIsNeverCleanedUp() async {
        let free = freeDeck()
        let repository = FakeContentRepository(
            decks: [free],
            cards: [free.id: [card(name: "France")]]
        )
        let store = makeStore(repository: repository)

        await store.apply(entitlementKeys: [entitlementKey])
        await store.apply(entitlementKeys: [])

        XCTAssertEqual(repository.removedDeckIDs, [])
        let cards = await store.cards(inDeck: free.id)
        XCTAssertEqual(cards.count, 1)
    }

    // MARK: - A refund

    /// §11.4: after the authoritative refresh the deck holds nothing, so no
    /// new session can be composed from it. What was learned is in another
    /// store and is not touched here.
    func testARefundLeavesTheDeckWithNothingToStudy() async {
        let paid = paidDeck()
        let repository = FakeContentRepository(
            decks: [paid],
            cards: [paid.id: [card(name: "Belgium")]]
        )
        let store = makeStore(repository: repository)
        await store.apply(entitlementKeys: [entitlementKey])

        // The server has taken it back.
        await store.apply(entitlementKeys: [])

        let remaining = await store.cards(inDeck: paid.id)
        XCTAssertTrue(remaining.isEmpty)
        // And it is on the shelf again rather than gone from the catalogue.
        guard case .ready(let sections, _, _) = store.catalog else {
            return XCTFail("The catalogue did not regroup")
        }
        XCTAssertTrue(sections.contains { $0.isFeatured })
    }

    // MARK: - A deck that was never bought

    /// A non-owner never had the cards, so there is nothing to clean and
    /// nothing to download. The metadata and the preview are what they hold.
    func testANonOwnerIsAskedToDownloadNothing() async {
        let paid = paidDeck()
        let repository = FakeContentRepository(decks: [paid])
        let synchronizer = FakeSynchronizer(status: ContentSyncStatus())
        let store = makeStore(repository: repository, synchronizer: synchronizer)

        await store.reload()

        let downloaded = await synchronizer.loadedDeckIDs
        XCTAssertEqual(downloaded, [])
        let cards = await store.cards(inDeck: paid.id)
        XCTAssertTrue(cards.isEmpty)
        let published = await store.deck(id: paid.id)
        XCTAssertNotNil(published)
    }

    // MARK: - The storefront flag

    /// `commerce.paid_decks.discovery.enabled` off: the shelf is gone, and
    /// nothing else is. Document 17 §10.
    func testWithDiscoveryOffTheShelfIsNotShown() async {
        let repository = FakeContentRepository(decks: [paidDeck(), freeDeck()])
        let store = makeStore(repository: repository, showsDecksForSale: false)

        await store.reload()

        guard case .ready(let sections, _, _) = store.catalog else {
            return XCTFail("The catalogue is not ready")
        }
        XCTAssertFalse(sections.contains { $0.isFeatured })
        XCTAssertFalse(sections.flatMap(\.decks).contains { $0.id == paidDeck().id })
        XCTAssertTrue(sections.flatMap(\.decks).contains { $0.id == freeDeck().id })
    }

    /// PD-21, and the rule no flag may break: an owner keeps what they bought
    /// with the storefront switched off.
    func testWithDiscoveryOffAnOwnerKeepsTheirDeck() async {
        let repository = FakeContentRepository(decks: [paidDeck(), freeDeck()])
        let store = makeStore(repository: repository, showsDecksForSale: false)

        await store.apply(entitlementKeys: [entitlementKey])

        guard case .ready(let sections, _, _) = store.catalog else {
            return XCTFail("The catalogue is not ready")
        }
        let shown = sections.flatMap(\.decks)
        XCTAssertTrue(
            shown.contains { $0.id == paidDeck().id },
            "A flag locked an owner out of a deck they hold"
        )
        // And as an ordinary row: a deck somebody owns is a deck.
        XCTAssertFalse(sections.contains { $0.isFeatured })
    }

    // MARK: - Fixtures

    private func makeStore(
        repository: FakeContentRepository,
        synchronizer: FakeSynchronizer = FakeSynchronizer(status: ContentSyncStatus()),
        showsDecksForSale: Bool = true
    ) -> ContentStore {
        ContentStore(
            repository: repository,
            coordinator: synchronizer,
            dates: FixedDates(instant: now),
            preferredLanguages: ["en"],
            showsDecksForSale: { showsDecksForSale }
        )
    }

    private func paidDeck() -> DeckRecord {
        DeckRecord(
            id: UUID(uuidString: "11111111-2222-4333-8444-5555555555a1")!,
            code: "EUROPEAN_COATS",
            kind: "CURATED",
            name: "European Coats",
            deckDescription: "",
            cardCount: 52,
            contentVersion: "v1",
            sortOrder: 0,
            accessModel: DeckAccessModel.entitlement.rawValue,
            requiredEntitlementKey: entitlementKey,
            offerCodes: ["EUROPEAN_COATS_LIFETIME"],
            contentKinds: ["COAT_OF_ARMS"]
        )
    }

    private func freeDeck() -> DeckRecord {
        DeckRecord(
            id: UUID(uuidString: "11111111-2222-4333-8444-5555555555a2")!,
            code: "EUROPE",
            kind: "TAXONOMY",
            name: "Europe",
            deckDescription: "",
            cardCount: 44,
            contentVersion: "v1",
            sortOrder: 1
        )
    }

    private func card(name: String) -> LearningCardRecord {
        LearningCardRecord(
            id: UUID(),
            subjectEntityID: UUID(),
            templateCode: "COAT_OF_ARMS_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: UUID(),
            displayName: name,
            aliases: [],
            contentVersion: "v1"
        )
    }
}

/// The card a download puts back, stated outside the test case so the closure
/// that restores it is not reaching into an actor-isolated fixture.
private let restoredCard = LearningCardRecord(
        id: UUID(uuidString: "22222222-2222-4333-8444-5555555555b1")!,
        subjectEntityID: UUID(uuidString: "33333333-2222-4333-8444-5555555555b1")!,
        templateCode: "COAT_OF_ARMS_TO_COUNTRY",
        templateSchemaVersion: 1,
        semanticVersion: 1,
        revision: 1,
        answerMode: "SELF_RATED",
        promptAssetID: UUID(uuidString: "44444444-2222-4333-8444-5555555555b1")!,
        displayName: "Belgium",
        aliases: [],
        contentVersion: "v1"
    )
