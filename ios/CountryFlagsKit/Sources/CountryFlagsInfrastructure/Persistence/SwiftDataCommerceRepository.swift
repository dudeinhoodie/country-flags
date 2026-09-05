import Foundation
import SwiftData

import CountryFlagsDomain

/// The store's side of a purchase: no StoreKit, no network, no decision about
/// what anything is worth. It writes down what the store and the backend said
/// so that a relaunch can pick the story up where it stopped.
@ModelActor
actor SwiftDataCommerceRepository: CommerceRepository {

    // MARK: - Entitlements

    func entitlementSnapshot(for scope: AccountScope) async throws -> EntitlementSnapshotRecord? {
        try storedEntitlement(scopeKey: scope.key).map(Self.record)
    }

    /// Written as one row so the replacement is atomic without a delete and an
    /// insert that a crash could land between: a device must never hold half of
    /// one answer and half of another.
    func replaceEntitlementSnapshot(
        _ snapshot: EntitlementSnapshotRecord,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        try transaction {
            // Sorted so two identical answers store identically and a test can
            // compare rows rather than sets.
            let keys = snapshot.entitlementKeys.sorted()
            if let stored = try storedEntitlement(scopeKey: key) {
                stored.entitlementKeys = keys
                stored.checkedAt = snapshot.checkedAt
                stored.updatedAt = Date()
            } else {
                modelContext.insert(
                    StoredEntitlement(
                        scopeKey: key,
                        entitlementKeys: keys,
                        checkedAt: snapshot.checkedAt,
                        updatedAt: Date()
                    )
                )
            }
        }
    }

    // MARK: - Purchase delivery

    /// The same store transaction enqueued twice is one row: a listener, a
    /// purchase and a restore can all hand over the same receipt, and the
    /// backend is asked about it once.
    func enqueuePurchaseDelivery(
        _ delivery: PurchaseDeliveryRecord,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        try transaction {
            let transactionID = delivery.transactionID
            var descriptor = FetchDescriptor<StoredPurchaseDelivery>(
                predicate: #Predicate {
                    $0.scopeKey == key && $0.transactionID == transactionID
                }
            )
            descriptor.fetchLimit = 1
            if let existing = try modelContext.fetch(descriptor).first {
                // The payload can be re-signed between submissions; what it
                // has already cost in attempts is not thrown away.
                existing.signedTransaction = delivery.signedTransaction
                existing.productID = delivery.productID
                existing.updatedAt = delivery.updatedAt
                return
            }
            modelContext.insert(
                StoredPurchaseDelivery(
                    scopeKey: key,
                    id: delivery.id,
                    transactionID: delivery.transactionID,
                    signedTransaction: delivery.signedTransaction,
                    productID: delivery.productID,
                    state: delivery.state.rawValue,
                    attemptCount: delivery.attemptCount,
                    lastFailureCode: delivery.lastFailureCode,
                    createdAt: delivery.createdAt,
                    updatedAt: delivery.updatedAt
                )
            )
        }
    }

    func pendingPurchaseDeliveries(
        for scope: AccountScope
    ) async throws -> [PurchaseDeliveryRecord] {
        let key = scope.key
        let permanent = PurchaseDeliveryState.permanentFailure.rawValue
        let descriptor = FetchDescriptor<StoredPurchaseDelivery>(
            predicate: #Predicate { $0.scopeKey == key && $0.state != permanent },
            sortBy: [SortDescriptor(\.createdAt), SortDescriptor(\.id)]
        )
        return try modelContext.fetch(descriptor).compactMap(Self.record)
    }

    func updatePurchaseDeliveryState(
        of deliveryID: UUID,
        to state: PurchaseDeliveryState,
        failureCode: String?,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        try transaction {
            var descriptor = FetchDescriptor<StoredPurchaseDelivery>(
                predicate: #Predicate { $0.scopeKey == key && $0.id == deliveryID }
            )
            descriptor.fetchLimit = 1
            guard let stored = try modelContext.fetch(descriptor).first else {
                throw PersistenceError.notFound
            }
            stored.state = state.rawValue
            stored.lastFailureCode = failureCode
            stored.updatedAt = Date()
            if state == .inFlight {
                stored.attemptCount += 1
            }
        }
    }

    func requeueInterruptedPurchaseDeliveries(for scope: AccountScope) async throws -> Int {
        let key = scope.key
        let inFlight = PurchaseDeliveryState.inFlight.rawValue
        var requeued = 0
        try transaction {
            let stranded = try modelContext.fetch(
                FetchDescriptor<StoredPurchaseDelivery>(
                    predicate: #Predicate { $0.scopeKey == key && $0.state == inFlight }
                )
            )
            for delivery in stranded {
                delivery.state = PurchaseDeliveryState.pending.rawValue
                delivery.updatedAt = Date()
                requeued += 1
            }
        }
        return requeued
    }

    func removePurchaseDeliveries(ids: [UUID], for scope: AccountScope) async throws {
        guard !ids.isEmpty else { return }
        let key = scope.key
        let doomed = Set(ids)
        try transaction {
            let descriptor = FetchDescriptor<StoredPurchaseDelivery>(
                predicate: #Predicate { $0.scopeKey == key }
            )
            for stored in try modelContext.fetch(descriptor) where doomed.contains(stored.id) {
                modelContext.delete(stored)
            }
        }
    }

    // MARK: - Offers

    func offers() async throws -> [CommerceOfferRecord] {
        let descriptor = FetchDescriptor<StoredCommerceOffer>(
            sortBy: [SortDescriptor(\.sortOrder), SortDescriptor(\.code)]
        )
        return try modelContext.fetch(descriptor).map(Self.record)
    }

    /// The catalog is replaced rather than merged: an offer missing from the
    /// answer has been withdrawn, and a client that kept showing it would send
    /// the customer to a product the store no longer sells.
    func replaceOffers(_ offers: [CommerceOfferRecord]) async throws {
        try transaction {
            for stored in try modelContext.fetch(FetchDescriptor<StoredCommerceOffer>()) {
                modelContext.delete(stored)
            }
            for (index, offer) in offers.enumerated() {
                modelContext.insert(
                    StoredCommerceOffer(
                        code: offer.code,
                        kind: offer.kind,
                        storeProvider: offer.storeProduct?.provider,
                        storeProductID: offer.storeProduct?.productID,
                        grants: offer.grants,
                        title: offer.title,
                        offerDescription: offer.offerDescription,
                        sortOrder: index,
                        updatedAt: offer.updatedAt
                    )
                )
            }
        }
    }

    // MARK: - Reading

    private func storedEntitlement(scopeKey key: String) throws -> StoredEntitlement? {
        var descriptor = FetchDescriptor<StoredEntitlement>(
            predicate: #Predicate { $0.scopeKey == key }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }

    private static func record(_ stored: StoredEntitlement) -> EntitlementSnapshotRecord {
        EntitlementSnapshotRecord(
            entitlementKeys: Set(stored.entitlementKeys),
            checkedAt: stored.checkedAt
        )
    }

    /// - Returns: nil for a row whose state this build cannot read, which is a
    ///   row a later build wrote. Skipping it leaves the receipt on disk for
    ///   the build that understands it rather than delivering it under a state
    ///   this one guessed.
    private static func record(_ stored: StoredPurchaseDelivery) -> PurchaseDeliveryRecord? {
        guard let state = PurchaseDeliveryState(rawValue: stored.state) else { return nil }
        return PurchaseDeliveryRecord(
            id: stored.id,
            transactionID: stored.transactionID,
            signedTransaction: stored.signedTransaction,
            productID: stored.productID,
            state: state,
            attemptCount: stored.attemptCount,
            lastFailureCode: stored.lastFailureCode,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt
        )
    }

    private static func record(_ stored: StoredCommerceOffer) -> CommerceOfferRecord {
        CommerceOfferRecord(
            code: stored.code,
            kind: stored.kind,
            storeProduct: Self.storeProduct(
                provider: stored.storeProvider,
                productID: stored.storeProductID
            ),
            grants: stored.grants,
            title: stored.title,
            offerDescription: stored.offerDescription,
            updatedAt: stored.updatedAt
        )
    }

    /// A product needs both halves to be addressable. One without the other is
    /// no product at all, and pairing it with an empty string would send the
    /// store a lookup that cannot succeed.
    private static func storeProduct(
        provider: String?,
        productID: String?
    ) -> StoreProductRecord? {
        guard let provider, let productID else { return nil }
        return StoreProductRecord(provider: provider, productID: productID)
    }
}
