import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// What the screens are allowed to believe about money.
///
/// Every case here is a rule a paywall reads: whether a deck is open, what its
/// price may say, and what changes when the answer moves under an open screen.
/// None of them needs a payment sheet, because none of these rules is
/// StoreKit's.
@MainActor
final class CommerceCenterTests: XCTestCase {
    private let entitlementKey = "entitlement.european_coats"
    private let productID = "app.countryflags.deck.european_coats.lifetime.v1"

    // MARK: - What opens a deck

    func testAFreeDeckIsOpenWhateverTheAccountHolds() async {
        let center = makeCenter(coordinator: FakePurchases())

        XCTAssertTrue(center.isOpen(freeDeck()))
    }

    func testAPaidDeckIsClosedUntilTheAccountHoldsItsKey() async {
        let coordinator = FakePurchases()
        let center = makeCenter(coordinator: coordinator)
        await center.start()

        XCTAssertFalse(center.isOpen(paidDeck()))

        coordinator.keys = [entitlementKey]
        await center.refresh(trigger: .foreground)

        XCTAssertTrue(center.isOpen(paidDeck()))
    }

    /// An access model published after this release is not free. The safe
    /// reading of a value the build cannot check is that it needs something.
    func testADeckWithAnUnknownAccessModelStaysClosed() {
        let deck = deck(accessModel: "SUBSCRIPTION", requiredEntitlementKey: entitlementKey)

        XCTAssertFalse(deck.isOpen(given: [entitlementKey]))
    }

    /// §11.4, the refund: after the next refresh a new session is blocked, and
    /// nothing about the learner's progress is touched by this layer.
    func testARevokedEntitlementClosesTheDeckAgain() async {
        let coordinator = FakePurchases(keys: [entitlementKey])
        var applied: [Set<String>] = []
        let center = makeCenter(coordinator: coordinator) { applied.append($0) }
        await center.start()
        XCTAssertTrue(center.isOpen(paidDeck()))

        // The server has taken it back; the device hears about it on the next
        // refresh, exactly as it hears about a purchase.
        coordinator.keys = []
        await center.refresh(trigger: .foreground)

        XCTAssertFalse(center.isOpen(paidDeck()))
        // Content is told, so the catalogue puts the deck back on the shelf.
        XCTAssertEqual(applied.last, [])
    }

    // MARK: - What a price may say

    func testAPriceIsLoadingUntilTheStoreHasAnswered() async {
        let center = makeCenter(coordinator: FakePurchases())

        // Nothing has been asked yet, so nothing may be shown. Never a
        // placeholder: this is the state the spec names as the bug.
        XCTAssertEqual(center.price(of: paidDeck()), .loading)
    }

    func testAPriceIsTheStoresOwnStringOnceItHasAnswered() async {
        let coordinator = FakePurchases(
            offers: [offer()],
            products: [
                StoreProductSnapshot(
                    productID: productID,
                    displayName: "European Coats",
                    productDescription: "",
                    displayPrice: "249,00 ₽"
                )
            ]
        )
        let center = makeCenter(coordinator: coordinator)

        await center.prepare(for: [paidDeck()])

        XCTAssertEqual(center.price(of: paidDeck()), .priced("249,00 ₽"))
    }

    /// A product the store does not sell to this account, in this storefront,
    /// today. It is not an error and it is not a wait.
    func testAProductTheStoreDoesNotAnswerForIsUnavailable() async {
        let coordinator = FakePurchases(offers: [offer()], products: [])
        let center = makeCenter(coordinator: coordinator)

        await center.prepare(for: [paidDeck()])

        XCTAssertEqual(center.price(of: paidDeck()), .unavailable)
    }

    /// The storefront flag hides the offer and never the deck: an owner keeps
    /// what they bought with it switched off.
    func testAClosedStorefrontRemovesThePriceAndNotTheDeck() async {
        let coordinator = FakePurchases(keys: [entitlementKey], offers: [offer()])
        let center = makeCenter(coordinator: coordinator, isPurchasingOffered: false)
        await center.start()

        XCTAssertEqual(center.price(of: paidDeck()), .unavailable)
        XCTAssertFalse(center.isPurchaseAvailable)
        // Owned is owned.
        XCTAssertTrue(center.isOpen(paidDeck()))
    }

    // MARK: - Buying

    func testAPurchaseThatSucceedsOpensTheDeckAndTellsContent() async {
        let coordinator = FakePurchases(offers: [offer()])
        coordinator.purchaseResult = .purchased(entitlementKeys: [entitlementKey])
        var applied: [Set<String>] = []
        let center = makeCenter(coordinator: coordinator) { applied.append($0) }
        await center.prepare(for: [paidDeck()])

        let isOpen = await center.purchase(paidDeck())

        XCTAssertTrue(isOpen)
        XCTAssertEqual(applied.last, [entitlementKey])
        XCTAssertEqual(center.phase(of: paidDeck()), .idle)
    }

    /// §11.4: a pending purchase says so, and a second tap starts no second
    /// purchase.
    func testAPendingPurchaseSaysSoAndASecondTapStartsNothing() async {
        let coordinator = FakePurchases(offers: [offer()])
        coordinator.purchaseResult = .awaitingApproval
        let center = makeCenter(coordinator: coordinator)
        await center.prepare(for: [paidDeck()])

        await center.purchase(paidDeck())
        XCTAssertEqual(center.phase(of: paidDeck()), .awaitingApproval)

        await center.purchase(paidDeck())

        XCTAssertEqual(coordinator.purchaseCount, 1)
        XCTAssertEqual(center.phase(of: paidDeck()), .awaitingApproval)
    }

    /// Changing your mind is not an error and never an alert.
    func testACancelledPurchaseLeavesTheScreenAsItWas() async {
        let coordinator = FakePurchases(offers: [offer()])
        coordinator.purchaseResult = .cancelled
        let center = makeCenter(coordinator: coordinator)
        await center.prepare(for: [paidDeck()])

        await center.purchase(paidDeck())

        XCTAssertEqual(center.phase(of: paidDeck()), .idle)
        XCTAssertFalse(center.isOpen(paidDeck()))
    }

    /// §11.3: a backend that has not acknowledged the purchase does not take
    /// it away. The deck is open and the screen says, quietly, that it is
    /// still being saved.
    func testABackendThatHasNotHeardOfThePurchaseDoesNotCloseTheDeck() async {
        // The coordinator honours the local grant; the durable snapshot — the
        // server's own answer — does not have it yet.
        let coordinator = FakePurchases(keys: [entitlementKey], offers: [offer()])
        let center = makeCenter(
            coordinator: coordinator,
            confirmed: InMemoryEntitlementRepository()
        )
        await center.start()

        XCTAssertTrue(center.isOpen(paidDeck()))
        XCTAssertTrue(center.isAwaitingSync(paidDeck()))
    }

    func testAnAcknowledgedPurchaseStopsSayingItIsBeingSaved() async {
        let scope = AccountScope.guest(installationID: UUID())
        let coordinator = FakePurchases(keys: [entitlementKey], offers: [offer()])
        let center = makeCenter(
            coordinator: coordinator,
            confirmed: InMemoryEntitlementRepository(
                snapshots: [
                    scope: EntitlementSnapshotRecord(
                        entitlementKeys: [entitlementKey],
                        checkedAt: Date(timeIntervalSince1970: 1_800_000_000)
                    )
                ]
            ),
            scopes: FixedScopes(scope: scope)
        )
        await center.start()

        XCTAssertTrue(center.isOpen(paidDeck()))
        XCTAssertFalse(center.isAwaitingSync(paidDeck()))
    }

    // MARK: - Restoring

    /// Finding nothing is a result, not a failure.
    func testARestoreThatMatchesNothingIsNeutral() async {
        let coordinator = FakePurchases()
        coordinator.restoreResult = .restored(entitlementKeys: [], transactionsFound: 0)
        let center = makeCenter(coordinator: coordinator)

        let result = await center.restorePurchases()

        XCTAssertEqual(result, .restored(entitlementKeys: [], transactionsFound: 0))
        XCTAssertFalse(center.isRestoring)
    }

    func testARestoreThatFindsThePurchaseOpensTheDeck() async {
        let coordinator = FakePurchases()
        coordinator.restoreResult = .restored(
            entitlementKeys: [entitlementKey],
            transactionsFound: 1
        )
        let center = makeCenter(coordinator: coordinator)

        await center.restorePurchases()

        XCTAssertTrue(center.isOpen(paidDeck()))
    }

    // MARK: - Fixtures

    private func makeCenter(
        coordinator: FakePurchases,
        isPurchasingOffered: Bool = true,
        confirmed: (any EntitlementRepository)? = nil,
        scopes: (any AccountScopeResolving)? = nil,
        onEntitlementsChanged: @escaping @MainActor (Set<String>) -> Void = { _ in }
    ) -> CommerceCenter {
        CommerceCenter(
            coordinator: coordinator,
            isPurchasingOffered: { isPurchasingOffered },
            confirmed: confirmed,
            scopes: scopes ?? FixedScopes(scope: .guest(installationID: UUID())),
            onEntitlementsChanged: { onEntitlementsChanged($0) }
        )
    }

    private func offer() -> CommerceOfferRecord {
        CommerceOfferRecord(
            code: "EUROPEAN_COATS_LIFETIME",
            kind: "ONE_TIME",
            storeProduct: StoreProductRecord(
                provider: "APPLE_APP_STORE",
                productID: productID
            ),
            grants: [entitlementKey],
            title: nil,
            offerDescription: nil,
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }

    private func freeDeck() -> DeckRecord {
        deck(accessModel: DeckAccessModel.free.rawValue, requiredEntitlementKey: nil)
    }

    private func paidDeck() -> DeckRecord {
        deck(
            accessModel: DeckAccessModel.entitlement.rawValue,
            requiredEntitlementKey: entitlementKey
        )
    }

    private func deck(accessModel: String, requiredEntitlementKey: String?) -> DeckRecord {
        DeckRecord(
            id: UUID(uuidString: "11111111-2222-4333-8444-555555555555")!,
            code: "EUROPEAN_COATS",
            kind: "CURATED",
            name: "European Coats",
            deckDescription: "",
            cardCount: 52,
            contentVersion: "fixture-v1",
            sortOrder: 0,
            accessModel: accessModel,
            requiredEntitlementKey: requiredEntitlementKey,
            offerCodes: ["EUROPEAN_COATS_LIFETIME"],
            contentKinds: ["COAT_OF_ARMS"]
        )
    }
}

/// Commerce with the outcome decided in advance, so a screen's rules can be
/// driven without a store, a queue or a backend.
private final class FakePurchases: PurchaseCoordinating, @unchecked Sendable {
    var keys: Set<String>
    var purchaseResult: PurchaseResult = .cancelled
    var restoreResult: RestoreResult = .restored(entitlementKeys: [], transactionsFound: 0)
    private(set) var purchaseCount = 0

    private let catalogue: [CommerceOfferRecord]
    private let catalogueProducts: [StoreProductSnapshot]

    init(
        keys: Set<String> = [],
        offers: [CommerceOfferRecord] = [],
        products: [StoreProductSnapshot] = []
    ) {
        self.keys = keys
        catalogue = offers
        catalogueProducts = products
    }

    func start() async {}

    func entitlements() async -> Set<String> { keys }

    func entitlementChanges() async -> AsyncStream<Set<String>> {
        AsyncStream { $0.finish() }
    }

    func refreshEntitlements(trigger: EntitlementRefreshTrigger) async {}

    func offers() async -> [CommerceOfferRecord] { catalogue }

    func products(for identifiers: Set<String>) async -> [StoreProductSnapshot] {
        catalogueProducts.filter { identifiers.contains($0.productID) }
    }

    func purchase(productID: String) async -> PurchaseResult {
        purchaseCount += 1
        if case .purchased(let granted) = purchaseResult {
            keys.formUnion(granted)
        }
        return purchaseResult
    }

    func restorePurchases() async -> RestoreResult {
        if case .restored(let granted, _) = restoreResult {
            keys.formUnion(granted)
        }
        return restoreResult
    }
}

/// One account, stated rather than resolved.
private struct FixedScopes: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}
