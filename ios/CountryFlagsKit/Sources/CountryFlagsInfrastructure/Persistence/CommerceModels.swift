import Foundation
import SwiftData

/// The models version 6 adds: what an account may open, what it has bought and
/// what is for sale.
///
/// They live in a file of their own rather than beside the content models
/// because they are the first records the store keeps that are neither content
/// nor learning — and because the queue below is the one part of the store
/// that holds something the customer has already paid for.

/// What the server last said one account may open.
///
/// One row per scope holding the whole answer, rather than a row per right:
/// the backend replaces the snapshot whole — a refund arrives the same way a
/// purchase does — and `checkedAt` describes the answer rather than any single
/// key in it. Replacing one row is atomic without a transaction spanning
/// deletes and inserts, which is what "the snapshot is replaced atomically"
/// has to mean on a device that can be killed mid-write.
@Model
final class StoredEntitlement {
    var scopeKey: String = ""
    var entitlementKeys: [String] = []
    /// The server's clock, not the device's: it is when the answer was
    /// established, and a device with a wrong clock must not age it out.
    var checkedAt: Date = Date.distantPast
    var updatedAt: Date = Date.distantPast

    init(
        scopeKey: String,
        entitlementKeys: [String],
        checkedAt: Date,
        updatedAt: Date
    ) {
        self.scopeKey = scopeKey
        self.entitlementKeys = entitlementKeys
        self.checkedAt = checkedAt
        self.updatedAt = updatedAt
    }
}

/// A verified store transaction the backend has not seen yet.
///
/// The durable half of a purchase. The store hands a transaction over once and
/// the app finishes it only after this row is on disk, so the queue is what
/// stands between a crash and a purchase nobody can prove. It is account
/// scoped like the outbox it resembles: two people signing in on one device
/// must not deliver each other's receipts.
@Model
final class StoredPurchaseDelivery {
    var scopeKey: String = ""
    var id: UUID = UUID()
    /// The store's identifier for the transaction. It is what makes a second
    /// submission of the same purchase the same row rather than a new one.
    var transactionID: String = ""
    /// The store's signed payload, verbatim. Nothing is read out of it here:
    /// the backend verifies the signature and decides what the purchase is
    /// worth, and a client that parsed it would be inventing an entitlement.
    var signedTransaction: String = ""
    /// Kept only so a diagnostic can say which purchase is stuck. It grants
    /// nothing.
    var productID: String?
    var state: String = ""
    var attemptCount: Int = 0
    var lastFailureCode: String?
    var createdAt: Date = Date.distantPast
    var updatedAt: Date = Date.distantPast

    init(
        scopeKey: String,
        id: UUID,
        transactionID: String,
        signedTransaction: String,
        productID: String?,
        state: String,
        attemptCount: Int,
        lastFailureCode: String?,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.scopeKey = scopeKey
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

/// Something for sale, as this product describes it.
///
/// Shared by every account on the device, like content: an offer is a catalog
/// entry, not a possession. The copy stored here is a fallback for a client the
/// store has not answered yet — what the customer is shown at the moment of
/// paying comes from the store, which is also what review approved. No price
/// is stored for the same reason.
@Model
final class StoredCommerceOffer {
    var code: String = ""
    var kind: String = ""
    var storeProvider: String?
    var storeProductID: String?
    /// The rights a purchase of this offer grants. A bundle grants more than
    /// one, which is why an offer must not be read as a deck.
    var grants: [String] = []
    var title: String?
    var offerDescription: String?
    var sortOrder: Int = 0
    var updatedAt: Date = Date.distantPast

    init(
        code: String,
        kind: String,
        storeProvider: String?,
        storeProductID: String?,
        grants: [String],
        title: String?,
        offerDescription: String?,
        sortOrder: Int,
        updatedAt: Date
    ) {
        self.code = code
        self.kind = kind
        self.storeProvider = storeProvider
        self.storeProductID = storeProductID
        self.grants = grants
        self.title = title
        self.offerDescription = offerDescription
        self.sortOrder = sortOrder
        self.updatedAt = updatedAt
    }
}
