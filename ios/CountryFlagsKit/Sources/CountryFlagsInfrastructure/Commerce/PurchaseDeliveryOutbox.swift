import CryptoKit
import Foundation

import CountryFlagsDomain

/// How a delivery run ended.
public enum PurchaseDeliveryOutcome: Hashable, Sendable {
    /// The queue was empty. Not a failure and not a success: nothing was owed.
    case nothingOwed
    /// The backend acknowledged the batch and answered with the whole
    /// snapshot, which is what replaces the local one.
    case delivered(EntitlementSnapshotRecord, count: Int)
    /// Still owed. The rows stay on disk and the next trigger tries again.
    case deferred(PurchaseFailure)
}

/// The durable half of a purchase.
///
/// A verified transaction is money that has already moved. It is written here
/// *before* the store is told the app is done with it, so the two failure
/// modes that matter are covered: killed before the write, and the store hands
/// the transaction over again; killed after the write, and this queue still
/// has it. What is never possible is a purchase that is finished with the
/// store and recorded nowhere.
///
/// Delivery repeats until the backend acknowledges it. A row leaves only on an
/// acknowledgement — a refusal the server will never change its mind about
/// parks the row instead, because a purchase somebody paid for is not
/// something to delete quietly.
public actor PurchaseDeliveryOutbox {
    private let repository: any CommerceRepository
    private let backend: any CommerceBackend
    private let dates: any DateProviding
    private let identifiers: any IdentifierProviding
    private let logger: any AppLogging
    private let batchLimit: Int

    /// One run per scope. A launch, a purchase and a foreground routinely land
    /// together, and two runs would claim the same rows and send the same
    /// receipt twice under two different idempotency keys.
    private var running: [String: Task<PurchaseDeliveryOutcome, Never>] = [:]

    /// The contract's ceiling is a hundred transactions per submission.
    public init(
        repository: any CommerceRepository,
        backend: any CommerceBackend,
        dates: any DateProviding = SystemDateProvider(),
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        logger: any AppLogging = NoOpLogger(),
        batchLimit: Int = 100
    ) {
        self.repository = repository
        self.backend = backend
        self.dates = dates
        self.identifiers = identifiers
        self.logger = logger
        self.batchLimit = batchLimit
    }

    // MARK: - Writing it down

    /// Writes the transaction to disk and returns only once it is there.
    ///
    /// The caller finishes the transaction with the store after this returns
    /// and never before. A second call for the same store transaction is the
    /// same row: a purchase, the listener and a restore all hand over the same
    /// receipt by design.
    public func record(
        _ transaction: VerifiedStoreTransaction,
        for scope: AccountScope
    ) async throws {
        let now = dates.now()
        try await repository.enqueuePurchaseDelivery(
            PurchaseDeliveryRecord(
                id: identifiers.next(),
                transactionID: transaction.transactionID,
                signedTransaction: transaction.signedTransaction,
                productID: transaction.productID,
                state: .pending,
                attemptCount: 0,
                lastFailureCode: nil,
                createdAt: now,
                updatedAt: now
            ),
            for: scope
        )
        logger.log(
            .notice,
            .commerce,
            "A verified transaction is on disk and owed to the backend",
            ["productId": .safe(transaction.productID)]
        )
    }

    /// A crash leaves rows claimed but not sent. They belong back in the queue
    /// on the next launch rather than staying invisible forever.
    public func recoverInterrupted(for scope: AccountScope) async {
        let requeued = (try? await repository.requeueInterruptedPurchaseDeliveries(for: scope)) ?? 0
        guard requeued > 0 else { return }
        logger.log(
            .notice,
            .commerce,
            "Requeued purchases claimed by a run that did not finish",
            ["count": .count(requeued)]
        )
    }

    public func owedCount(for scope: AccountScope) async -> Int {
        ((try? await repository.pendingPurchaseDeliveries(for: scope)) ?? []).count
    }

    // MARK: - Delivering it

    /// Sends everything owed, once per scope at a time.
    @discardableResult
    public func deliver(for scope: AccountScope) async -> PurchaseDeliveryOutcome {
        if let running = running[scope.key] {
            return await running.value
        }
        let task = Task<PurchaseDeliveryOutcome, Never> { [self] in
            let outcome = await run(for: scope)
            // Deregistered inside the same actor job that finished the run:
            // cleared any later and a caller arriving in between would join a
            // run that is already over.
            running[scope.key] = nil
            return outcome
        }
        running[scope.key] = task
        return await task.value
    }

    private func run(for scope: AccountScope) async -> PurchaseDeliveryOutcome {
        // A guest has no account for the backend to grant anything to. The
        // rows wait rather than being sent under an identity that owns
        // nothing — and the store, not having been told the app is finished
        // with the transaction, keeps offering it too.
        guard !scope.isGuest else { return .nothingOwed }

        let owed: [PurchaseDeliveryRecord]
        do {
            owed = try await repository.pendingPurchaseDeliveries(for: scope)
        } catch {
            return .deferred(PurchaseFailure(reason: .backendUnreachable, isRetryable: true))
        }
        let batch = Array(owed.filter { $0.state != .permanentFailure }.prefix(batchLimit))
        guard !batch.isEmpty else { return .nothingOwed }

        for delivery in batch {
            try? await repository.updatePurchaseDeliveryState(
                of: delivery.id,
                to: .inFlight,
                failureCode: nil,
                for: scope
            )
        }

        do {
            let snapshot = try await backend.submitAppleTransactions(
                batch.map(\.signedTransaction),
                idempotencyKey: Self.idempotencyKey(for: batch)
            )
            try await repository.replaceEntitlementSnapshot(snapshot, for: scope)
            try await repository.removePurchaseDeliveries(ids: batch.map(\.id), for: scope)
            logger.log(
                .notice,
                .commerce,
                "The backend acknowledged purchases the device was holding",
                ["count": .count(batch.count)]
            )
            return .delivered(snapshot, count: batch.count)
        } catch {
            let apiError = APIError.from(error)
            return .deferred(await park(batch, after: apiError, for: scope))
        }
    }

    /// Puts a batch the backend refused back where it can be retried, or parks
    /// it where retrying is pointless.
    private func park(
        _ batch: [PurchaseDeliveryRecord],
        after error: APIError,
        for scope: AccountScope
    ) async -> PurchaseFailure {
        let code = error.details?.code ?? "TRANSPORT"
        let curable = Self.isCurable(error)
        for delivery in batch {
            try? await repository.updatePurchaseDeliveryState(
                of: delivery.id,
                to: curable ? .pending : .permanentFailure,
                failureCode: code,
                for: scope
            )
        }
        logger.log(
            curable ? .notice : .error,
            .commerce,
            curable
                ? "The backend has not acknowledged a purchase yet; it stays queued"
                : "The backend refused a purchase in a way retrying cannot cure",
            [
                "count": .count(batch.count),
                "code": .safe(code),
                // The support identifier, not a transaction identifier: this
                // is a line somebody reads out loud.
                "requestId": .safe(error.supportRequestID ?? "none"),
            ]
        )
        return PurchaseFailure(
            reason: curable ? .backendUnreachable : .store,
            supportID: error.supportRequestID,
            isRetryable: curable
        )
    }

    /// Whether asking again can change the answer.
    ///
    /// Everything transient is curable, and so is anything about the session:
    /// a token that has expired is refreshed and the next run succeeds. What is
    /// not curable is the server having read the payload and refused what is
    /// in it — a transaction another live account holds, or a body it will
    /// never accept.
    private static func isCurable(_ error: APIError) -> Bool {
        switch error {
        case .transport, .decoding, .cancelled, .server, .rateLimited, .unauthorized:
            return true
        case .conflict, .validationFailed:
            return false
        case .forbidden(let details), .notFound(let details), .client(let details):
            // A feature switched off is a state of the deployment, not of the
            // purchase, and it stops being true without anything changing here.
            return details.code == "FEATURE_DISABLED"
        }
    }

    /// The same set of transactions always produces the same key, and a
    /// different set never does.
    ///
    /// That is exactly what the contract asks of `Idempotency-Key`: the same
    /// key with the same payload returns the stored result, and the same key
    /// with a different payload is a conflict. Deriving the key from the
    /// payload makes the second case unreachable.
    ///
    /// It is a digest rather than the identifiers themselves because a header
    /// travels through proxies and access logs this app does not own, and a
    /// store transaction identifier is not something to leave in one.
    static func idempotencyKey(for batch: [PurchaseDeliveryRecord]) -> String {
        let canonical = batch.map(\.transactionID).sorted().joined(separator: "\n")
        return SHA256.hash(data: Data(canonical.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
