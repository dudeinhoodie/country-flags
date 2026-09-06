import Foundation
import Observation

import CountryFlagsDomain

/// The app's single entry point into money, as the screens see it.
///
/// It owns no purchase machinery: the single-flight rule, the transaction
/// listener and the order a purchase is settled in all live in the coordinator
/// behind `PurchaseCoordinating`. What lives here is the part a screen needs
/// and an actor cannot give it — observable state on the main actor, the price
/// of a deck rather than of a product, and the two rules that are about
/// presentation rather than about money:
///
/// - a price is shown only once the store has answered, never as a
///   placeholder;
/// - a feature flag decides whether buying is offered, and never whether a
///   deck is open. An owner keeps a deck with the storefront switched off.
///
/// Nothing here decides access either. `DeckRecord.isOpen(given:)` is the one
/// rule, and the backend refusing the cards is what enforces it.
@MainActor
@Observable
public final class CommerceCenter {
    /// What the account may open: the server's answer plus a purchase this
    /// device verified and the server has not acknowledged yet.
    public private(set) var entitlementKeys: Set<String> = []
    /// The server's own answer, with nothing local added.
    ///
    /// Held apart from the above for one screen state: a purchase that is
    /// real on this device and unknown to the backend. The difference between
    /// the two sets is exactly that purchase, which is what lets the deck open
    /// now and still say, quietly, that it is being synced.
    public private(set) var confirmedKeys: Set<String> = []
    /// Where each deck's purchase stands, keyed by deck.
    public private(set) var purchases: [UUID: DeckPurchasePhase] = [:]
    public private(set) var isRestoring = false
    /// What the last restore found, for the neutral result a restore that
    /// matched nothing has to give.
    public private(set) var lastRestore: RestoreResult?
    /// Whether this device is acting as a guest. A purchase needs an account
    /// to be granted to, so the action says "sign in" rather than failing.
    public private(set) var isGuest = true
    /// Whether the store has been asked about the products on screen and
    /// answered. Until it has, a price is "loading" rather than absent.
    private var pendingProductRequests: Set<String> = []
    private var answeredProducts: [String: StoreProductSnapshot] = [:]
    /// Identifiers the store was asked about and did not return. It is not an
    /// error: a product withdrawn, still in review, or not sold in this
    /// storefront is simply absent from the answer.
    private var unknownProducts: Set<String> = []
    private var offersByProduct: [String: CommerceOfferRecord] = [:]
    private var productIDsByOfferCode: [String: String] = [:]
    private var hasLoadedOffers = false

    private let coordinator: any PurchaseCoordinating
    /// `commerce.apple_iap.enabled`, read at the moment it matters rather than
    /// captured: it is an `immediate` flag, and a refresh that switched the
    /// storefront off has to reach a screen that is already open.
    private let isPurchasingOffered: @MainActor () -> Bool
    /// The server's snapshot, read directly so a local grant can be told from
    /// an acknowledged one.
    private let confirmed: (any EntitlementRepository)?
    private let scopes: (any AccountScopeResolving)?
    /// Told whenever the keys move, so the catalogue regroups and a deck that
    /// has just been paid for downloads its cards.
    private let onEntitlementsChanged: @MainActor (Set<String>) async -> Void
    private var hasStarted = false
    private var listener: Task<Void, Never>?

    public init(
        coordinator: any PurchaseCoordinating,
        isPurchasingOffered: @escaping @MainActor () -> Bool = { true },
        confirmed: (any EntitlementRepository)? = nil,
        scopes: (any AccountScopeResolving)? = nil,
        onEntitlementsChanged: @escaping @MainActor (Set<String>) async -> Void = { _ in }
    ) {
        self.coordinator = coordinator
        self.isPurchasingOffered = isPurchasingOffered
        self.confirmed = confirmed
        self.scopes = scopes
        self.onEntitlementsChanged = onEntitlementsChanged
    }

    /// Stops listening. The app never calls it — there is no moment before
    /// termination at which not hearing about a purchase is an improvement —
    /// but a test uses it to end the task it started.
    public func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Launch

    /// Starts the transaction listener and settles what the last launch left
    /// behind.
    ///
    /// Called once, from the shell, before anything commerce is on screen —
    /// the listener is the only thing that catches a purchase approved
    /// overnight, and it has to be running whether or not anybody is buying.
    ///
    /// Idempotent: both of the launch's first screens ask.
    public func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        observeEntitlements()
        await coordinator.start()
        await readState()
    }

    /// Asks the server what the account holds.
    ///
    /// Named triggers rather than a bare call: a refresh that fires far more
    /// often than the moments the spec lists is a bug, and the log says which
    /// moment it was.
    public func refresh(trigger: EntitlementRefreshTrigger) async {
        guard hasStarted else { return }
        await coordinator.refreshEntitlements(trigger: trigger)
        await readState()
    }

    private func observeEntitlements() {
        guard listener == nil else { return }
        listener = Task { [weak self] in
            guard let stream = await self?.coordinator.entitlementChanges() else { return }
            for await keys in stream {
                guard let self else { return }
                await self.adopt(keys)
            }
        }
    }

    // MARK: - What the screens read

    /// Whether this account may open the deck. The one rule, asked in one
    /// place.
    public func isOpen(_ deck: DeckRecord) -> Bool {
        deck.isOpen(given: entitlementKeys)
    }

    /// Whether the deck is open on the strength of a purchase the backend has
    /// not confirmed yet.
    ///
    /// It is not a failure and it is not a wait: the money moved, the device
    /// wrote the transaction down, and the outbox is retrying. The screen says
    /// so quietly and offers nothing to press.
    public func isAwaitingSync(_ deck: DeckRecord) -> Bool {
        guard let key = deck.requiredEntitlementKey else { return false }
        return entitlementKeys.contains(key) && !confirmedKeys.contains(key)
    }

    /// What the deck costs, or why it cannot say.
    ///
    /// The three states are the whole of §11.1. There is no fourth, because
    /// the fourth would be a price this app made up.
    public func price(of deck: DeckRecord) -> StorePriceState {
        // A storefront switched off is a product that cannot be bought today,
        // which is the same thing as one the store does not sell. The deck
        // stays visible and an owner keeps it; only the offer goes.
        guard isPurchasingOffered() else { return .unavailable }
        guard let productID = productID(for: deck) else {
            // Nothing to ask about yet, or nothing to ask about at all.
            return hasLoadedOffers ? .unavailable : .loading
        }
        if let product = answeredProducts[productID] {
            return .priced(product.displayPrice)
        }
        return unknownProducts.contains(productID) ? .unavailable : .loading
    }

    public func phase(of deck: DeckRecord) -> DeckPurchasePhase {
        purchases[deck.id] ?? .idle
    }

    /// Whether buying is offered at all. False hides the action rather than
    /// disabling it, and the screen says purchases are unavailable.
    public var isPurchaseAvailable: Bool { isPurchasingOffered() }

    /// The store product a deck is sold as.
    ///
    /// Through the offer catalogue the backend published, in the order it
    /// published: a client never derives a product identifier from a deck code,
    /// because an offer may be a bundle and a bundle is not a deck.
    public func productID(for deck: DeckRecord) -> String? {
        for code in deck.offerCodes {
            if let productID = productIDsByOfferCode[code] { return productID }
        }
        return nil
    }

    // MARK: - Lazily, for what is on screen

    /// Makes sure the store has been asked about the decks now visible.
    ///
    /// Lazy and batched: the catalogue must scroll before every product has
    /// answered, and asking about one product per row would be one round trip
    /// per row.
    public func prepare(for decks: [DeckRecord]) async {
        let sold = decks.filter(\.isSold)
        guard !sold.isEmpty else { return }
        if !hasLoadedOffers {
            let offers = await coordinator.offers()
            for offer in offers {
                guard let product = offer.storeProduct else { continue }
                productIDsByOfferCode[offer.code] = product.productID
                offersByProduct[product.productID] = offer
            }
            hasLoadedOffers = true
        }
        let wanted = Set(sold.compactMap(productID(for:)))
            .subtracting(answeredProducts.keys)
            .subtracting(unknownProducts)
            .subtracting(pendingProductRequests)
        guard !wanted.isEmpty else { return }
        pendingProductRequests.formUnion(wanted)
        let answered = await coordinator.products(for: wanted)
        for product in answered {
            answeredProducts[product.productID] = product
        }
        // Everything asked about and not answered for. Recorded rather than
        // left pending, so the row stops saying "loading" forever.
        unknownProducts.formUnion(wanted.subtracting(answered.map(\.productID)))
        pendingProductRequests.subtract(wanted)
    }

    // MARK: - Buying

    /// - Returns: whether the deck is open afterwards, so the caller can move
    ///   the screen without waiting for the next refresh.
    @discardableResult
    public func purchase(_ deck: DeckRecord) async -> Bool {
        guard let productID = productID(for: deck) else {
            purchases[deck.id] = .failed(
                PurchaseFailure(reason: .productUnavailable, isRetryable: false)
            )
            return false
        }
        // A second tap while the first purchase is in flight is the same
        // purchase. The coordinator would join them anyway; refusing here is
        // what keeps the button from flickering through three states.
        switch phase(of: deck) {
        case .purchasing, .delivering, .awaitingApproval:
            return isOpen(deck)
        case .idle, .failed:
            break
        }

        purchases[deck.id] = .purchasing
        let result = await coordinator.purchase(productID: productID)
        switch result {
        case .purchased(let keys):
            // Verified and written down. The deck opens now; the cards are
            // what the screen waits for, and the backend is told in the
            // background.
            purchases[deck.id] = .delivering
            await adopt(keys)
            purchases[deck.id] = .idle
            return isOpen(deck)
        case .awaitingApproval:
            purchases[deck.id] = .awaitingApproval
            return false
        case .cancelled:
            // Not an error. Not an alert. The screen it came from is unchanged.
            purchases[deck.id] = .idle
            return isOpen(deck)
        case .failed(let failure):
            purchases[deck.id] = .failed(failure)
            return isOpen(deck)
        }
    }

    /// Only ever from a button somebody pressed: it MAY show a system prompt.
    @discardableResult
    public func restorePurchases() async -> RestoreResult {
        if isRestoring, let lastRestore { return lastRestore }
        isRestoring = true
        let result = await coordinator.restorePurchases()
        isRestoring = false
        lastRestore = result
        if case .restored(let keys, _) = result {
            await adopt(keys)
        }
        return result
    }

    /// Clears the neutral "nothing to restore" line once it has been read.
    public func acknowledgeRestore() {
        lastRestore = nil
    }

    /// Clears a failure a screen has shown, so leaving and returning does not
    /// show it again.
    public func acknowledgeFailure(for deck: DeckRecord) {
        guard case .failed = phase(of: deck) else { return }
        purchases[deck.id] = .idle
    }

    // MARK: - State

    private func readState() async {
        await adopt(await coordinator.entitlements())
    }

    private func adopt(_ keys: Set<String>) async {
        isGuest = await scopes?.currentScope().isGuest ?? false
        confirmedKeys = await serverKeys()
        guard keys != entitlementKeys else { return }
        entitlementKeys = keys
        // The catalogue regroups and a deck that has just been paid for
        // downloads its cards. Both belong to content, which is why this is a
        // closure rather than a dependency: commerce says what changed, and
        // content decides what that costs.
        await onEntitlementsChanged(keys)
    }

    private func serverKeys() async -> Set<String> {
        guard let confirmed, let scopes else { return entitlementKeys }
        let scope = await scopes.currentScope()
        return (try? await confirmed.snapshot(scope: scope).entitlementKeys) ?? []
    }
}
