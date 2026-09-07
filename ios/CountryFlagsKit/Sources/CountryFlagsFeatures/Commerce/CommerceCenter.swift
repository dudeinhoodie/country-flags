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
    /// The funnel, and nothing that could pay for anything.
    ///
    /// Every event built here comes from `AnalyticsEvent`'s factories, whose
    /// initialiser is private, so there is no way to attach a transaction, a
    /// token or a price to one — see `CommerceAnalyticsPrivacyTests`. It is
    /// optional because a preview and most tests have no analytics at all.
    private let analytics: (any AnalyticsTracking)?
    private let dates: any DateProviding
    /// Decks already counted as seen, so a lazy list that draws the same row
    /// three times reports one impression rather than three.
    private var reportedImpressions: Set<UUID> = []
    /// Deck screens already counted as opened, for the same reason: SwiftUI
    /// re-runs a `task` whenever its identity changes, and a purchase settling
    /// under an open screen changes it.
    private var reportedOpens: Set<UUID> = []
    private var reportedPaywalls: Set<UUID> = []
    private var hasStarted = false
    private var listener: Task<Void, Never>?

    public init(
        coordinator: any PurchaseCoordinating,
        isPurchasingOffered: @escaping @MainActor () -> Bool = { true },
        confirmed: (any EntitlementRepository)? = nil,
        scopes: (any AccountScopeResolving)? = nil,
        analytics: (any AnalyticsTracking)? = nil,
        dates: any DateProviding = SystemDateProvider(),
        onEntitlementsChanged: @escaping @MainActor (Set<String>) async -> Void = { _ in }
    ) {
        self.coordinator = coordinator
        self.isPurchasingOffered = isPurchasingOffered
        self.confirmed = confirmed
        self.scopes = scopes
        self.analytics = analytics
        self.dates = dates
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

    /// The account that owned things has gone.
    ///
    /// What this device may open is now the new scope's answer, which for a
    /// guest is nothing — so the keys move, and content takes the paid payload
    /// off the device through `onEntitlementsChanged`. The stored snapshot of
    /// the account that left is deliberately kept: it is what lets signing
    /// back in on a plane restore the deck without asking the server.
    ///
    /// Everything about the session that is over goes with it — a failure on a
    /// deck, a restore result, what has been counted as seen — because the
    /// next person to use this device is a different person.
    public func signedOut() async {
        purchases.removeAll()
        lastRestore = nil
        reportedImpressions.removeAll()
        reportedOpens.removeAll()
        reportedPaywalls.removeAll()
        await readState()
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
            await track(.purchaseFailed(reason: .productUnavailable, at: dates.now()))
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
        await track(.purchaseStarted(at: dates.now()))
        let result = await coordinator.purchase(productID: productID)
        switch result {
        case .purchased(let keys):
            // Verified and written down. The deck opens now; the cards are
            // what the screen waits for, and the backend is told in the
            // background.
            purchases[deck.id] = .delivering
            await adopt(keys)
            purchases[deck.id] = .idle
            // Whether the server had caught up by now, which is the one thing
            // worth measuring about a delivery. A queued purchase is not a
            // failure — the outbox is retrying — but a storefront where every
            // purchase is queued is one nobody is verifying.
            await track(
                .purchaseCompleted(
                    delivery: isAwaitingSync(deck) ? .queued : .acknowledged,
                    at: dates.now()
                )
            )
            return isOpen(deck)
        case .awaitingApproval:
            purchases[deck.id] = .awaitingApproval
            await track(.purchasePending(at: dates.now()))
            return false
        case .cancelled:
            // Not an error. Not an alert. The screen it came from is unchanged.
            purchases[deck.id] = .idle
            await track(.purchaseCancelled(at: dates.now()))
            return isOpen(deck)
        case .failed(let failure):
            purchases[deck.id] = .failed(failure)
            await track(
                .purchaseFailed(
                    reason: AnalyticsPurchaseFailureReason(failure.reason),
                    at: dates.now()
                )
            )
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
        switch result {
        case .restored(let keys, let found):
            await adopt(keys)
            // Finding nothing is its own outcome. Counting it as a failure is
            // how a working app looks broken on a dashboard.
            await track(
                .purchaseRestoreCompleted(
                    result: found == 0 || keys.isEmpty ? .nothingFound : .restored,
                    at: dates.now()
                )
            )
        case .failed:
            await track(.purchaseRestoreCompleted(result: .failed, at: dates.now()))
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

    // MARK: - What the screens report

    /// Counts the decks that are for sale and are on screen.
    ///
    /// Called with everything the catalogue is showing rather than with one
    /// deck per row: the free decks are filtered out here, so a caller does
    /// not have to know which is which, and a catalogue with nothing for sale
    /// reports nothing at all.
    public func recordImpressions(of decks: [DeckRecord]) async {
        for deck in decks where deck.isSold && !reportedImpressions.contains(deck.id) {
            reportedImpressions.insert(deck.id)
            await track(.paidDeckImpression(access: access(of: deck), at: dates.now()))
        }
    }

    /// A deck that is for sale was opened, locked or owned.
    public func recordOpened(_ deck: DeckRecord) async {
        guard deck.isSold, !reportedOpens.contains(deck.id) else { return }
        reportedOpens.insert(deck.id)
        await track(.paidDeckOpened(access: access(of: deck), at: dates.now()))
    }

    /// The locked deck screen was shown, and what it could say about the
    /// price — which of the three states it was in, never the number itself.
    public func recordPaywallViewed(_ deck: DeckRecord) async {
        guard deck.isSold, !isOpen(deck), !reportedPaywalls.contains(deck.id) else { return }
        reportedPaywalls.insert(deck.id)
        await track(
            .paywallViewed(
                offerState: AnalyticsStorePriceState(price(of: deck)),
                isPurchaseOffered: isPurchaseAvailable,
                at: dates.now()
            )
        )
    }

    /// A study session started in a deck that was bought. Free decks report
    /// nothing here: `study.session_started` already covers every session, and
    /// this one exists to say whether a purchase is being used.
    public func recordStudyStarted(in deck: DeckRecord, mode: AnalyticsStudyMode) async {
        guard deck.isSold else { return }
        await track(.paidDeckStudyStarted(mode: mode, at: dates.now()))
    }

    private func access(of deck: DeckRecord) -> AnalyticsPaidDeckAccess {
        isOpen(deck) ? .owned : .locked
    }

    private func track(_ event: AnalyticsEvent) async {
        await analytics?.track(event)
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
