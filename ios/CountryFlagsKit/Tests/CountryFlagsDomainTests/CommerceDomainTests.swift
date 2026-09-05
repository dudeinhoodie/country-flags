import XCTest

@testable import CountryFlagsDomain

/// The seams a build without a store, a preview and a unit test all stand on.
final class CommerceDomainTests: XCTestCase {
    private let scope = AccountScope.authenticated(
        userID: UUID(uuidString: "80000000-0000-4000-8000-000000000001")!
    )

    /// "Never asked" is not "owns nothing". The adapter says so with a date
    /// nothing can mistake for an answer the server gave.
    func testAnAccountNobodyHasAskedAboutReadsAsEmptyAtTheBeginningOfTime() async throws {
        let repository = StoredEntitlementRepository(commerce: InMemoryCommerceStore())

        let snapshot = try await repository.snapshot(scope: scope)

        XCTAssertTrue(snapshot.entitlementKeys.isEmpty)
        XCTAssertEqual(snapshot.checkedAt, .distantPast)
    }

    func testWhatWasWrittenIsWhatIsReadBack() async throws {
        let repository = StoredEntitlementRepository(commerce: InMemoryCommerceStore())
        let answered = EntitlementSnapshotRecord(
            entitlementKeys: ["entitlement.european_coats"],
            checkedAt: Date(timeIntervalSince1970: 1_760_000_000)
        )

        try await repository.replace(answered, scope: scope)

        let snapshot = try await repository.snapshot(scope: scope)
        XCTAssertEqual(snapshot, answered)
        XCTAssertTrue(snapshot.grants("entitlement.european_coats"))
        XCTAssertFalse(snapshot.grants("entitlement.us_states"))
    }

    /// A build made without StoreKit is honest about it: nothing is for sale,
    /// nothing is owned, and a purchase fails rather than pretending.
    func testABuildWithoutAStoreSellsNothingAndPretendsNothing() async throws {
        let store = UnavailableStore()

        let outcome = await store.purchase(productID: "anything", appAccountToken: nil)

        XCTAssertEqual(outcome, .failed(.storeUnavailable(code: "NO_STORE")))
        let owned = await store.currentEntitlements()
        XCTAssertTrue(owned.isEmpty)
        let products = try await store.products(for: ["anything"])
        XCTAssertTrue(products.isEmpty)
    }

    /// A listener started against it ends rather than parking a task for the
    /// life of the process.
    func testTheStreamOfABuildWithoutAStoreFinishes() async throws {
        var received = 0
        for await _ in await UnavailableStore().transactionUpdates() {
            received += 1
        }
        XCTAssertEqual(received, 0)
    }

    /// A product the store does not sell is absent from the answer rather than
    /// an error, which is also how the real store behaves.
    func testCannedProductsAnswerOnlyWhatIsKnown() async throws {
        let known = StoreProductSnapshot(
            productID: "app.countryflags.deck.european_coats.lifetime.v1",
            displayName: "European coats of arms",
            productDescription: "Sixty coats",
            displayPrice: "£4.99"
        )

        let answered = try await CannedStoreProductLoader(products: [known])
            .products(for: [known.productID, "app.countryflags.deck.nothing.v1"])

        XCTAssertEqual(answered, [known])
    }
}

/// The commerce store without a disk. Only the entitlement half is exercised
/// here; the rest is the SwiftData actor's business and is tested against a
/// real container.
private actor InMemoryCommerceStore: CommerceRepository {
    private var snapshots: [String: EntitlementSnapshotRecord] = [:]

    func entitlementSnapshot(for scope: AccountScope) async throws -> EntitlementSnapshotRecord? {
        snapshots[scope.key]
    }

    func replaceEntitlementSnapshot(
        _ snapshot: EntitlementSnapshotRecord,
        for scope: AccountScope
    ) async throws {
        snapshots[scope.key] = snapshot
    }

    func enqueuePurchaseDelivery(
        _ delivery: PurchaseDeliveryRecord,
        for scope: AccountScope
    ) async throws {}

    func pendingPurchaseDeliveries(
        for scope: AccountScope
    ) async throws -> [PurchaseDeliveryRecord] { [] }

    func updatePurchaseDeliveryState(
        of deliveryID: UUID,
        to state: PurchaseDeliveryState,
        failureCode: String?,
        for scope: AccountScope
    ) async throws {}

    func requeueInterruptedPurchaseDeliveries(for scope: AccountScope) async throws -> Int { 0 }

    func removePurchaseDeliveries(ids: [UUID], for scope: AccountScope) async throws {}

    func offers() async throws -> [CommerceOfferRecord] { [] }

    func replaceOffers(_ offers: [CommerceOfferRecord]) async throws {}
}
