import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// A plane, and a deck somebody has already bought.
///
/// Document 18 §10.6: an owner can open a previously downloaded deck and
/// continue offline. What makes that true is that access is answered from the
/// snapshot on disk rather than from the server, and that the cards are
/// already in the store — so nothing below reaches a network, and every call
/// that would is answered with the failure a device in flight gets.
final class PaidDeckOfflineTests: XCTestCase {
    private let deckID = UUID(uuidString: "70000000-0000-4000-8000-0000000000e1")!
    private let cardID = UUID(uuidString: "50000000-0000-4000-8000-0000000000e1")!
    private let assetID = UUID(uuidString: "40000000-0000-4000-8000-0000000000e1")!

    /// The whole rule, offline: the server said so once, and the device still
    /// knows.
    func testAnOwnerKeepsTheDeckWithNoNetworkAtAll() async throws {
        let store = try LocalStore(location: .inMemory)
        let scope = CommerceFixtures.userScope
        try await store.makeCommerceRepository()
            .replaceEntitlementSnapshot(
                CommerceFixtures.snapshot([CommerceFixtures.coatsKey]),
                for: scope
            )
        let coordinator = makeCoordinator(store: store, scope: scope)

        // Every call that would leave the device fails, exactly as it does in
        // flight. The launch has to survive that without losing the deck.
        await coordinator.start()

        let keys = await coordinator.entitlements()
        XCTAssertEqual(keys, [CommerceFixtures.coatsKey])
        XCTAssertTrue(paidDeck().isOpen(given: keys))
        await coordinator.stop()
    }

    /// And a refresh that could not reach anybody leaves the answer standing
    /// rather than emptying it. An owner who opened the app on a plane must
    /// not be told they own nothing.
    func testARefreshThatReachesNobodyLeavesTheAnswerStanding() async throws {
        let store = try LocalStore(location: .inMemory)
        let scope = CommerceFixtures.userScope
        try await store.makeCommerceRepository()
            .replaceEntitlementSnapshot(
                CommerceFixtures.snapshot([CommerceFixtures.coatsKey]),
                for: scope
            )
        let coordinator = makeCoordinator(store: store, scope: scope)
        await coordinator.start()

        await coordinator.refreshEntitlements(trigger: .foreground)

        let keys = await coordinator.entitlements()
        XCTAssertEqual(keys, [CommerceFixtures.coatsKey])
        await coordinator.stop()
    }

    /// The cards are the other half: a deck that is open and holds nothing is
    /// no better than a locked one. What was downloaded before the plane is
    /// still readable with nothing running.
    func testTheDownloadedCardsAreStillThereToStudy() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()
        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(version: "offline-fixture-v1"),
            entities: [PersistenceFixtures.entity(version: "offline-fixture-v1")],
            decks: [paidDeck()],
            cards: [card()],
            deckCards: [DeckCardRecord(deckID: deckID, learningCardID: cardID, sortOrder: 0)]
        )
        try await content.applyStagedPage(
            ContentPage(assets: [asset()]),
            staging: ContentStagingState(
                contentVersion: "offline-fixture-v1",
                stage: .ready,
                cursor: nil,
                pendingDeckIDs: [],
                updatedAt: PersistenceFixtures.instant
            )
        )

        let cards = try await content.cards(inDeck: deckID)

        XCTAssertEqual(cards.map(\.id), [cardID])
        // The drawing too: a session that cannot render its prompt is not a
        // session anybody can sit through.
        let drawing = try await content.asset(id: assetID)
        XCTAssertNotNil(drawing)
    }

    // MARK: - Harness

    /// A coordinator whose backend is unreachable and whose store has nothing
    /// to say, which is a device with the radio off.
    private func makeCoordinator(store: LocalStore, scope: AccountScope) -> PurchaseCoordinator {
        let storeDouble = ScriptedStore()
        return PurchaseCoordinator(
            store: storeDouble,
            products: storeDouble,
            repository: store.makeCommerceRepository(),
            backend: ScriptedCommerceBackend(standing: .failure(CommerceFixtures.offline)),
            scopes: FixedCommerceScopes(scope: scope),
            dates: FixedDateProvider(instant: CommerceFixtures.instant),
            identifiers: SequentialIdentifierProvider(),
            logger: NoOpLogger()
        )
    }

    private func paidDeck() -> DeckRecord {
        DeckRecord(
            id: deckID,
            code: "EUROPEAN_COATS",
            kind: "CURATED",
            name: "European Coats",
            deckDescription: "",
            cardCount: 1,
            contentVersion: "offline-fixture-v1",
            sortOrder: 0,
            accessModel: DeckAccessModel.entitlement.rawValue,
            requiredEntitlementKey: CommerceFixtures.coatsKey,
            offerCodes: ["EUROPEAN_COATS_LIFETIME"],
            contentKinds: ["COAT_OF_ARMS"]
        )
    }

    private func card() -> LearningCardRecord {
        LearningCardRecord(
            id: cardID,
            subjectEntityID: PersistenceFixtures.entityID,
            templateCode: "COAT_OF_ARMS_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: assetID,
            displayName: "Belgium",
            aliases: [],
            contentVersion: "offline-fixture-v1"
        )
    }

    private func asset() -> AssetRecord {
        AssetRecord(
            id: assetID,
            type: "COAT_OF_ARMS",
            url: URL(string: "https://cdn.test.invalid/coat.png")!,
            mimeType: "image/png",
            sha256: String(repeating: "d", count: 64),
            contentVersion: "offline-fixture-v1"
        )
    }
}
