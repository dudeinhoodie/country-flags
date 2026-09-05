import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// The wire under the three commerce calls.
///
/// What is checked here is what the coordinator above cannot see: which
/// headers really leave the device, that a `304` costs no body, and that the
/// answer is turned into a domain record rather than a generated DTO.
final class CommerceServiceTests: XCTestCase {

    // MARK: - The catalogue

    func testAnOfferBecomesARecordWithTheProductThatSellsIt() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"items":[{"code":"EUROPEAN_COATS_LIFETIME","kind":"ONE_TIME",\
                "storeProduct":{"provider":"APPLE_APP_STORE",\
                "productId":"app.countryflags.deck.european_coats.lifetime.v1"},\
                "grants":["entitlement.european_coats","entitlement.bundle_europe"],\
                "title":"European coats of arms"}]}
                """
            ),
            for: "listCommerceOffers"
        )

        let offers = try await makeService(transport).offers(platform: .ios)

        XCTAssertEqual(offers.count, 1)
        XCTAssertEqual(offers.first?.code, "EUROPEAN_COATS_LIFETIME")
        XCTAssertEqual(
            offers.first?.storeProduct?.productID,
            "app.countryflags.deck.european_coats.lifetime.v1"
        )
        // A bundle grants more than one right, which is why an offer must not
        // be read as a deck.
        XCTAssertEqual(
            offers.first?.grants,
            ["entitlement.european_coats", "entitlement.bundle_europe"]
        )
        let requests = await transport.requests(for: "listCommerceOffers")
        XCTAssertEqual(requests.first?.method, "GET")
        XCTAssertTrue(requests.first?.path.contains("platform=IOS") == true)
    }

    // MARK: - What the account may open

    func testAnUnchangedSnapshotCostsAStatusLineAndNoBody() async throws {
        let transport = MockClientTransport()
        await transport.always(.init(statusCode: 304), for: "getMyEntitlements")

        let fetched = try await makeService(transport).entitlements(entityTag: "\"rev-7\"")

        XCTAssertEqual(fetched, .unchanged)
        let requests = await transport.requests(for: "getMyEntitlements")
        // Unescaped: the quotes an entity tag carries survive the generated
        // client, which is what makes the server match it at all.
        XCTAssertEqual(requests.first?.header("If-None-Match"), "\"rev-7\"")
    }

    func testASnapshotArrivesWithTheTagToReplayNextTime() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"entitlementKeys":["entitlement.european_coats"],\
                "checkedAt":"2026-09-01T10:00:00.000Z"}
                """,
                headerFields: ["etag": "\"rev-8\""]
            ),
            for: "getMyEntitlements"
        )

        let fetched = try await makeService(transport).entitlements(entityTag: nil)

        guard case .snapshot(let snapshot, let tag) = fetched else {
            return XCTFail("Expected a snapshot: \(fetched)")
        }
        XCTAssertEqual(snapshot.entitlementKeys, ["entitlement.european_coats"])
        XCTAssertEqual(tag, "\"rev-8\"")
    }

    // MARK: - Handing transactions over

    func testASubmissionCarriesThePayloadsAndTheIdempotencyKey() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"entitlementKeys":["entitlement.us_states"],\
                "checkedAt":"2026-09-01T10:00:00.000Z"}
                """
            ),
            for: "submitAppleTransactions"
        )

        let snapshot = try await makeService(transport).submitAppleTransactions(
            ["signed-one", "signed-two"],
            idempotencyKey: stampedOnce
        )

        XCTAssertEqual(snapshot.entitlementKeys, ["entitlement.us_states"])
        let requests = await transport.requests(for: "submitAppleTransactions")
        XCTAssertEqual(requests.first?.method, "POST")
        XCTAssertEqual(requests.first?.header("Idempotency-Key"), stampedOnce)
        let body = String(data: requests.first?.body ?? Data(), encoding: .utf8) ?? ""
        XCTAssertTrue(body.contains("signed-one"))
        XCTAssertTrue(body.contains("signed-two"))
        // Nothing about what the purchase is worth is sent: the server reads
        // the product out of the payload and maps it itself.
        XCTAssertFalse(body.contains("entitlement"))
        XCTAssertFalse(body.contains("offerCode"))
        XCTAssertFalse(body.contains("deckId"))
    }

    /// A transaction another live account already holds. The refusal names
    /// something support can find, and nothing about that account.
    func testATransactionAnotherAccountHoldsArrivesAsAConflict() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(
                statusCode: 409,
                code: "TRANSACTION_ALREADY_CLAIMED",
                requestID: "11111111-0000-4000-8000-000000000001"
            ),
            for: "submitAppleTransactions"
        )

        do {
            _ = try await makeService(transport).submitAppleTransactions(
                ["signed-one"],
                idempotencyKey: stampedOnce
            )
            XCTFail("A claimed transaction must not read as success")
        } catch let error as APIError {
            guard case .conflict(let details) = error else {
                return XCTFail("Expected a conflict: \(error)")
            }
            XCTAssertEqual(details.code, "TRANSACTION_ALREADY_CLAIMED")
            XCTAssertEqual(error.supportRequestID, "11111111-0000-4000-8000-000000000001")
        }
    }

    func testASubmissionThatNeverReachedTheServerIsATransportFailure() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .transportFailure(URLError(.notConnectedToInternet)),
            for: "submitAppleTransactions"
        )

        do {
            _ = try await makeService(transport).submitAppleTransactions(
                ["signed-one"],
                idempotencyKey: stampedOnce
            )
            XCTFail("An unreachable server must not read as success")
        } catch let error as APIError {
            guard case .transport = error else {
                return XCTFail("Expected a transport failure: \(error)")
            }
        }
    }

    // MARK: - Helpers

    /// The stamp that makes a retried submission land once. Any stable string
    /// of a permitted length does here: what the service owes is to send it
    /// verbatim, and what it is made of is the outbox's business.
    private let stampedOnce = "batch-of-one-and-two"

    private func makeService(_ transport: MockClientTransport) -> CommerceService {
        CommerceService(
            clientFactory: APIClientFactory(
                configuration: APITestClient.configuration,
                transport: transport,
                identifiers: SequentialIdentifierProvider(),
                retryPolicy: RetryPolicy(maximumAttempts: 1),
                scheduler: RecordingBackoffScheduler(),
                jitter: ZeroJitterProvider()
            ),
            dates: FixedDateProvider(instant: CommerceFixtures.instant)
        )
    }
}

/// The header that makes a retry land once.
final class PurchaseDeliveryIdempotencyTests: XCTestCase {
    /// The same set of transactions always produces the same key, whatever
    /// order they come out of the queue in — which is what the contract needs:
    /// the same key with the same payload returns the stored result.
    func testTheSameTransactionsAlwaysProduceTheSameKey() {
        let first = PurchaseDeliveryOutbox.idempotencyKey(for: [delivery("a"), delivery("b")])
        let reordered = PurchaseDeliveryOutbox.idempotencyKey(for: [delivery("b"), delivery("a")])

        XCTAssertEqual(first, reordered)
        XCTAssertEqual(first.count, 64, "Within the contract's 8 to 128 characters")
    }

    /// A different set is a different key, so adding a transaction to a batch
    /// is never the same request with a different body.
    func testADifferentBatchIsADifferentKey() {
        let first = PurchaseDeliveryOutbox.idempotencyKey(for: [delivery("a")])
        let second = PurchaseDeliveryOutbox.idempotencyKey(for: [delivery("a"), delivery("b")])

        XCTAssertNotEqual(first, second)
    }

    /// The key is a digest, not the identifiers: it travels through proxies
    /// and access logs this app does not own.
    func testTheKeyDoesNotCarryTheTransactionIdentifier() {
        let key = PurchaseDeliveryOutbox.idempotencyKey(for: [delivery("2000000000000001")])

        XCTAssertFalse(key.contains("2000000000000001"))
    }

    private func delivery(_ transactionID: String) -> PurchaseDeliveryRecord {
        PurchaseDeliveryRecord(
            id: UUID(),
            transactionID: transactionID,
            signedTransaction: CommerceFixtures.jws(transactionID),
            productID: CommerceFixtures.coatsProductID,
            createdAt: CommerceFixtures.instant,
            updatedAt: CommerceFixtures.instant
        )
    }
}
