import Foundation

/// The implementations that are not a store.
///
/// §9.1 asks for these by name, and for three different readers: a preview
/// that has to draw a paywall without a payment sheet, a unit test that has to
/// drive every outcome in order, and a configuration built without StoreKit at
/// all. All three want the same thing — the protocols answered by something
/// with no App Store behind it — so all three are served here rather than by
/// three near-copies in three modules.

// MARK: - Entitlements over the durable store

/// `EntitlementRepository` answered out of the local commerce store.
///
/// The adapter exists because the two protocols disagree about one thing on
/// purpose: the store says `nil` for "never asked", and a caller drawing a
/// lock needs a snapshot rather than an optional. Here is where "never asked"
/// becomes an empty snapshot at `Date.distantPast` — old enough that anything
/// comparing `checkedAt` reads it as what it is.
public struct StoredEntitlementRepository: EntitlementRepository {
    private let commerce: any CommerceRepository

    public init(commerce: any CommerceRepository) {
        self.commerce = commerce
    }

    public func snapshot(scope: AccountScope) async throws -> EntitlementSnapshotRecord {
        try await commerce.entitlementSnapshot(for: scope)
            ?? .empty(checkedAt: .distantPast)
    }

    public func replace(
        _ snapshot: EntitlementSnapshotRecord,
        scope: AccountScope
    ) async throws {
        try await commerce.replaceEntitlementSnapshot(snapshot, for: scope)
    }
}

/// The same thing without a disk, for a preview or a test that only needs the
/// rules above it to have somewhere to write.
public actor InMemoryEntitlementRepository: EntitlementRepository {
    private var snapshots: [String: EntitlementSnapshotRecord]

    public init(snapshots: [AccountScope: EntitlementSnapshotRecord] = [:]) {
        self.snapshots = Dictionary(
            uniqueKeysWithValues: snapshots.map { ($0.key.key, $0.value) }
        )
    }

    public func snapshot(scope: AccountScope) async throws -> EntitlementSnapshotRecord {
        snapshots[scope.key] ?? .empty(checkedAt: .distantPast)
    }

    public func replace(
        _ snapshot: EntitlementSnapshotRecord,
        scope: AccountScope
    ) async throws {
        snapshots[scope.key] = snapshot
    }
}

// MARK: - No store at all

/// What a build without StoreKit answers.
///
/// Every call is honest about there being nothing behind it: no products, no
/// entitlements, and a purchase that fails as unavailable rather than
/// pretending to succeed. A screen written against this shows its empty state
/// instead of crashing, which is what makes the configuration worth having.
public struct UnavailableStore: StoreProductLoading, Purchasing {
    public init() {}

    public func products(for identifiers: Set<String>) async throws -> [StoreProductSnapshot] {
        []
    }

    public func purchase(productID: String, appAccountToken: UUID?) async -> PurchaseOutcome {
        .failed(.storeUnavailable(code: "NO_STORE"))
    }

    public func currentEntitlements() async -> [VerifiedStoreTransaction] { [] }

    public func restore() async throws {}

    public func finish(transactionID: String) async {}

    /// An empty stream that finishes at once, so a listener started against it
    /// ends rather than parking a task forever.
    public func transactionUpdates() async -> AsyncStream<StoreTransactionUpdate> {
        AsyncStream { $0.finish() }
    }
}

// MARK: - A store with canned answers

/// Products stated rather than fetched, for a preview.
public struct CannedStoreProductLoader: StoreProductLoading {
    private let catalog: [String: StoreProductSnapshot]

    public init(products: [StoreProductSnapshot]) {
        catalog = Dictionary(uniqueKeysWithValues: products.map { ($0.productID, $0) })
    }

    /// Only what was asked for, and only what is known. An identifier the
    /// store does not sell is absent from the answer rather than an error —
    /// which is also how the real store behaves.
    public func products(for identifiers: Set<String>) async throws -> [StoreProductSnapshot] {
        identifiers.compactMap { catalog[$0] }.sorted { $0.productID < $1.productID }
    }
}

/// A purchase whose outcome was decided before the button existed.
///
/// One outcome, returned to every call, because a preview shows one state at a
/// time. A test that needs a sequence writes its own double: putting a queue
/// in here would mean shipping a test harness in the app.
public struct CannedPurchasing: Purchasing {
    private let outcome: PurchaseOutcome
    private let owned: [VerifiedStoreTransaction]

    public init(
        outcome: PurchaseOutcome = .cancelled,
        owned: [VerifiedStoreTransaction] = []
    ) {
        self.outcome = outcome
        self.owned = owned
    }

    public func purchase(productID: String, appAccountToken: UUID?) async -> PurchaseOutcome {
        outcome
    }

    public func currentEntitlements() async -> [VerifiedStoreTransaction] { owned }

    public func restore() async throws {}

    public func finish(transactionID: String) async {}

    public func transactionUpdates() async -> AsyncStream<StoreTransactionUpdate> {
        AsyncStream { $0.finish() }
    }
}

/// A backend that answers nothing and refuses nothing.
///
/// For a preview: an empty catalogue and an empty snapshot are a legitimate
/// state of the real thing, so a screen drawn against this is a screen that
/// handles the state where the account owns nothing.
public struct EmptyCommerceBackend: CommerceBackend {
    private let checkedAt: Date

    public init(checkedAt: Date = .distantPast) {
        self.checkedAt = checkedAt
    }

    public func offers(platform: StorePlatform) async throws -> [CommerceOfferRecord] { [] }

    public func entitlements(entityTag: String?) async throws -> EntitlementFetch {
        .snapshot(.empty(checkedAt: checkedAt), entityTag: nil)
    }

    public func submitAppleTransactions(
        _ signedTransactions: [String],
        idempotencyKey: String
    ) async throws -> EntitlementSnapshotRecord {
        .empty(checkedAt: checkedAt)
    }
}
