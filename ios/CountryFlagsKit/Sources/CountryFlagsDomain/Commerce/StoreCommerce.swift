import Foundation

/// The seams between the app and whatever sells it things.
///
/// Nothing here imports StoreKit, and that is the whole point: the store is an
/// implementation detail of one module, so a preview, a unit test and a build
/// made without a store all talk to the same three protocols. What the app
/// believes about money is therefore testable without a payment sheet.

// MARK: - What a store says a thing is

/// A product as the store describes it, ready to be shown and nothing more.
///
/// The price is a string the store already formatted: currency, separators and
/// placement differ by storefront, and a client that assembled its own would
/// eventually show a number App Review never approved.
public struct StoreProductSnapshot: Hashable, Sendable {
    public let productID: String
    public let displayName: String
    public let productDescription: String
    /// Localized by the store, in the customer's own currency.
    public let displayPrice: String

    public init(
        productID: String,
        displayName: String,
        productDescription: String,
        displayPrice: String
    ) {
        self.productID = productID
        self.displayName = displayName
        self.productDescription = productDescription
        self.displayPrice = displayPrice
    }
}

/// A transaction the store signed and this device checked the signature of.
///
/// It carries the signed payload verbatim because the backend, not the app, is
/// what decides what a purchase is worth. Nothing here is read for meaning: a
/// client that parsed the payload would be inventing an entitlement.
///
/// The description is redacted on purpose. `String(describing:)` reaches a log
/// line, a crash report and an analytics payload far too easily for a type
/// whose stored property is a bearer of money.
public struct VerifiedStoreTransaction: Hashable, Sendable {
    /// The store's identifier for this transaction. Never logged: it is
    /// personal data, and it is what a support request must not leak.
    public let transactionID: String
    /// The identifier of the purchase this transaction descends from, which is
    /// what a restore of the same product comes back under.
    public let originalTransactionID: String
    public let productID: String
    public let purchasedAt: Date
    /// Set when the store has taken the purchase back — a refund, or a right
    /// withdrawn. It stays deliverable: the backend is told, and the backend
    /// decides what the account may still open.
    public let isRevoked: Bool
    /// The store's signed payload. Sensitive by construction.
    public let signedTransaction: String

    public init(
        transactionID: String,
        originalTransactionID: String,
        productID: String,
        purchasedAt: Date,
        isRevoked: Bool = false,
        signedTransaction: String
    ) {
        self.transactionID = transactionID
        self.originalTransactionID = originalTransactionID
        self.productID = productID
        self.purchasedAt = purchasedAt
        self.isRevoked = isRevoked
        self.signedTransaction = signedTransaction
    }
}

extension VerifiedStoreTransaction: CustomStringConvertible, CustomDebugStringConvertible {
    /// Says which product, and refuses to say anything else.
    public var description: String {
        "VerifiedStoreTransaction(productID: \(productID), revoked: \(isRevoked))"
    }

    public var debugDescription: String { description }
}

/// What the store handed over outside a purchase this app asked for.
///
/// A second device, a purchase a parent approved hours later, a refund, a
/// restore done in the App Store app: they all arrive through the same
/// channel, so the listener has to be running whether or not anybody is
/// buying anything.
public enum StoreTransactionUpdate: Hashable, Sendable {
    case verified(VerifiedStoreTransaction)
    /// A payload whose signature this device could not trust. It unlocks
    /// nothing and it is not delivered: an unverified payload is not evidence.
    case unverified(code: String)
}

// MARK: - How a purchase ends

/// The one that failed, in terms a screen can act on.
public enum StorePurchaseFailure: Hashable, Sendable {
    /// The store does not sell this product to this account, in this
    /// storefront, today.
    case productUnavailable
    /// Purchases are turned off on the device — Screen Time, a managed device.
    case notAllowed
    case network
    /// Anything else the store said, under its own stable code.
    case storeUnavailable(code: String)
}

/// Every way `purchase` can end, with no case that means two things.
public enum PurchaseOutcome: Hashable, Sendable {
    /// The store confirmed it and the signature holds. Not yet finished: the
    /// caller owes it a durable record first.
    case success(VerifiedStoreTransaction)
    /// The store confirmed it and the signature does not hold. Nothing is
    /// unlocked, and the payload is dropped rather than delivered.
    case unverified(code: String)
    /// Ask to Buy, or a payment the store still has to confirm. The deck stays
    /// locked and the answer arrives later through the transaction listener.
    case pending
    /// The person changed their mind. Not an error, and never an alert.
    case cancelled
    case failed(StorePurchaseFailure)
}

// MARK: - The three seams

/// Reads product metadata out of the store.
public protocol StoreProductLoading: Sendable {
    func products(for identifiers: Set<String>) async throws -> [StoreProductSnapshot]
}

/// Buying, restoring, and everything the store hands over unasked.
public protocol Purchasing: Sendable {
    /// - Parameter appAccountToken: the account's stable store token, which is
    ///   what lets the backend tell on the first claim which of our accounts
    ///   paid for a transaction. It is `nil` only where this build cannot
    ///   learn it — the consumer contract does not publish
    ///   `User.storeAccountToken` yet — and the purchase is then attributed by
    ///   the authenticated request that delivers it, which names the same
    ///   account and is one cross-check weaker.
    func purchase(productID: String, appAccountToken: UUID?) async -> PurchaseOutcome

    /// Everything the store currently considers this Apple ID to own. Read at
    /// launch, and cheap: it asks no network and it never prompts.
    func currentEntitlements() async -> [VerifiedStoreTransaction]

    /// Asks the store to reconcile with the account. It MAY show a system
    /// authentication prompt, so it belongs behind a button the person pressed
    /// and nowhere else.
    func restore() async throws

    /// Tells the store the app has written the transaction down and will not
    /// need it handed over again.
    ///
    /// Called only after the durable record exists. Until it is called the
    /// store keeps re-offering the transaction, which is exactly the behaviour
    /// a crash between paying and recording needs.
    func finish(transactionID: String) async

    /// The transactions the store hands over on its own.
    ///
    /// One stream per call, each of which must be consumed by exactly one
    /// listener: a second consumer would compete for the same values rather
    /// than see a copy of them.
    func transactionUpdates() async -> AsyncStream<StoreTransactionUpdate>
}

/// What one account may open, as the app last heard.
///
/// The read is total where `CommerceRepository`'s is optional: a caller
/// deciding whether to draw a lock has to be given an answer, and "never
/// asked" is an empty snapshot at `Date.distantPast` — which `checkedAt` keeps
/// distinguishable from a server that really did answer "nothing".
public protocol EntitlementRepository: Sendable {
    func snapshot(scope: AccountScope) async throws -> EntitlementSnapshotRecord
    func replace(_ snapshot: EntitlementSnapshotRecord, scope: AccountScope) async throws
}

// MARK: - The account's store token

/// Supplies the stable token that ties a purchase to one of our accounts.
///
/// A seam rather than a value because nothing publishes it yet: the token is
/// `User.storeAccountToken` on the backend and the consumer contract does not
/// return it. Until it does, a build answers `nil` here and a purchase is
/// attributed by the authenticated request that delivers it.
public protocol StoreAccountTokenProviding: Sendable {
    func storeAccountToken() async -> UUID?
}

/// The provider a build has nothing better than.
public struct UnknownStoreAccountTokenProvider: StoreAccountTokenProviding {
    public init() {}

    public func storeAccountToken() async -> UUID? { nil }
}

// MARK: - The backend's half

/// Which store's products an offer list is about.
public enum StorePlatform: String, Hashable, Sendable, CaseIterable {
    case ios = "IOS"
    case android = "ANDROID"
    case web = "WEB"
}

/// What `GET /v1/me/entitlements` answered.
public enum EntitlementFetch: Hashable, Sendable {
    case snapshot(EntitlementSnapshotRecord, entityTag: String?)
    /// The entity tag still matches, so the held snapshot stands and no body
    /// was sent. This is what makes a check on every foreground cheap.
    case unchanged
}

/// The three calls commerce makes, separated from the transport that carries
/// them so the rules above can be tested without a socket.
public protocol CommerceBackend: Sendable {
    func offers(platform: StorePlatform) async throws -> [CommerceOfferRecord]

    /// - Parameter entityTag: the tag the last snapshot arrived with, replayed
    ///   as `If-None-Match`.
    func entitlements(entityTag: String?) async throws -> EntitlementFetch

    /// Hands verified payloads over for the server to verify independently.
    ///
    /// - Parameter idempotencyKey: stable for a given set of transactions, so
    ///   a retry after a timeout lands once rather than twice.
    /// - Returns: the account's whole entitlement snapshot afterwards.
    func submitAppleTransactions(
        _ signedTransactions: [String],
        idempotencyKey: String
    ) async throws -> EntitlementSnapshotRecord
}

// MARK: - What the app above sees

/// Why the app asked the server what this account owns.
///
/// Named rather than counted: a refresh that fires far more often than these
/// moments is a bug, and a log that says which moment it was is how anyone
/// finds out.
public enum EntitlementRefreshTrigger: String, Hashable, Sendable, CaseIterable {
    case launch
    case foreground
    case login
    case purchase
    case restore
    case transactionUpdate
    /// The backend refused a deck this account was assumed to hold.
    case entitlementRequired
}

/// A purchase that did not unlock anything, in terms a screen may show.
///
/// The support identifier is minted here and written to the log beside the
/// real cause. It is never derived from a transaction identifier: a person
/// reads this number out to support, and a transaction identifier is not
/// something to read out loud.
public struct PurchaseFailure: Hashable, Sendable, Error {
    public enum Reason: String, Hashable, Sendable, CaseIterable {
        /// A guest tapped Buy. The purchase needs an account to be granted to;
        /// signing in first is the fix, not an error to apologise for.
        case accountRequired
        /// The store confirmed a payment this device could not verify. The
        /// money may well have moved, which is why restore stays available.
        case couldNotVerify
        case productUnavailable
        case purchasesNotAllowed
        case network
        case store
        /// The purchase is recorded on the device and the backend has not
        /// acknowledged it yet. It is not lost; it is queued.
        case backendUnreachable
    }

    public let reason: Reason
    /// The identifier a person hands to support.
    public let supportID: String?
    /// Whether pressing the button again, or restoring, can help.
    public let isRetryable: Bool

    public init(reason: Reason, supportID: String? = nil, isRetryable: Bool = true) {
        self.reason = reason
        self.supportID = supportID
        self.isRetryable = isRetryable
    }
}

/// How a purchase ended, once the app has done its half.
public enum PurchaseResult: Hashable, Sendable {
    /// Bought, written down, and open. The keys are what the account holds
    /// now — from the backend where it answered, from the device's own record
    /// where it has not yet.
    case purchased(entitlementKeys: Set<String>)
    /// Ask to Buy and its relatives. Still locked, and the app is not waiting
    /// on anything the person can do.
    case awaitingApproval
    case cancelled
    case failed(PurchaseFailure)
}

/// How a restore ended.
///
/// Finding nothing is `restored` with an empty set on purpose: a person who
/// never bought anything has not hit an error, and telling them they have is
/// how a support ticket gets opened about a working app.
public enum RestoreResult: Hashable, Sendable {
    case restored(entitlementKeys: Set<String>, transactionsFound: Int)
    case failed(PurchaseFailure)
}

/// Everything a screen may ask of commerce.
///
/// The whole of the store, the queue and the backend behind one protocol, so a
/// paywall can be written, previewed and tested against something that never
/// takes money.
public protocol PurchaseCoordinating: Sendable {
    /// Starts the transaction listener and settles what the last launch left
    /// behind. Called once, at launch, before anything is on screen.
    func start() async

    /// What the current account may open: the server's answer, plus anything
    /// bought on this device that the server has not acknowledged yet.
    func entitlements() async -> Set<String>

    func refreshEntitlements(trigger: EntitlementRefreshTrigger) async

    /// The offers on sale, from the local catalogue, refreshed from the
    /// backend when it can be reached.
    func offers() async -> [CommerceOfferRecord]

    /// Store metadata for products about to be shown. Presentation only:
    /// nothing here decides what anybody may open.
    func products(for identifiers: Set<String>) async -> [StoreProductSnapshot]

    func purchase(productID: String) async -> PurchaseResult

    /// Only from a button the person pressed. It MAY show a system prompt.
    func restorePurchases() async -> RestoreResult
}
