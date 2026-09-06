import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

/// The commerce funnel, and the proof that none of it carries money.
///
/// `CommerceAnalyticsPrivacyTests` proves the registry declares nowhere to put
/// a transaction, a token or a price. This drives the real thing — a store
/// whose every string is a value document 17 §17.2 forbids — and reads what
/// came out. Both halves are needed: one closes the shape, the other closes
/// today's call sites.
@MainActor
final class CommerceAnalyticsTests: XCTestCase {
    private let entitlementKey = "entitlement.european_coats"
    private let productID = "app.countryflags.deck.european_coats.lifetime.v1"

    /// Every value a purchase touches that an event may never carry. If one of
    /// these ever appears in a payload, something started passing the store's
    /// own words through.
    private static let forbidden = [
        "2000000987654321",  // a store transaction identifier
        "9F5B6C1E-1111-4222-8333-444455556666",  // an appAccountToken
        "buyer@icloud.com",  // Apple Account data
        "€4.99",  // the price, as the store formatted it
        "4.99",
        "EUR",
        "eyJ",  // the leading bytes of a signed payload
    ]

    // MARK: - The funnel

    func testTheStepsOfAPurchaseAreEachReportedOnce() async {
        let analytics = RecordingAnalytics()
        let coordinator = FakeCommerce(offers: [offer()], products: [pricedProduct()])
        coordinator.purchaseResult = .purchased(entitlementKeys: [entitlementKey])
        let center = makeCenter(coordinator: coordinator, analytics: analytics)
        await center.prepare(for: [paidDeck()])

        await center.recordImpressions(of: [paidDeck(), freeDeck()])
        await center.recordOpened(paidDeck())
        await center.recordPaywallViewed(paidDeck())
        await center.purchase(paidDeck())

        let names = await analytics.names
        let impressions = await analytics.properties(of: .paidDeckImpression)
        XCTAssertEqual(
            names,
            [
                "paid_deck.impression",
                "paid_deck.opened",
                "paywall.viewed",
                "purchase.started",
                "purchase.completed",
            ]
        )
        // A free deck is not a paid deck impression, whatever else is on the
        // shelf beside it.
        XCTAssertEqual(impressions.count, 1)
    }

    /// The catalogue draws a row many times over a scroll. What is measured is
    /// reach, so a deck is counted once.
    func testADeckSeenAgainIsNotSeenTwice() async {
        let analytics = RecordingAnalytics()
        let center = makeCenter(coordinator: FakeCommerce(), analytics: analytics)

        await center.recordImpressions(of: [paidDeck()])
        await center.recordImpressions(of: [paidDeck()])
        await center.recordOpened(paidDeck())
        await center.recordOpened(paidDeck())

        let names = await analytics.names
        XCTAssertEqual(names, ["paid_deck.impression", "paid_deck.opened"])
    }

    /// A cancellation is not an error, and it is not silence either: it is the
    /// most informative step in the funnel.
    func testACancelledPurchaseIsCountedAndIsNotAFailure() async {
        let analytics = RecordingAnalytics()
        let coordinator = FakeCommerce(offers: [offer()], products: [pricedProduct()])
        coordinator.purchaseResult = .cancelled
        let center = makeCenter(coordinator: coordinator, analytics: analytics)
        await center.prepare(for: [paidDeck()])

        await center.purchase(paidDeck())

        let names = await analytics.names
        XCTAssertEqual(names, ["purchase.started", "purchase.cancelled"])
    }

    func testAFailedPurchaseCarriesABoundedReasonAndNoSupportIdentifier() async {
        let analytics = RecordingAnalytics()
        let coordinator = FakeCommerce(offers: [offer()], products: [pricedProduct()])
        let supportID = UUID().uuidString
        coordinator.purchaseResult = .failed(
            PurchaseFailure(reason: .network, supportID: supportID)
        )
        let center = makeCenter(coordinator: coordinator, analytics: analytics)
        await center.prepare(for: [paidDeck()])

        await center.purchase(paidDeck())

        let reported = await analytics.properties(of: .purchaseFailed).first
        XCTAssertEqual(reported?["reason"], .string("network"))
        // The identifier a person reads out to support belongs in the log and
        // on the screen, not in a funnel.
        let sent = await analytics.everyString
        XCTAssertFalse(sent.contains { $0.contains(supportID) })
    }

    /// The backend answered before the deck opened, which is the healthy
    /// delivery and the one a dashboard should mostly see.
    func testAPurchaseTheBackendConfirmedIsReportedAsAcknowledged() async {
        let analytics = RecordingAnalytics()
        let scope = AccountScope.authenticated(userID: UUID())
        let coordinator = FakeCommerce(offers: [offer()], products: [pricedProduct()])
        coordinator.purchaseResult = .purchased(entitlementKeys: [entitlementKey])
        let center = CommerceCenter(
            coordinator: coordinator,
            // The server has already said this account holds it, which is what
            // the outbox delivering before the screen moves looks like.
            confirmed: InMemoryEntitlementRepository(snapshots: [
                scope: EntitlementSnapshotRecord(
                    entitlementKeys: [entitlementKey],
                    checkedAt: Date(timeIntervalSince1970: 1_800_000_000)
                )
            ]),
            scopes: OneScope(scope: scope),
            analytics: analytics,
            dates: FixedDates(instant: Date(timeIntervalSince1970: 1_800_000_000))
        )
        await center.prepare(for: [paidDeck()])

        await center.purchase(paidDeck())

        let reported = await analytics.properties(of: .purchaseCompleted).first
        XCTAssertEqual(reported?["delivery"], .string("acknowledged"))
    }

    /// The money moved and the backend has not caught up. Not a failure, and
    /// worth telling apart from a delivery that landed.
    func testAPurchaseTheBackendHasNotAcknowledgedIsReportedAsQueued() async {
        let analytics = RecordingAnalytics()
        let coordinator = FakeCommerce(offers: [offer()], products: [pricedProduct()])
        coordinator.purchaseResult = .purchased(entitlementKeys: [entitlementKey])
        let center = CommerceCenter(
            coordinator: coordinator,
            // The server's own answer, which still holds nothing.
            confirmed: InMemoryEntitlementRepository(),
            scopes: OneScope(scope: .authenticated(userID: UUID())),
            analytics: analytics,
            dates: FixedDates(instant: Date(timeIntervalSince1970: 1_800_000_000))
        )
        await center.prepare(for: [paidDeck()])

        await center.purchase(paidDeck())

        let reported = await analytics.properties(of: .purchaseCompleted).first
        XCTAssertEqual(reported?["delivery"], .string("queued"))
    }

    /// Finding nothing is its own outcome. A person who never bought anything
    /// has not hit an error.
    func testARestoreThatFoundNothingSaysSoRatherThanFailing() async {
        let analytics = RecordingAnalytics()
        let coordinator = FakeCommerce()
        coordinator.restoreResult = .restored(entitlementKeys: [], transactionsFound: 0)
        let center = makeCenter(coordinator: coordinator, analytics: analytics)

        await center.restorePurchases()

        let reported = await analytics.properties(of: .purchaseRestoreCompleted).first
        XCTAssertEqual(reported?["result"], .string("nothing_found"))
    }

    /// The paywall reports which of the three states it was in — never what
    /// the store said the deck costs.
    func testThePaywallReportsTheStateOfThePriceAndNotThePrice() async {
        let analytics = RecordingAnalytics()
        let coordinator = FakeCommerce(offers: [offer()], products: [pricedProduct()])
        let center = makeCenter(coordinator: coordinator, analytics: analytics)
        await center.prepare(for: [paidDeck()])

        await center.recordPaywallViewed(paidDeck())

        let properties = await analytics.properties(of: .paywallViewed).first
        XCTAssertEqual(properties?["offerState"], .string("priced"))
        XCTAssertEqual(properties?["isPurchaseOffered"], .boolean(true))
    }

    // MARK: - What must never be sent

    /// The one that matters: a whole purchase, driven through a store whose
    /// every string is forbidden, and nothing of it in any payload.
    func testNothingAboutTheStoreReachesAnEventPayload() async {
        let analytics = RecordingAnalytics()
        let coordinator = FakeCommerce(offers: [offer()], products: [pricedProduct()])
        coordinator.purchaseResult = .purchased(entitlementKeys: [entitlementKey])
        coordinator.restoreResult = .restored(
            entitlementKeys: [entitlementKey],
            transactionsFound: 1
        )
        let center = makeCenter(coordinator: coordinator, analytics: analytics)
        await center.prepare(for: [paidDeck()])

        await center.recordImpressions(of: [paidDeck()])
        await center.recordOpened(paidDeck())
        await center.recordPaywallViewed(paidDeck())
        await center.purchase(paidDeck())
        await center.restorePurchases()
        await center.recordStudyStarted(in: paidDeck(), mode: .selfRated)

        let sent = await analytics.everyString
        XCTAssertFalse(sent.isEmpty, "The test proves nothing against no events at all")
        for value in sent {
            for secret in Self.forbidden {
                XCTAssertFalse(
                    value.localizedCaseInsensitiveContains(secret),
                    "\(secret) reached an analytics payload"
                )
            }
        }
        // Nor the deck, the product or the entitlement it grants: which
        // country somebody is learning is not what a purchase funnel is about.
        for value in sent {
            XCTAssertFalse(value.contains(productID))
            XCTAssertFalse(value.contains(entitlementKey))
            XCTAssertFalse(value.contains(paidDeck().id.uuidString))
        }
    }

    /// A card's details say which kind of drawing it was and nothing else —
    /// not the country, not the card, not the name printed on it.
    func testACardDetailSaysOnlyWhatKindOfDrawingItWas() async {
        let analytics = RecordingAnalytics()
        let assetID = UUID()
        let repository = FakeContentRepository(
            assets: [
                assetID: AssetRecord(
                    id: assetID,
                    type: "COAT_OF_ARMS",
                    url: URL(string: "https://cdn.test.invalid/coat.png")!,
                    mimeType: "image/png",
                    sha256: String(repeating: "e", count: 64),
                    contentVersion: "v1"
                )
            ]
        )
        let store = ContentStore(
            repository: repository,
            coordinator: FakeSynchronizer(status: ContentSyncStatus()),
            analytics: analytics,
            dates: FixedDates(instant: Date(timeIntervalSince1970: 1_800_000_000))
        )

        await store.recordCardDetailOpened(promptAssetID: assetID)

        let reported = await analytics.properties(of: .cardDetailOpened).first
        XCTAssertEqual(reported, ["contentKind": .string("coat_of_arms")])
    }

    /// An asset this device does not hold is `unknown` rather than absent or
    /// invented. The event still says a detail was opened.
    func testACardWhoseDrawingIsMissingReportsAnUnknownKind() async {
        let analytics = RecordingAnalytics()
        let store = ContentStore(
            repository: FakeContentRepository(),
            coordinator: FakeSynchronizer(status: ContentSyncStatus()),
            analytics: analytics,
            dates: FixedDates(instant: Date(timeIntervalSince1970: 1_800_000_000))
        )

        await store.recordCardDetailOpened(promptAssetID: UUID())

        let reported = await analytics.properties(of: .cardDetailOpened).first
        XCTAssertEqual(reported, ["contentKind": .string("unknown")])
    }

    // MARK: - Fixtures

    private func makeCenter(
        coordinator: FakeCommerce,
        analytics: RecordingAnalytics,
        isPurchasingOffered: Bool = true
    ) -> CommerceCenter {
        CommerceCenter(
            coordinator: coordinator,
            isPurchasingOffered: { isPurchasingOffered },
            scopes: OneScope(scope: .authenticated(userID: UUID())),
            analytics: analytics,
            dates: FixedDates(instant: Date(timeIntervalSince1970: 1_800_000_000))
        )
    }

    /// A product whose every field is something an event may never carry.
    private func pricedProduct() -> StoreProductSnapshot {
        StoreProductSnapshot(
            productID: productID,
            displayName: "European Coats — buyer@icloud.com",
            productDescription: "EUR 4.99, transaction 2000000987654321",
            displayPrice: "€4.99"
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
        DeckRecord(
            id: UUID(uuidString: "11111111-2222-4333-8444-5555555555f0")!,
            code: "EUROPE",
            kind: "TAXONOMY",
            name: "Europe",
            deckDescription: "",
            cardCount: 44,
            contentVersion: "fixture-v1",
            sortOrder: 1
        )
    }

    private func paidDeck() -> DeckRecord {
        DeckRecord(
            id: UUID(uuidString: "11111111-2222-4333-8444-5555555555f1")!,
            code: "EUROPEAN_COATS",
            kind: "CURATED",
            name: "European Coats",
            deckDescription: "",
            cardCount: 52,
            contentVersion: "fixture-v1",
            sortOrder: 0,
            accessModel: DeckAccessModel.entitlement.rawValue,
            requiredEntitlementKey: entitlementKey,
            offerCodes: ["EUROPEAN_COATS_LIFETIME"],
            contentKinds: ["COAT_OF_ARMS"]
        )
    }
}

/// Commerce with the outcome decided in advance.
final class FakeCommerce: PurchaseCoordinating, @unchecked Sendable {
    var keys: Set<String>
    var purchaseResult: PurchaseResult = .cancelled
    var restoreResult: RestoreResult = .restored(entitlementKeys: [], transactionsFound: 0)

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
struct OneScope: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}
