import Foundation

import CountryFlagsDomain

/// Everything the app does about money, in one place that a test can drive.
///
/// It owns three things nothing else may own: the single-flight rule around a
/// purchase and a restore, the `Transaction.updates` listener, and the order
/// in which a successful purchase is settled — durable record, then `finish()`
/// with the store, then the backend, and never any other way round.
///
/// It holds no StoreKit type. What it is given is `Purchasing`,
/// `StoreProductLoading`, a queue and a backend, which is why every outcome
/// below — including the ones nobody can reproduce on demand — is a test.
public actor PurchaseCoordinator: PurchaseCoordinating {
    private let store: any Purchasing
    private let productLoader: any StoreProductLoading
    private let repository: any CommerceRepository
    private let backend: any CommerceBackend
    private let outbox: PurchaseDeliveryOutbox
    private let refresher: EntitlementRefresher
    private let scopes: any AccountScopeResolving
    private let accountTokens: any StoreAccountTokenProviding
    private let identifiers: any IdentifierProviding
    private let logger: any AppLogging

    /// One purchase per product. Two taps on the same button are one purchase,
    /// which is the race that actually happens.
    private var purchases: [String: Task<PurchaseResult, Never>] = [:]
    /// One restore at a time, whoever asked. A second `AppStore.sync()` while
    /// the first is showing its system prompt is a second system prompt.
    private var restoring: Task<RestoreResult, Never>?
    private var listener: Task<Void, Never>?

    /// Rights being honoured on a verified transaction the backend has not
    /// acknowledged yet, by account scope.
    ///
    /// In memory, and deliberately not in the stored snapshot: that row is the
    /// server's answer, replaced whole when the server answers, and a local
    /// guess written into it would be indistinguishable from one afterwards.
    /// Rebuilt at launch from what the store says this Apple ID owns, which is
    /// also where a refund disappears from — `currentEntitlements` does not
    /// list a revoked transaction.
    ///
    /// Scoped like everything else a person owns: two accounts on one device
    /// are two accounts, and a guess made about one must not open a deck for
    /// the other.
    private var provisional: [String: Set<String>] = [:]

    /// The screens listening for what this account may open.
    ///
    /// Kept by identifier so a stream that ends — a screen that went away —
    /// takes its continuation with it rather than being yielded into forever.
    private var entitlementObservers: [UUID: AsyncStream<Set<String>>.Continuation] = [:]

    public init(
        store: any Purchasing,
        products: any StoreProductLoading,
        repository: any CommerceRepository,
        backend: any CommerceBackend,
        scopes: any AccountScopeResolving,
        accountTokens: any StoreAccountTokenProviding = UnknownStoreAccountTokenProvider(),
        dates: any DateProviding = SystemDateProvider(),
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        logger: any AppLogging = NoOpLogger()
    ) {
        self.store = store
        productLoader = products
        self.repository = repository
        self.backend = backend
        self.scopes = scopes
        self.accountTokens = accountTokens
        self.identifiers = identifiers
        self.logger = logger
        outbox = PurchaseDeliveryOutbox(
            repository: repository,
            backend: backend,
            dates: dates,
            identifiers: identifiers,
            logger: logger
        )
        refresher = EntitlementRefresher(
            repository: repository,
            backend: backend,
            logger: logger
        )
    }

    // MARK: - Launch

    /// The listener first, then what the last launch left behind.
    ///
    /// In that order because the listener is the only thing that catches a
    /// transaction arriving while the rest of this runs — a purchase approved
    /// overnight is delivered the moment the process starts, and a listener
    /// started afterwards would have missed it.
    public func start() async {
        await startListening()
        let scope = await scopes.currentScope()
        await outbox.recoverInterrupted(for: scope)
        // No `AppStore.sync()`: §9.4. A launch reads what the store already
        // knows, which needs no password and shows no sheet.
        await adopt(await store.currentEntitlements(), for: scope)
        await deliverAndRefresh(scope: scope, trigger: .launch)
    }

    /// Stops the listener. A test uses it to end the actor's last task; the
    /// app does not, because there is no moment before termination at which
    /// not hearing about a purchase is an improvement.
    public func stop() {
        listener?.cancel()
        listener = nil
        for continuation in entitlementObservers.values {
            continuation.finish()
        }
        entitlementObservers.removeAll()
    }

    private func startListening() async {
        guard listener == nil else { return }
        let updates = await store.transactionUpdates()
        listener = Task { [weak self] in
            for await update in updates {
                guard let self else { return }
                await self.handle(update)
            }
        }
    }

    private func handle(_ update: StoreTransactionUpdate) async {
        switch update {
        case .unverified(let code):
            // Nothing is unlocked and nothing is delivered. An unverified
            // payload is not evidence, and handing it to the backend would ask
            // it to decide something this device already knows the answer to.
            logger.log(
                .error,
                .commerce,
                "The store offered a transaction this device could not verify",
                ["code": .safe(code)]
            )
        case .verified(let transaction):
            let scope = await scopes.currentScope()
            await adopt([transaction], for: scope)
            await deliverAndRefresh(scope: scope, trigger: .transactionUpdate)
        }
    }

    // MARK: - What may be opened

    public func entitlements() async -> Set<String> {
        let scope = await scopes.currentScope()
        return await refresher.snapshot(for: scope)
            .entitlementKeys
            .union(provisional[scope.key] ?? [])
    }

    public func entitlementChanges() -> AsyncStream<Set<String>> {
        let id = identifiers.next()
        return AsyncStream { continuation in
            entitlementObservers[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { await self?.forgetObserver(id) }
            }
        }
    }

    private func forgetObserver(_ id: UUID) {
        entitlementObservers[id] = nil
    }

    /// Says what the account may open now, to whoever is listening.
    ///
    /// Called after every settle rather than only after a purchase: the
    /// interesting cases are the ones nobody on this device asked for.
    private func announceEntitlements(for scope: AccountScope) async {
        guard !entitlementObservers.isEmpty else { return }
        let keys = await refresher.snapshot(for: scope)
            .entitlementKeys
            .union(provisional[scope.key] ?? [])
        for continuation in entitlementObservers.values {
            continuation.yield(keys)
        }
    }

    public func refreshEntitlements(trigger: EntitlementRefreshTrigger) async {
        let scope = await scopes.currentScope()
        if trigger == .foreground || trigger == .login {
            // The store may have settled something while the app was away, and
            // a sign-in may have arrived at a device holding somebody's
            // unfinished purchase.
            await adopt(await store.currentEntitlements(), for: scope)
        }
        if trigger == .login {
            await refresher.forget(scope: scope)
        }
        await deliverAndRefresh(scope: scope, trigger: trigger)
    }

    // MARK: - The catalogue

    public func offers() async -> [CommerceOfferRecord] {
        do {
            let fresh = try await backend.offers(platform: .ios)
            try await repository.replaceOffers(fresh)
            return fresh
        } catch {
            // The stored catalogue is what a device offline at launch shows.
            // An offer withdrawn since then is still refused by the store,
            // which is the check that matters.
            return (try? await repository.offers()) ?? []
        }
    }

    public func products(for identifiers: Set<String>) async -> [StoreProductSnapshot] {
        ((try? await productLoader.products(for: identifiers)) ?? [])
    }

    // MARK: - Buying

    public func purchase(productID: String) async -> PurchaseResult {
        if let running = purchases[productID] {
            return await running.value
        }
        let task = Task<PurchaseResult, Never> { [self] in
            let result = await buy(productID: productID)
            purchases[productID] = nil
            return result
        }
        purchases[productID] = task
        return await task.value
    }

    private func buy(productID: String) async -> PurchaseResult {
        let scope = await scopes.currentScope()
        // A purchase needs an account to be granted to. Signing in first is
        // the fix rather than an error to apologise for, so the reason says so
        // and the screen sends them to the sheet.
        guard !scope.isGuest else {
            return .failed(PurchaseFailure(reason: .accountRequired, isRetryable: true))
        }

        let token = await accountTokens.storeAccountToken()
        switch await store.purchase(productID: productID, appAccountToken: token) {
        case .success(let transaction):
            return await settle(transaction, for: scope)

        case .unverified(let code):
            // The money may well have moved: the store said it did and only
            // the signature is wrong. So nothing is unlocked, nothing is
            // delivered, and the identifier below is what support needs.
            let supportID = identifiers.next().uuidString
            logger.log(
                .fault,
                .commerce,
                "A purchase completed with a payload this device could not verify",
                ["code": .safe(code), "supportId": .safe(supportID)]
            )
            return .failed(
                PurchaseFailure(reason: .couldNotVerify, supportID: supportID, isRetryable: true)
            )

        case .pending:
            // Ask to Buy, and its relatives. The deck stays locked and nobody
            // is waiting on the person: the answer arrives at the listener.
            logger.log(.notice, .commerce, "A purchase is waiting for approval")
            return .awaitingApproval

        case .cancelled:
            // Not an error. Not an alert.
            return .cancelled

        case .failed(let failure):
            return .failed(Self.presentable(failure))
        }
    }

    /// The order that makes a purchase survive being killed.
    ///
    /// Disk, then the store, then the backend. Finishing before the write
    /// would leave the store with nothing to hand over again; telling the
    /// backend first would make the durable record optional, which is how a
    /// purchase becomes a support ticket.
    private func settle(
        _ transaction: VerifiedStoreTransaction,
        for scope: AccountScope
    ) async -> PurchaseResult {
        do {
            try await outbox.record(transaction, for: scope)
        } catch {
            // The store keeps the transaction: it has not been finished, so it
            // is offered again next launch and nothing has been lost.
            let supportID = identifiers.next().uuidString
            logger.log(
                .fault,
                .commerce,
                "A verified purchase could not be written down and was left unfinished",
                ["supportId": .safe(supportID)]
            )
            return .failed(
                PurchaseFailure(reason: .store, supportID: supportID, isRetryable: true)
            )
        }
        await store.finish(transactionID: transaction.transactionID)
        await grantProvisionally([transaction], for: scope)

        switch await settleWithBackend(scope: scope, trigger: .purchase) {
        case .delivered(let snapshot, _):
            return .purchased(entitlementKeys: snapshot.entitlementKeys)
        case .deferred(let failure) where !failure.isRetryable:
            // The server read the payload and refused what is in it — this
            // transaction belongs to somebody else's account. The deck does
            // not open on a guess the server has already contradicted.
            return .failed(failure)
        case .deferred, .nothingOwed:
            // Paid for, verified and written down. The deck opens now and the
            // backend is told as soon as it can be reached.
            let held = await refresher.snapshot(for: scope).entitlementKeys
            return .purchased(entitlementKeys: held.union(provisional[scope.key] ?? []))
        }
    }

    // MARK: - Restoring

    public func restorePurchases() async -> RestoreResult {
        if let restoring {
            return await restoring.value
        }
        let task = Task<RestoreResult, Never> { [self] in
            let result = await runRestore()
            restoring = nil
            return result
        }
        restoring = task
        return await task.value
    }

    private func runRestore() async -> RestoreResult {
        do {
            // The one call that MAY ask for a password, and the only place it
            // is made: a button somebody pressed.
            try await store.restore()
        } catch {
            let supportID = identifiers.next().uuidString
            logger.log(
                .notice,
                .commerce,
                "The store could not be reconciled with the account",
                ["supportId": .safe(supportID)]
            )
            return .failed(
                PurchaseFailure(reason: .store, supportID: supportID, isRetryable: true)
            )
        }

        let scope = await scopes.currentScope()
        let owned = await store.currentEntitlements()
        await adopt(owned, for: scope)
        await deliverAndRefresh(scope: scope, trigger: .restore)

        // Finding nothing is a result, not a failure: somebody who never
        // bought anything has not hit an error, and saying they have is how a
        // support ticket gets opened about a working app.
        let held = await refresher.snapshot(for: scope)
            .entitlementKeys
            .union(provisional[scope.key] ?? [])
        logger.log(
            .notice,
            .commerce,
            "A restore finished",
            ["found": .count(owned.count), "keys": .count(held.count)]
        )
        return .restored(entitlementKeys: held, transactionsFound: owned.count)
    }

    // MARK: - Shared work

    /// Writes transactions down, finishes them with the store and honours them
    /// locally.
    ///
    /// Idempotent by construction: the queue keys on the store's transaction
    /// identifier, so the same receipt arriving from a purchase, the listener
    /// and a restore is one row and one delivery.
    private func adopt(
        _ transactions: [VerifiedStoreTransaction],
        for scope: AccountScope
    ) async {
        guard !transactions.isEmpty else { return }
        guard !scope.isGuest else {
            // Nothing to grant it to yet. The transaction is left unfinished
            // on purpose: the store keeps offering it, and it is adopted the
            // moment somebody signs in.
            logger.log(
                .notice,
                .commerce,
                "The store offered a purchase while nobody was signed in; it stays with the store",
                ["count": .count(transactions.count)]
            )
            return
        }
        for transaction in transactions {
            do {
                try await outbox.record(transaction, for: scope)
            } catch {
                // Left unfinished, so it comes back.
                logger.log(
                    .error,
                    .commerce,
                    "A verified purchase could not be written down and was left unfinished",
                    ["productId": .safe(transaction.productID)]
                )
                continue
            }
            await store.finish(transactionID: transaction.transactionID)
        }
        await grantProvisionally(transactions, for: scope)
    }

    /// Turns products into the rights they grant, using the offer catalogue
    /// the backend published.
    ///
    /// The mapping is the server's, read back from the local copy of it. The
    /// device never invents a right: a product it has no offer for grants
    /// nothing until the backend answers, which it will.
    private func grantProvisionally(
        _ transactions: [VerifiedStoreTransaction],
        for scope: AccountScope
    ) async {
        let live = transactions.filter { !$0.isRevoked }
        guard !live.isEmpty else { return }
        let catalogue = (try? await repository.offers()) ?? []
        var grantsByProduct: [String: [String]] = [:]
        for offer in catalogue {
            guard let productID = offer.storeProduct?.productID else { continue }
            grantsByProduct[productID, default: []].append(contentsOf: offer.grants)
        }
        for transaction in live {
            provisional[scope.key, default: []]
                .formUnion(grantsByProduct[transaction.productID] ?? [])
        }
    }

    private func deliverAndRefresh(
        scope: AccountScope,
        trigger: EntitlementRefreshTrigger
    ) async {
        _ = await settleWithBackend(scope: scope, trigger: trigger)
    }

    /// Sends what is owed and leaves the device holding the best answer there
    /// is: the server's where it gave one, its own record where it did not.
    private func settleWithBackend(
        scope: AccountScope,
        trigger: EntitlementRefreshTrigger
    ) async -> PurchaseDeliveryOutcome {
        let outcome = await outbox.deliver(for: scope)
        switch outcome {
        case .delivered:
            // The server has now said what this account holds, so the local
            // guess has nothing left to add — and the tag the refresher was
            // holding describes something older, so it is dropped rather than
            // replayed into a `304` about an answer that has just changed.
            provisional[scope.key] = nil
            await refresher.forget(scope: scope)
        case .deferred(let failure) where !failure.isRetryable:
            // A refusal retrying cannot cure is the server having read the
            // payload and disagreed. The guess goes; what the server says
            // stands on its own.
            provisional[scope.key] = nil
            await refresher.refresh(for: scope, trigger: trigger)
        case .deferred, .nothingOwed:
            await refresher.refresh(for: scope, trigger: trigger)
        }
        await announceEntitlements(for: scope)
        return outcome
    }

    private static func presentable(_ failure: StorePurchaseFailure) -> PurchaseFailure {
        switch failure {
        case .productUnavailable:
            PurchaseFailure(reason: .productUnavailable, isRetryable: false)
        case .notAllowed:
            PurchaseFailure(reason: .purchasesNotAllowed, isRetryable: false)
        case .network:
            PurchaseFailure(reason: .network, isRetryable: true)
        case .storeUnavailable:
            PurchaseFailure(reason: .store, isRetryable: true)
        }
    }
}
