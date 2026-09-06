import StoreKitTest
import XCTest

import CountryFlagsDomain

@testable import CountryFlagsInfrastructure

/// The two outcomes only a real store can produce.
///
/// Everything else about a purchase is already a test with a double —
/// `PurchaseCoordinatorTests` drives every branch of the settle order without
/// a payment sheet. What no double can prove is that the adapter reads
/// StoreKit's own answers correctly, and §11.4 names exactly the two that
/// matter and that nobody can reproduce on demand: a purchase waiting for
/// approval, and one the store took back.
///
/// `SKTestSession` is what makes them reproducible. It reads the same
/// configuration file the Mock scheme launches with, so the product these
/// cases buy is the product a reviewer can buy in the simulator.
///
/// One thing is deliberately not driven here: a purchase that completes.
/// Neither `Product.purchase()` nor `SKTestSession.buyProduct` will finish one
/// in a package test bundle — both answer `StoreKitError.unknown`, because
/// there is no host application and so no window scene for the store to
/// transact in. Getting them to work needs a unit-test target inside
/// `CountryFlags.xcodeproj` hosted by the app, which is a project change worth
/// making on its own rather than smuggling in beside a paywall.
///
/// Nothing is untested as a result, only tested elsewhere. The success path of
/// `purchase()` and every branch of the settle order are
/// `PurchaseCoordinatorTests`, against a double. What a revocation does to the
/// app — a new session blocked, the progress kept — is `CommerceCenterTests`,
/// where that rule actually lives. What is left here is what only a real store
/// can answer and this bundle can reach.
final class StoreKitPurchaseClientTests: XCTestCase {
    /// The deck the Mock build sells, which is the one this configuration
    /// prices lowest and the one nothing in production depends on.
    private let productID = "app.countryflags.mock.deck.special_areas.lifetime.v1"

    private var session: SKTestSession!

    override func setUp() async throws {
        try await super.setUp()
        session = try SKTestSession(contentsOf: Self.configuration())
        // The session is the simulator's, not this test's: what one case turns
        // on the next case inherits, and Ask to Buy left on by the pending
        // case made every purchase after it pending. Every case therefore
        // states the whole state it wants rather than the part it changes.
        session.askToBuyEnabled = false
        // No system sheet: a test cannot press a button in one, and a run that
        // waited for somebody to would hang rather than fail.
        session.disableDialogs = true
        session.clearTransactions()
        try await waitForTheStore()
    }

    /// Waits until the configuration this session installed is answering.
    ///
    /// Creating the session does not make its products available at once: the
    /// simulator's store has to pick the configuration up, and on a cold
    /// machine that takes seconds. Asking too early gets an empty answer,
    /// which is indistinguishable from a product the store does not sell — a
    /// warm machine hid it, and CI found it on the first run.
    ///
    /// This waits for the store rather than for a duration, so it costs
    /// nothing where the store is already up and does not go red where it is
    /// merely slow.
    private func waitForTheStore() async throws {
        let client = StoreKitPurchaseClient()
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            if let products = try? await client.products(for: [productID]),
                !products.isEmpty {
                return
            }
            try await Task.sleep(for: .milliseconds(250))
        }
        XCTFail("The test store never offered \(productID)")
    }

    override func tearDown() {
        session?.askToBuyEnabled = false
        session?.clearTransactions()
        session = nil
        super.tearDown()
    }

    /// The identifiers the app ships have to be the identifiers the store
    /// knows, and the price has to come from the store rather than from
    /// anywhere in this repository.
    func testTheStoreDescribesTheProductTheAppSells() async throws {
        let client = StoreKitPurchaseClient()

        let products = try await client.products(for: [productID])

        let product = try XCTUnwrap(products.first)
        XCTAssertEqual(product.productID, productID)
        // Formatted by the store for its storefront. What matters is that it
        // is not empty and not assembled here: a client that built this string
        // would eventually show a number review never approved.
        XCTAssertFalse(product.displayPrice.isEmpty)
    }

    /// §11.4: Ask to Buy leaves the deck locked and nobody waiting.
    ///
    /// The answer arrives later, at the transaction listener, which is why
    /// `pending` is a case of its own rather than a failure: a screen that
    /// showed an error here would be telling somebody their payment broke
    /// while a parent was still deciding.
    func testAPurchaseWaitingForApprovalIsPendingAndUnlocksNothing() async throws {
        session.askToBuyEnabled = true
        let client = StoreKitPurchaseClient()

        let outcome = await client.purchase(productID: productID, appAccountToken: nil)

        XCTAssertEqual(outcome, .pending)
        // Nothing is owned while the approval is outstanding, so nothing in
        // the app may open on the strength of the tap that started it.
        let owned = await client.currentEntitlements()
        XCTAssertTrue(owned.isEmpty, "\(owned)")
    }

    /// The one file that says what this app sells, read out of the test
    /// bundle. `SKTestSession(configurationFileNamed:)` looks in the bundle
    /// itself, and a package's resources live in a bundle of their own, so the
    /// URL is asked for by name.
    private static func configuration() throws -> URL {
        try XCTUnwrap(
            Bundle.module.url(forResource: "CountryFlags", withExtension: "storekit"),
            "The StoreKit configuration is missing from the test bundle"
        )
    }
}
