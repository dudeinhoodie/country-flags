import Foundation

/// The value types the commerce store exchanges with the rest of the app.
///
/// Nothing here imports StoreKit, and nothing here is a purchase flow: these
/// are the shapes a purchase has to survive a relaunch in. A transaction the
/// store verified but the backend has not seen yet is money the customer has
/// already spent, so it lives on disk rather than in a task.

/// Everything one account may open, as the server last said.
///
/// A snapshot rather than a row per right: it is replaced whole, and
/// `checkedAt` describes the answer rather than any one key in it. A client
/// may open a deck on a verified store transaction it holds locally, but this
/// is the answer that decides.
public struct EntitlementSnapshotRecord: Hashable, Sendable {
    public let entitlementKeys: Set<String>
    /// When the server last established this snapshot — its own clock, not
    /// the device's.
    public let checkedAt: Date

    public init(entitlementKeys: Set<String>, checkedAt: Date) {
        self.entitlementKeys = entitlementKeys
        self.checkedAt = checkedAt
    }

    /// What an account that has never been asked about holds.
    public static func empty(checkedAt: Date) -> EntitlementSnapshotRecord {
        EntitlementSnapshotRecord(entitlementKeys: [], checkedAt: checkedAt)
    }

    public func grants(_ entitlementKey: String) -> Bool {
        entitlementKeys.contains(entitlementKey)
    }
}

/// Where a verified transaction is in its journey to the backend.
public enum PurchaseDeliveryState: String, Hashable, Sendable, CaseIterable {
    /// Waiting to be sent.
    case pending
    /// Claimed by an attempt that has not finished.
    case inFlight
    /// The backend refused it in a way retrying cannot cure. The row stays:
    /// a purchase the customer paid for is not something to delete quietly.
    case permanentFailure
}

/// A verified store transaction waiting for the backend to see it.
///
/// It is durable on purpose. The store finishes a transaction once, and the
/// app finishes it only after this row is on disk: a delivery that lived in
/// memory would be a purchase lost to a crash, with nothing left to replay.
public struct PurchaseDeliveryRecord: Hashable, Sendable {
    public let id: UUID
    /// The store's own identifier for the transaction, which is what makes a
    /// second submission of the same purchase the same row rather than a new
    /// one.
    public let transactionID: String
    /// The store's signed payload, verbatim. Nothing is read out of it here:
    /// the backend verifies the signature and decides what the purchase is
    /// worth, and a client that parsed it would be inventing an entitlement.
    public let signedTransaction: String
    /// The product the store named, kept only so a diagnostic can say which
    /// purchase is stuck. It grants nothing.
    public let productID: String?
    public let state: PurchaseDeliveryState
    public let attemptCount: Int
    public let lastFailureCode: String?
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUID,
        transactionID: String,
        signedTransaction: String,
        productID: String? = nil,
        state: PurchaseDeliveryState = .pending,
        attemptCount: Int = 0,
        lastFailureCode: String? = nil,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.transactionID = transactionID
        self.signedTransaction = signedTransaction
        self.productID = productID
        self.state = state
        self.attemptCount = attemptCount
        self.lastFailureCode = lastFailureCode
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// The store product an offer is sold as, in the store's terms.
public struct StoreProductRecord: Hashable, Sendable {
    public let provider: String
    public let productID: String

    public init(provider: String, productID: String) {
        self.provider = provider
        self.productID = productID
    }
}

/// Something for sale, in this product's terms rather than a store's.
///
/// The copy here is a fallback for a client the store has not answered yet.
/// What the customer is shown at the moment of paying comes from the store,
/// which is also what review approved.
public struct CommerceOfferRecord: Hashable, Sendable {
    public let code: String
    public let kind: String
    public let storeProduct: StoreProductRecord?
    /// The rights a purchase of this offer grants. A bundle grants more than
    /// one, which is why an offer must not be read as a deck.
    public let grants: [String]
    public let title: String?
    public let offerDescription: String?
    public let updatedAt: Date

    public init(
        code: String,
        kind: String,
        storeProduct: StoreProductRecord?,
        grants: [String],
        title: String?,
        offerDescription: String?,
        updatedAt: Date
    ) {
        self.code = code
        self.kind = kind
        self.storeProduct = storeProduct
        self.grants = grants
        self.title = title
        self.offerDescription = offerDescription
        self.updatedAt = updatedAt
    }
}
