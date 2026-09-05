import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The part of the app that takes money, and every way it can go wrong.
///
/// Each test here is one outcome from §9.3 or §9.4, because those are the
/// cases nobody can reproduce on a device on demand: a payment a parent has to
/// approve, a signature that does not check out, the app killed between Apple
/// confirming and the backend hearing about it.
final class PurchaseCoordinatorTests: XCTestCase {
    private var store: LocalStore!

    override func setUp() async throws {
        try await super.setUp()
        store = try LocalStore(location: .inMemory)
        // The offer catalogue is the server's mapping from a product to the
        // rights it grants. Without it a device unlocks nothing on its own,
        // which is a rule of its own and tested below.
        try await store.makeCommerceRepository().replaceOffers([
            CommerceFixtures.offer(),
            CommerceFixtures.offer(
                code: "US_STATES_LIFETIME",
                productID: CommerceFixtures.statesProductID,
                grants: [CommerceFixtures.statesKey]
            ),
        ])
    }

    override func tearDown() async throws {
        store = nil
        try await super.tearDown()
    }

    // MARK: - A purchase that works

    /// The whole of the happy path, in the order that makes it survivable:
    /// written down, then finished with the store, then delivered.
    func testAVerifiedPurchaseIsWrittenDownFinishedAndDelivered() async throws {
        let transaction = CommerceFixtures.transaction()
        let storeDouble = ScriptedStore(outcomes: [.success(transaction)])
        let backend = ScriptedCommerceBackend(
            submitAnswers: [.snapshot(CommerceFixtures.snapshot([CommerceFixtures.coatsKey]))]
        )
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)

        let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        XCTAssertEqual(result, .purchased(entitlementKeys: [CommerceFixtures.coatsKey]))
        // Finished with the store, which only happens after the durable write.
        let finished = await storeDouble.finished
        XCTAssertEqual(finished, [transaction.transactionID])
        // Delivered, verbatim, once.
        let submissions = await backend.submissions
        XCTAssertEqual(submissions.count, 1)
        XCTAssertEqual(submissions.first?.payloads, [transaction.signedTransaction])
        // And the queue is empty, because the backend acknowledged it.
        let owed = try await store.makeCommerceRepository()
            .pendingPurchaseDeliveries(for: CommerceFixtures.userScope)
        XCTAssertTrue(owed.isEmpty)
        // The server's answer is what the device now holds.
        let snapshot = try await store.makeEntitlementRepository()
            .snapshot(scope: CommerceFixtures.userScope)
        XCTAssertEqual(snapshot.entitlementKeys, [CommerceFixtures.coatsKey])
        await coordinator.stop()
    }

    /// The purchase carries the account's store token, which is what lets the
    /// backend tell on the first claim which of our accounts paid.
    func testAPurchaseCarriesTheAccountsStoreToken() async throws {
        let token = UUID(uuidString: "a0000000-0000-4000-8000-000000000001")!
        let storeDouble = ScriptedStore(outcomes: [.success(CommerceFixtures.transaction())])
        let coordinator = makeCoordinator(
            store: storeDouble,
            backend: ScriptedCommerceBackend(),
            accountToken: token
        )

        _ = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        let calls = await storeDouble.purchaseCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.token, token)
        await coordinator.stop()
    }

    // MARK: - A purchase that does not unlock anything

    /// A payload whose signature does not check out unlocks nothing, is never
    /// handed to the backend, and leaves the person with a number they can
    /// read out to support.
    func testAnUnverifiedPurchaseUnlocksNothingAndNamesSomethingForSupport() async throws {
        let storeDouble = ScriptedStore(outcomes: [.unverified(code: "INVALID_SIGNATURE")])
        let backend = ScriptedCommerceBackend()
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)

        let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        guard case .failed(let failure) = result else {
            return XCTFail("An unverified purchase must not succeed: \(result)")
        }
        XCTAssertEqual(failure.reason, .couldNotVerify)
        XCTAssertNotNil(failure.supportID)
        // Restore stays worth offering: the money may well have moved.
        XCTAssertTrue(failure.isRetryable)
        let submissions = await backend.submissions
        XCTAssertTrue(submissions.isEmpty)
        let finished = await storeDouble.finished
        XCTAssertTrue(finished.isEmpty)
        let held = await coordinator.entitlements()
        XCTAssertTrue(held.isEmpty)
        await coordinator.stop()
    }

    /// Ask to Buy: the deck stays locked, nothing is written down, and the app
    /// is not waiting on anything the person can do.
    func testAPurchaseWaitingForApprovalStaysLocked() async throws {
        let coordinator = makeCoordinator(
            store: ScriptedStore(outcomes: [.pending]),
            backend: ScriptedCommerceBackend()
        )

        let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        XCTAssertEqual(result, .awaitingApproval)
        let held = await coordinator.entitlements()
        XCTAssertTrue(held.isEmpty)
        let owed = try await store.makeCommerceRepository()
            .pendingPurchaseDeliveries(for: CommerceFixtures.userScope)
        XCTAssertTrue(owed.isEmpty)
        await coordinator.stop()
    }

    /// Changing your mind is not an error, and must never reach an alert.
    func testACancelledPurchaseIsNotAFailure() async throws {
        let coordinator = makeCoordinator(
            store: ScriptedStore(outcomes: [.cancelled]),
            backend: ScriptedCommerceBackend()
        )

        let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        XCTAssertEqual(result, .cancelled)
        await coordinator.stop()
    }

    /// A store that could not be reached leaves both ways forward open.
    func testAStoreFailureStaysRetryableAndLeavesRestoreAvailable() async throws {
        let storeDouble = ScriptedStore(outcomes: [.failed(.network)])
        let backend = ScriptedCommerceBackend(
            submitAnswers: [.snapshot(CommerceFixtures.snapshot([CommerceFixtures.coatsKey]))]
        )
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)

        let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        guard case .failed(let failure) = result else {
            return XCTFail("A network failure must not succeed: \(result)")
        }
        XCTAssertEqual(failure.reason, .network)
        XCTAssertTrue(failure.isRetryable)

        // And restore still works, which is the other way out of this state.
        await storeDouble.setOwned([CommerceFixtures.transaction()])
        let restored = await coordinator.restorePurchases()
        guard case .restored(let keys, let found) = restored else {
            return XCTFail("Restore must stay available: \(restored)")
        }
        XCTAssertEqual(found, 1)
        XCTAssertEqual(keys, [CommerceFixtures.coatsKey])
        await coordinator.stop()
    }

    /// A guest is sent to sign in rather than shown an error, and the store is
    /// never asked for money nobody could be granted anything for.
    func testAGuestTappingBuyIsAskedToSignInFirst() async throws {
        let storeDouble = ScriptedStore(outcomes: [.success(CommerceFixtures.transaction())])
        let coordinator = makeCoordinator(
            store: storeDouble,
            backend: ScriptedCommerceBackend(),
            scope: CommerceFixtures.guestScope
        )

        let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        XCTAssertEqual(
            result,
            .failed(PurchaseFailure(reason: .accountRequired, isRetryable: true))
        )
        let calls = await storeDouble.purchaseCalls
        XCTAssertTrue(calls.isEmpty)
        await coordinator.stop()
    }

    // MARK: - The backend not being there

    /// The case the whole outbox exists for: Apple said yes, the backend
    /// cannot be reached, and the customer still gets what they paid for.
    func testAPurchaseUnlocksLocallyWhileTheBackendIsUnreachable() async throws {
        let transaction = CommerceFixtures.transaction()
        let storeDouble = ScriptedStore(outcomes: [.success(transaction)])
        let backend = ScriptedCommerceBackend(standing: .failure(CommerceFixtures.offline))
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)

        let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        XCTAssertEqual(result, .purchased(entitlementKeys: [CommerceFixtures.coatsKey]))
        // Finished with the store, because the durable record exists.
        let finished = await storeDouble.finished
        XCTAssertEqual(finished, [transaction.transactionID])
        // Still owed, and still on disk.
        let owed = try await store.makeCommerceRepository()
            .pendingPurchaseDeliveries(for: CommerceFixtures.userScope)
        XCTAssertEqual(owed.count, 1)
        XCTAssertEqual(owed.first?.state, .pending)
        XCTAssertEqual(owed.first?.signedTransaction, transaction.signedTransaction)
        await coordinator.stop()
    }

    /// The app is killed before the backend hears about it. A second launch,
    /// against the same file, delivers what the first one owed.
    func testAPurchaseReachesTheBackendAfterARelaunch() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let transaction = CommerceFixtures.transaction()

        do {
            let first = try temporary.open()
            try await first.makeCommerceRepository().replaceOffers([CommerceFixtures.offer()])
            let coordinator = makeCoordinator(
                store: ScriptedStore(outcomes: [.success(transaction)]),
                backend: ScriptedCommerceBackend(standing: .failure(CommerceFixtures.offline)),
                localStore: first
            )
            let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)
            XCTAssertEqual(result, .purchased(entitlementKeys: [CommerceFixtures.coatsKey]))
            await coordinator.stop()
        }

        // A new process, a new coordinator, the same file on disk.
        let second = try temporary.open()
        let backend = ScriptedCommerceBackend(
            submitAnswers: [.snapshot(CommerceFixtures.snapshot([CommerceFixtures.coatsKey]))]
        )
        let relaunched = makeCoordinator(
            store: ScriptedStore(),
            backend: backend,
            localStore: second
        )

        await relaunched.start()

        let submissions = await backend.submissions
        XCTAssertEqual(submissions.count, 1)
        XCTAssertEqual(submissions.first?.payloads, [transaction.signedTransaction])
        let owed = try await second.makeCommerceRepository()
            .pendingPurchaseDeliveries(for: CommerceFixtures.userScope)
        XCTAssertTrue(owed.isEmpty)
        await relaunched.stop()
    }

    /// A delivery a crash left claimed is not invisible forever: the next
    /// launch puts it back in the queue and sends it.
    func testADeliveryClaimedByARunThatDiedIsSentOnTheNextLaunch() async throws {
        let commerce = store.makeCommerceRepository()
        let transaction = CommerceFixtures.transaction()
        try await commerce.enqueuePurchaseDelivery(
            PurchaseDeliveryRecord(
                id: UUID(uuidString: "c0000000-0000-4000-8000-000000000001")!,
                transactionID: transaction.transactionID,
                signedTransaction: transaction.signedTransaction,
                productID: transaction.productID,
                state: .inFlight,
                attemptCount: 1,
                lastFailureCode: nil,
                createdAt: CommerceFixtures.instant,
                updatedAt: CommerceFixtures.instant
            ),
            for: CommerceFixtures.userScope
        )
        let backend = ScriptedCommerceBackend(
            submitAnswers: [.snapshot(CommerceFixtures.snapshot([CommerceFixtures.coatsKey]))]
        )
        let coordinator = makeCoordinator(store: ScriptedStore(), backend: backend)

        await coordinator.start()

        let submissions = await backend.submissions
        XCTAssertEqual(submissions.count, 1)
        await coordinator.stop()
    }

    /// A refusal the server will never change its mind about parks the row
    /// rather than deleting it: somebody paid for that. It also does not open
    /// the deck — the server has read the payload and said whose it is.
    func testATransactionAnotherAccountHoldsIsParkedAndOpensNothing() async throws {
        let storeDouble = ScriptedStore(outcomes: [.success(CommerceFixtures.transaction())])
        let backend = ScriptedCommerceBackend(standing: .failure(CommerceFixtures.conflict))
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)

        let result = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)

        guard case .failed(let failure) = result else {
            return XCTFail("A claimed transaction must not read as a purchase: \(result)")
        }
        XCTAssertFalse(failure.isRetryable)
        XCTAssertEqual(failure.supportID, "req-409")
        let held = await coordinator.entitlements()
        XCTAssertTrue(held.isEmpty)

        let owed = try await store.makeCommerceRepository()
            .pendingPurchaseDeliveries(for: CommerceFixtures.userScope)
        XCTAssertTrue(owed.isEmpty, "A parked row is no longer owed")

        // It is parked, not gone: a second run does not resubmit it.
        await coordinator.refreshEntitlements(trigger: .foreground)
        let submissions = await backend.submissions
        XCTAssertEqual(submissions.count, 1)
        await coordinator.stop()
    }

    // MARK: - The same purchase arriving twice

    /// A purchase and the listener hand over the same receipt by design. It is
    /// one row and one submission, whichever arrives first.
    func testTheSameTransactionFromTwoSourcesIsDeliveredOnce() async throws {
        let transaction = CommerceFixtures.transaction()
        let storeDouble = ScriptedStore(outcomes: [.success(transaction)])
        let backend = ScriptedCommerceBackend(standing: .failure(CommerceFixtures.offline))
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)
        await coordinator.start()

        _ = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)
        await storeDouble.emit(.verified(transaction))
        try await settle {
            await backend.submissions.count >= 2
        }

        let owed = try await store.makeCommerceRepository()
            .pendingPurchaseDeliveries(for: CommerceFixtures.userScope)
        XCTAssertEqual(owed.count, 1, "One store transaction is one row")
        let submissions = await backend.submissions
        XCTAssertTrue(
            submissions.allSatisfy { $0.payloads == [transaction.signedTransaction] },
            "Every attempt sends the same one payload"
        )
        // The same batch is the same key, so the backend can settle it once.
        XCTAssertEqual(Set(submissions.map(\.idempotencyKey)).count, 1)
        await coordinator.stop()
    }

    /// Two taps on the same button are one purchase.
    func testTwoSimultaneousTapsAreOnePurchase() async throws {
        let storeDouble = ScriptedStore(outcomes: [.success(CommerceFixtures.transaction())])
        let coordinator = makeCoordinator(store: storeDouble, backend: ScriptedCommerceBackend())

        async let first = coordinator.purchase(productID: CommerceFixtures.coatsProductID)
        async let second = coordinator.purchase(productID: CommerceFixtures.coatsProductID)
        let results = await [first, second]

        XCTAssertEqual(results[0], results[1])
        let calls = await storeDouble.purchaseCalls
        XCTAssertEqual(calls.count, 1)
        await coordinator.stop()
    }

    // MARK: - The catalogue

    /// The offer list is replaced by what the backend published: an offer that
    /// is gone has been withdrawn, and a client still showing it would send
    /// somebody to a product the store no longer sells.
    func testTheOfferCatalogueIsReplacedByWhatTheBackendPublished() async throws {
        let backend = ScriptedCommerceBackend(offers: [CommerceFixtures.offer()])
        let coordinator = makeCoordinator(store: ScriptedStore(), backend: backend)

        let offers = await coordinator.offers()

        XCTAssertEqual(offers.map(\.code), ["EUROPEAN_COATS_LIFETIME"])
        let asked = await backend.offerRequests
        XCTAssertEqual(asked, [.ios])
        let stored = try await store.makeCommerceRepository().offers()
        XCTAssertEqual(stored.map(\.code), ["EUROPEAN_COATS_LIFETIME"])
    }

    /// A device offline at launch shows what it downloaded last time. Nothing
    /// is unlocked by that: the store still refuses a withdrawn product, which
    /// is the check that matters.
    func testAnUnreachableBackendFallsBackToTheStoredCatalogue() async throws {
        final class RefusingBackend: CommerceBackend {
            func offers(platform: StorePlatform) async throws -> [CommerceOfferRecord] {
                throw CommerceFixtures.offline
            }
            func entitlements(entityTag: String?) async throws -> EntitlementFetch {
                throw CommerceFixtures.offline
            }
            func submitAppleTransactions(
                _ signedTransactions: [String],
                idempotencyKey: String
            ) async throws -> EntitlementSnapshotRecord {
                throw CommerceFixtures.offline
            }
        }
        let coordinator = PurchaseCoordinator(
            store: ScriptedStore(),
            products: ScriptedStore(),
            repository: store.makeCommerceRepository(),
            backend: RefusingBackend(),
            scopes: FixedCommerceScopes(scope: CommerceFixtures.userScope)
        )

        let offers = await coordinator.offers()

        XCTAssertEqual(
            Set(offers.map(\.code)),
            ["EUROPEAN_COATS_LIFETIME", "US_STATES_LIFETIME"]
        )
    }

    /// Product metadata is presentation data and nothing else: the price and
    /// the title come from the store, which is what review approved.
    func testProductMetadataComesFromTheStore() async throws {
        let snapshot = StoreProductSnapshot(
            productID: CommerceFixtures.coatsProductID,
            displayName: "European coats of arms",
            productDescription: "Sixty coats",
            displayPrice: "£4.99"
        )
        let storeDouble = ScriptedStore(catalogue: [snapshot])
        let coordinator = makeCoordinator(store: storeDouble, backend: ScriptedCommerceBackend())

        let shown = await coordinator.products(for: [
            CommerceFixtures.coatsProductID, "app.countryflags.deck.nothing.v1",
        ])

        XCTAssertEqual(shown, [snapshot])
        await coordinator.stop()
    }

    // MARK: - The listener

    /// A purchase completed somewhere else arrives at a running app, is
    /// written down, finished and delivered without anybody pressing anything.
    func testATransactionArrivingOnTheListenerIsDelivered() async throws {
        let transaction = CommerceFixtures.transaction(id: "2000000000000009")
        let storeDouble = ScriptedStore()
        let backend = ScriptedCommerceBackend(
            submitAnswers: [.snapshot(CommerceFixtures.snapshot([CommerceFixtures.coatsKey]))]
        )
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)
        await coordinator.start()

        await storeDouble.emit(.verified(transaction))
        try await settle {
            await backend.submissions.isEmpty == false
        }

        let submissions = await backend.submissions
        XCTAssertEqual(submissions.first?.payloads, [transaction.signedTransaction])
        let finished = await storeDouble.finished
        XCTAssertEqual(finished, [transaction.transactionID])
        await coordinator.stop()
    }

    /// An unverified payload on the listener is dropped: not unlocked, not
    /// written down, and above all not handed to the backend to decide.
    func testAnUnverifiedTransactionOnTheListenerIsDropped() async throws {
        let storeDouble = ScriptedStore()
        let backend = ScriptedCommerceBackend()
        let logger = RecordingLogger()
        let coordinator = makeCoordinator(store: storeDouble, backend: backend, logger: logger)
        await coordinator.start()

        await storeDouble.emit(.unverified(code: "INVALID_SIGNATURE"))
        try await settle {
            logger.transcript.contains("could not verify")
        }

        let submissions = await backend.submissions
        XCTAssertTrue(submissions.isEmpty)
        let owed = try await store.makeCommerceRepository()
            .pendingPurchaseDeliveries(for: CommerceFixtures.userScope)
        XCTAssertTrue(owed.isEmpty)
        await coordinator.stop()
    }

    // MARK: - Restore

    /// A restore that finds nothing ends neutrally. Somebody who never bought
    /// anything has not hit an error.
    func testARestoreThatFindsNothingIsNotAFailure() async throws {
        let storeDouble = ScriptedStore()
        let coordinator = makeCoordinator(store: storeDouble, backend: ScriptedCommerceBackend())

        let result = await coordinator.restorePurchases()

        XCTAssertEqual(result, .restored(entitlementKeys: [], transactionsFound: 0))
        let count = await storeDouble.restoreCount
        XCTAssertEqual(count, 1)
        await coordinator.stop()
    }

    /// A reinstall on a second device: the store knows what the Apple ID owns,
    /// the backend is told, and the answer is what the device holds.
    func testARestoreDeliversWhatTheStoreKnowsTheAppleIdOwns() async throws {
        let transaction = CommerceFixtures.transaction()
        let storeDouble = ScriptedStore(owned: [transaction])
        let backend = ScriptedCommerceBackend(
            submitAnswers: [.snapshot(CommerceFixtures.snapshot([CommerceFixtures.coatsKey]))]
        )
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)

        let result = await coordinator.restorePurchases()

        XCTAssertEqual(
            result,
            .restored(entitlementKeys: [CommerceFixtures.coatsKey], transactionsFound: 1)
        )
        let submissions = await backend.submissions
        XCTAssertEqual(submissions.first?.payloads, [transaction.signedTransaction])
        await coordinator.stop()
    }

    /// `AppStore.sync()` may show a system prompt, so it happens on a tap and
    /// on nothing else. A launch reads what the store already knows instead.
    func testALaunchNeverAsksTheStoreToSync() async throws {
        let storeDouble = ScriptedStore(owned: [CommerceFixtures.transaction()])
        let coordinator = makeCoordinator(store: storeDouble, backend: ScriptedCommerceBackend())

        await coordinator.start()
        await coordinator.refreshEntitlements(trigger: .foreground)

        let syncs = await storeDouble.restoreCount
        XCTAssertEqual(syncs, 0)
        await coordinator.stop()
    }

    /// A store that refuses to reconcile is a failure the person can retry,
    /// and it is not a purchase failure.
    func testARestoreTheStoreRefusesIsRetryable() async throws {
        let storeDouble = ScriptedStore()
        await storeDouble.setRestoreFailure(URLError(.notConnectedToInternet))
        let coordinator = makeCoordinator(store: storeDouble, backend: ScriptedCommerceBackend())

        let result = await coordinator.restorePurchases()

        guard case .failed(let failure) = result else {
            return XCTFail("A refused sync is a failure: \(result)")
        }
        XCTAssertTrue(failure.isRetryable)
        XCTAssertNotNil(failure.supportID)
        await coordinator.stop()
    }

    // MARK: - Refunds

    /// A refund arrives as a revoked transaction. It unlocks nothing locally —
    /// the server decides what is left — and it is still delivered, because
    /// the server is what has to hear about it.
    func testARefundedTransactionUnlocksNothingLocally() async throws {
        let refunded = CommerceFixtures.transaction(id: "2000000000000004", revoked: true)
        let storeDouble = ScriptedStore()
        let backend = ScriptedCommerceBackend(
            submitAnswers: [.snapshot(CommerceFixtures.snapshot([]))]
        )
        let coordinator = makeCoordinator(store: storeDouble, backend: backend)
        await coordinator.start()

        await storeDouble.emit(.verified(refunded))
        try await settle {
            await backend.submissions.isEmpty == false
        }

        let held = await coordinator.entitlements()
        XCTAssertTrue(held.isEmpty, "A revoked transaction grants nothing")
        await coordinator.stop()
    }

    // MARK: - The entitlement snapshot

    /// §7.4: after login the tag is dropped, so the next check asks in full
    /// about the account that just signed in rather than replaying a tag
    /// issued about somebody else.
    func testALoginAsksInFullAndAForegroundReplaysTheTag() async throws {
        let backend = ScriptedCommerceBackend()
        let coordinator = makeCoordinator(store: ScriptedStore(), backend: backend)

        await coordinator.refreshEntitlements(trigger: .login)
        await coordinator.refreshEntitlements(trigger: .foreground)

        let asked = await backend.entitlementRequests
        XCTAssertEqual(asked.count, 2)
        XCTAssertNil(asked.first ?? nil, "A login asks without a tag")
        XCTAssertNotNil(
            asked.last ?? nil,
            "A foreground replays the tag, so an unchanged answer costs a 304"
        )
        await coordinator.stop()
    }

    /// A `403 ENTITLEMENT_REQUIRED` is a reason to ask the server again, not a
    /// reason to guess.
    func testAnEntitlementRequiredRefusalRefreshesTheSnapshot() async throws {
        let backend = ScriptedCommerceBackend(
            entitlementAnswers: [.snapshot(CommerceFixtures.snapshot([CommerceFixtures.statesKey]))]
        )
        let coordinator = makeCoordinator(store: ScriptedStore(), backend: backend)

        await coordinator.refreshEntitlements(trigger: .entitlementRequired)

        let held = await coordinator.entitlements()
        XCTAssertEqual(held, [CommerceFixtures.statesKey])
        await coordinator.stop()
    }

    /// The snapshot is the server's answer, replaced whole. A refund arrives
    /// the same way a purchase does, so the previous answer never survives in
    /// part.
    func testTheSnapshotIsReplacedWholeRatherThanMerged() async throws {
        let backend = ScriptedCommerceBackend(
            entitlementAnswers: [
                .snapshot(
                    CommerceFixtures.snapshot([
                        CommerceFixtures.coatsKey, CommerceFixtures.statesKey,
                    ])
                ),
                .snapshot(CommerceFixtures.snapshot([CommerceFixtures.statesKey])),
            ]
        )
        let coordinator = makeCoordinator(store: ScriptedStore(), backend: backend)

        await coordinator.refreshEntitlements(trigger: .launch)
        await coordinator.refreshEntitlements(trigger: .foreground)

        let held = await coordinator.entitlements()
        XCTAssertEqual(held, [CommerceFixtures.statesKey])
        await coordinator.stop()
    }

    /// A server that cannot be reached does not take anything away: the held
    /// answer stands and the app keeps working.
    func testAFailedRefreshLeavesTheHeldAnswerStanding() async throws {
        let backend = ScriptedCommerceBackend(
            entitlementAnswers: [
                .snapshot(CommerceFixtures.snapshot([CommerceFixtures.coatsKey])),
                .failure(CommerceFixtures.offline),
            ]
        )
        let coordinator = makeCoordinator(store: ScriptedStore(), backend: backend)

        await coordinator.refreshEntitlements(trigger: .launch)
        await coordinator.refreshEntitlements(trigger: .foreground)

        let held = await coordinator.entitlements()
        XCTAssertEqual(held, [CommerceFixtures.coatsKey])
        await coordinator.stop()
    }

    // MARK: - What must never be written down

    /// The non-negotiable one. No signed payload, no store transaction
    /// identifier and no account token may appear in anything the device
    /// writes down.
    func testNothingAboutAPurchaseReachesALogLine() async throws {
        let token = UUID(uuidString: "a0000000-0000-4000-8000-00000000000f")!
        let transaction = CommerceFixtures.transaction(id: "2000000000000077")
        let unverifiable = CommerceFixtures.transaction(id: "2000000000000078")
        let logger = RecordingLogger()
        let storeDouble = ScriptedStore(
            outcomes: [.success(transaction), .unverified(code: "INVALID_SIGNATURE")]
        )
        let backend = ScriptedCommerceBackend(standing: .failure(CommerceFixtures.offline))
        let coordinator = makeCoordinator(
            store: storeDouble,
            backend: backend,
            accountToken: token,
            logger: logger
        )
        await coordinator.start()

        _ = await coordinator.purchase(productID: CommerceFixtures.coatsProductID)
        _ = await coordinator.purchase(productID: CommerceFixtures.statesProductID)
        await storeDouble.emit(.verified(unverifiable))
        await coordinator.refreshEntitlements(trigger: .foreground)
        _ = await coordinator.restorePurchases()
        try await settle { logger.lines.count >= 4 }

        let transcript = logger.transcript
        XCTAssertFalse(transcript.isEmpty, "The test proves nothing against no log at all")
        XCTAssertFalse(
            transcript.contains(transaction.signedTransaction),
            "A signed payload must never be written down"
        )
        XCTAssertFalse(transcript.contains("eyJ"), "Nor any part of one")
        XCTAssertFalse(
            transcript.contains(transaction.transactionID),
            "Nor a store transaction identifier"
        )
        XCTAssertFalse(
            transcript.contains(unverifiable.transactionID),
            "Nor one from a payload that failed to verify"
        )
        XCTAssertFalse(
            transcript.lowercased().contains(token.uuidString.lowercased()),
            "Nor the account's store token"
        )
        await coordinator.stop()
    }

    /// The same rule, one level down: a transaction printed by accident says
    /// which product it is about and nothing else.
    func testAVerifiedTransactionDescribesItselfWithoutItsPayload() {
        let transaction = CommerceFixtures.transaction()
        let printed = "\(transaction)" + String(describing: transaction)

        XCTAssertTrue(printed.contains(CommerceFixtures.coatsProductID))
        XCTAssertFalse(printed.contains(transaction.signedTransaction))
        XCTAssertFalse(printed.contains(transaction.transactionID))
    }

    // MARK: - Helpers

    private func makeCoordinator(
        store storeDouble: ScriptedStore,
        backend: ScriptedCommerceBackend,
        scope: AccountScope = CommerceFixtures.userScope,
        accountToken: UUID? = nil,
        logger: any AppLogging = NoOpLogger(),
        localStore: LocalStore? = nil
    ) -> PurchaseCoordinator {
        PurchaseCoordinator(
            store: storeDouble,
            products: storeDouble,
            repository: (localStore ?? store).makeCommerceRepository(),
            backend: backend,
            scopes: FixedCommerceScopes(scope: scope),
            accountTokens: FixedStoreAccountToken(token: accountToken),
            dates: FixedDateProvider(instant: CommerceFixtures.instant),
            identifiers: SequentialIdentifierProvider(),
            logger: logger
        )
    }

    /// Waits for work the listener does on a task of its own.
    ///
    /// Polling rather than a fixed sleep: the wait ends as soon as the
    /// condition holds, and a failure says the condition never did rather than
    /// that a guess about timing was wrong.
    private func settle(
        within limit: Duration = .seconds(2),
        until condition: @Sendable () async -> Bool
    ) async throws {
        let deadline = ContinuousClock.now.advanced(by: limit)
        while ContinuousClock.now < deadline {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        _ = await condition()
    }
}
