import Foundation

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// A store the test decides the behaviour of.
///
/// Everything the real client can do to the coordinator, stated instead of
/// provoked: an outcome per call, a stream the test pushes into, a restore
/// that throws, and a record of every transaction the coordinator finished so
/// the ordering rule — durable first, `finish()` after — can be asserted.
actor ScriptedStore: Purchasing, StoreProductLoading {
    private var outcomes: [PurchaseOutcome]
    private var owned: [VerifiedStoreTransaction]
    private var restoreFailure: (any Error)?
    private var catalogue: [StoreProductSnapshot]
    private var continuation: AsyncStream<StoreTransactionUpdate>.Continuation?

    private(set) var purchaseCalls: [(productID: String, token: UUID?)] = []
    private(set) var finished: [String] = []
    private(set) var restoreCount = 0

    init(
        outcomes: [PurchaseOutcome] = [],
        owned: [VerifiedStoreTransaction] = [],
        restoreFailure: (any Error)? = nil,
        catalogue: [StoreProductSnapshot] = []
    ) {
        self.outcomes = outcomes
        self.owned = owned
        self.restoreFailure = restoreFailure
        self.catalogue = catalogue
    }

    // MARK: - Steering

    /// What the store will say this Apple ID owns from now on — which is how a
    /// restore that finds something differs from one that does not.
    func setOwned(_ transactions: [VerifiedStoreTransaction]) {
        owned = transactions
    }

    func setRestoreFailure(_ error: (any Error)?) {
        restoreFailure = error
    }

    /// Hands something to the listener, the way the store does when a purchase
    /// completes elsewhere.
    func emit(_ update: StoreTransactionUpdate) {
        continuation?.yield(update)
    }

    // MARK: - Purchasing

    func purchase(productID: String, appAccountToken: UUID?) async -> PurchaseOutcome {
        purchaseCalls.append((productID, appAccountToken))
        guard !outcomes.isEmpty else { return .cancelled }
        return outcomes.removeFirst()
    }

    func currentEntitlements() async -> [VerifiedStoreTransaction] { owned }

    func restore() async throws {
        restoreCount += 1
        if let restoreFailure { throw restoreFailure }
    }

    func finish(transactionID: String) async {
        finished.append(transactionID)
    }

    func transactionUpdates() async -> AsyncStream<StoreTransactionUpdate> {
        AsyncStream { continuation in
            self.continuation = continuation
        }
    }

    // MARK: - Products

    func products(for identifiers: Set<String>) async throws -> [StoreProductSnapshot] {
        catalogue.filter { identifiers.contains($0.productID) }
    }
}

/// A backend the test decides the answers of, and which remembers what it was
/// asked — the idempotency key above all, because "the same purchase lands
/// once" is a claim about that header.
actor ScriptedCommerceBackend: CommerceBackend {
    enum Answer: Sendable {
        case snapshot(EntitlementSnapshotRecord)
        case failure(APIError)
    }

    struct Submission: Sendable {
        let payloads: [String]
        let idempotencyKey: String
    }

    private var offerCatalogue: [CommerceOfferRecord]
    private var submitAnswers: [Answer]
    private var entitlementAnswers: [Answer]
    /// Answered when the queue above runs dry, so a test states the exception
    /// rather than every call.
    private var standingAnswer: Answer

    private(set) var submissions: [Submission] = []
    private(set) var entitlementRequests: [String?] = []
    private(set) var offerRequests: [StorePlatform] = []

    init(
        offers: [CommerceOfferRecord] = [],
        submitAnswers: [Answer] = [],
        entitlementAnswers: [Answer] = [],
        standing: Answer = .snapshot(.empty(checkedAt: Date(timeIntervalSince1970: 1_760_000_000)))
    ) {
        offerCatalogue = offers
        self.submitAnswers = submitAnswers
        self.entitlementAnswers = entitlementAnswers
        standingAnswer = standing
    }

    func offers(platform: StorePlatform) async throws -> [CommerceOfferRecord] {
        offerRequests.append(platform)
        return offerCatalogue
    }

    func entitlements(entityTag: String?) async throws -> EntitlementFetch {
        entitlementRequests.append(entityTag)
        switch next(&entitlementAnswers) {
        case .snapshot(let snapshot):
            return .snapshot(snapshot, entityTag: "\"snapshot-\(entitlementRequests.count)\"")
        case .failure(let error):
            throw error
        }
    }

    func submitAppleTransactions(
        _ signedTransactions: [String],
        idempotencyKey: String
    ) async throws -> EntitlementSnapshotRecord {
        submissions.append(
            Submission(payloads: signedTransactions, idempotencyKey: idempotencyKey)
        )
        switch next(&submitAnswers) {
        case .snapshot(let snapshot): return snapshot
        case .failure(let error): throw error
        }
    }

    private func next(_ queue: inout [Answer]) -> Answer {
        queue.isEmpty ? standingAnswer : queue.removeFirst()
    }
}

/// Everything the logger was given, joined: the haystack a leak test looks
/// for a needle in, redacted exactly as a device would have written it.
extension RecordingLogger {
    var transcript: String { renderedLines.joined(separator: "\n") }

    var lines: [String] { renderedLines }
}

struct FixedCommerceScopes: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}

struct FixedStoreAccountToken: StoreAccountTokenProviding {
    let token: UUID?

    func storeAccountToken() async -> UUID? { token }
}

/// Deterministic values for the commerce tests, so a failure points at the
/// behaviour rather than at the data.
enum CommerceFixtures {
    static let instant = Date(timeIntervalSince1970: 1_760_000_000)
    static let userScope = PersistenceFixtures.firstUserScope
    static let guestScope = PersistenceFixtures.guestScope

    static let coatsProductID = "app.countryflags.deck.european_coats.lifetime.v1"
    static let statesProductID = "app.countryflags.deck.us_states.lifetime.v1"
    static let coatsKey = "entitlement.european_coats"
    static let statesKey = "entitlement.us_states"

    /// A payload shaped like the real thing: three dot-separated segments, the
    /// first two base64url JSON, which is the shape the log redactor
    /// recognises and the shape this suite proves never reaches a log.
    ///
    /// Assembled at runtime rather than written out. A literal `eyJ…` in a
    /// source file is exactly what a secret scanner exists to find, and a test
    /// fixture is not worth teaching anybody to allowlist one.
    static func jws(_ salt: String) -> String {
        let header = base64URL(#"{"alg":"ES256","x5c":["fixture"]}"#)
        let body = base64URL(#"{"transactionId":"\#(salt)","bundleId":"app.countryflags"}"#)
        return "\(header).\(body).\(base64URL("signature-\(salt)"))"
    }

    private static func base64URL(_ text: String) -> String {
        Data(text.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func transaction(
        id: String = "2000000000000001",
        productID: String = coatsProductID,
        revoked: Bool = false
    ) -> VerifiedStoreTransaction {
        VerifiedStoreTransaction(
            transactionID: id,
            originalTransactionID: id,
            productID: productID,
            purchasedAt: instant,
            isRevoked: revoked,
            signedTransaction: jws(id)
        )
    }

    static func offer(
        code: String = "EUROPEAN_COATS_LIFETIME",
        productID: String = coatsProductID,
        grants: [String] = [coatsKey]
    ) -> CommerceOfferRecord {
        CommerceOfferRecord(
            code: code,
            kind: "ONE_TIME",
            storeProduct: StoreProductRecord(provider: "APPLE_APP_STORE", productID: productID),
            grants: grants,
            title: nil,
            offerDescription: nil,
            updatedAt: instant
        )
    }

    static func snapshot(_ keys: Set<String>) -> EntitlementSnapshotRecord {
        EntitlementSnapshotRecord(entitlementKeys: keys, checkedAt: instant)
    }

    static let offline = APIError.transport(String(URLError.notConnectedToInternet.rawValue))
    static let conflict = APIError.conflict(
        APIErrorDetails(
            statusCode: 409,
            code: "TRANSACTION_ALREADY_CLAIMED",
            message: "Held by another account",
            requestID: "req-409"
        )
    )
}
