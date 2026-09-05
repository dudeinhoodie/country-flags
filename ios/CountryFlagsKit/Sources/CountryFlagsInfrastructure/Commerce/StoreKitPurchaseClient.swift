import Foundation
import StoreKit

import CountryFlagsDomain

/// The only file in the app that knows what StoreKit is.
///
/// It translates and nothing more: a `Product` becomes a snapshot, a
/// `VerificationResult` becomes a verified transaction or a refusal, and an
/// error becomes one of a handful of cases the rest of the app can act on.
/// No decision about what anything is worth is taken here, nothing is stored,
/// and nothing is unlocked — those belong to the coordinator, the outbox and
/// the backend respectively, which is what makes all three testable without a
/// payment sheet.
///
/// A transaction is deliberately *not* finished here. `finish(transactionID:)`
/// is a separate call the coordinator makes after the durable record exists,
/// because the store hands a transaction over exactly once after it is
/// finished, and a crash in between would be a purchase nobody can prove.
public struct StoreKitPurchaseClient: StoreProductLoading, Purchasing {
    private let logger: any AppLogging

    public init(logger: any AppLogging = NoOpLogger()) {
        self.logger = logger
    }

    // MARK: - Products

    public func products(for identifiers: Set<String>) async throws -> [StoreProductSnapshot] {
        guard !identifiers.isEmpty else { return [] }
        let products = try await Product.products(for: identifiers)
        return products.map {
            StoreProductSnapshot(
                productID: $0.id,
                displayName: $0.displayName,
                productDescription: $0.description,
                // The store's own formatting, in the storefront's currency.
                // Building this from `price` and a locale is how an app ends
                // up showing a number review never approved.
                displayPrice: $0.displayPrice
            )
        }
    }

    // MARK: - Buying

    public func purchase(productID: String, appAccountToken: UUID?) async -> PurchaseOutcome {
        let product: Product?
        do {
            product = try await Product.products(for: [productID]).first
        } catch {
            return .failed(Self.failure(from: error))
        }
        guard let product else {
            // The store knows no such product: a withdrawn offer, a storefront
            // that does not sell it, or a product still in review.
            return .failed(.productUnavailable)
        }

        var options: Set<Product.PurchaseOption> = []
        if let appAccountToken {
            options.insert(.appAccountToken(appAccountToken))
        }

        do {
            switch try await product.purchase(options: options) {
            case .success(let verification):
                switch verification {
                case .verified(let transaction):
                    return .success(Self.verified(transaction, signedAs: verification))
                case .unverified(_, let error):
                    // The payload is dropped rather than delivered. An
                    // unverified transaction is not evidence of anything, and
                    // sending it on would ask the backend to decide something
                    // this device already knows the answer to.
                    return .unverified(code: Self.code(for: error))
                }
            case .pending:
                return .pending
            case .userCancelled:
                return .cancelled
            @unknown default:
                // A result this build does not know is not a success. StoreKit
                // adds cases without a version gate, and guessing here would
                // eventually unlock a deck on a case that means the opposite.
                return .failed(.storeUnavailable(code: "UNKNOWN_RESULT"))
            }
        } catch {
            return .failed(Self.failure(from: error))
        }
    }

    /// What the store already considers this Apple ID to own.
    ///
    /// Read at launch instead of `AppStore.sync()`, which is the whole of
    /// §9.4: this asks nobody for a password and shows no system sheet, and it
    /// is enough for a reinstall to find its purchases again.
    public func currentEntitlements() async -> [VerifiedStoreTransaction] {
        var found: [VerifiedStoreTransaction] = []
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else {
                logger.log(
                    .error,
                    .commerce,
                    "The store offered an entitlement this device could not verify"
                )
                continue
            }
            found.append(Self.verified(transaction, signedAs: result))
        }
        return found
    }

    /// Only ever called from a button the person pressed: it MAY ask them to
    /// authenticate, and an app that does that at launch has taught them to
    /// type their password at a prompt they did not ask for.
    public func restore() async throws {
        try await AppStore.sync()
    }

    public func finish(transactionID: String) async {
        for await result in Transaction.unfinished {
            guard case .verified(let transaction) = result,
                String(transaction.id) == transactionID
            else {
                continue
            }
            await transaction.finish()
            return
        }
    }

    /// Started once, at launch, and consumed by exactly one listener.
    ///
    /// The sequence is where a purchase completed on another device, a payment
    /// a parent approved later and a refund all arrive, so the app is only ever
    /// correct about what it owns while something is reading it.
    public func transactionUpdates() async -> AsyncStream<StoreTransactionUpdate> {
        AsyncStream { continuation in
            let task = Task {
                for await result in Transaction.updates {
                    switch result {
                    case .verified(let transaction):
                        continuation.yield(
                            .verified(Self.verified(transaction, signedAs: result))
                        )
                    case .unverified(_, let error):
                        continuation.yield(.unverified(code: Self.code(for: error)))
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Translation

    /// - Parameter signedAs: the verification result the transaction came in,
    ///   which is what carries the signed payload. `Transaction` alone has a
    ///   `jwsRepresentation` too, and both are the same bytes; taking it from
    ///   the result keeps the payload and the verification that vouched for it
    ///   in one place.
    private static func verified(
        _ transaction: Transaction,
        signedAs result: VerificationResult<Transaction>
    ) -> VerifiedStoreTransaction {
        VerifiedStoreTransaction(
            transactionID: String(transaction.id),
            originalTransactionID: String(transaction.originalID),
            productID: transaction.productID,
            purchasedAt: transaction.purchaseDate,
            isRevoked: transaction.revocationDate != nil,
            signedTransaction: result.jwsRepresentation
        )
    }

    /// A stable code, never the error's description: a StoreKit error string
    /// is written for a developer and can name a receipt or an account.
    private static func code(for error: VerificationResult<Transaction>.VerificationError) -> String
    {
        switch error {
        case .revokedCertificate: "REVOKED_CERTIFICATE"
        case .invalidCertificateChain: "INVALID_CERTIFICATE_CHAIN"
        case .invalidDeviceVerification: "INVALID_DEVICE_VERIFICATION"
        case .invalidEncoding: "INVALID_ENCODING"
        case .invalidSignature: "INVALID_SIGNATURE"
        case .missingRequiredProperties: "MISSING_REQUIRED_PROPERTIES"
        @unknown default: "UNVERIFIED"
        }
    }

    private static func failure(from error: any Error) -> StorePurchaseFailure {
        if error is CancellationError {
            return .storeUnavailable(code: "CANCELLED")
        }
        if let storeKitError = error as? StoreKitError {
            switch storeKitError {
            case .networkError: return .network
            case .userCancelled: return .storeUnavailable(code: "CANCELLED")
            case .notAvailableInStorefront: return .productUnavailable
            case .notEntitled: return .notAllowed
            case .systemError: return .storeUnavailable(code: "SYSTEM")
            case .unsupported: return .storeUnavailable(code: "UNSUPPORTED")
            case .unknown: return .storeUnavailable(code: "UNKNOWN")
            @unknown default: return .storeUnavailable(code: "UNKNOWN")
            }
        }
        if let purchaseError = error as? Product.PurchaseError {
            switch purchaseError {
            case .purchaseNotAllowed: return .notAllowed
            case .productUnavailable: return .productUnavailable
            case .ineligibleForOffer,
                .invalidOfferIdentifier,
                .invalidOfferPrice,
                .invalidOfferSignature,
                .invalidQuantity,
                .missingOfferParameters:
                // None of these are reachable without a promotional offer,
                // which this product does not sell. They are named rather than
                // defaulted so adding one later is a compile error here.
                return .storeUnavailable(code: "OFFER")
            @unknown default: return .storeUnavailable(code: "UNKNOWN")
            }
        }
        if let urlError = error as? URLError {
            return urlError.code == .cancelled
                ? .storeUnavailable(code: "CANCELLED")
                : .network
        }
        return .storeUnavailable(code: "UNKNOWN")
    }
}
