import Foundation

/// What opens a deck, decided in one place.
///
/// The rule is document 17 §10, written once and read by the catalogue, the
/// deck screen and the session that starts from it:
///
/// ```text
/// access = FREE
/// OR
/// exists ACTIVE UserEntitlementGrant(requiredEntitlementKey)
/// ```
///
/// No feature flag appears in it. A flag decides whether a deck is offered for
/// sale, never whether it is open: an owner keeps a deck with the storefront
/// switched off, and a non-owner is told that buying is unavailable rather than
/// handed the deck.
///
/// Nothing here is a security boundary. The backend refuses the cards of a deck
/// this account does not hold, and that refusal is what protects the content;
/// this decides what to draw.
extension DeckRecord {
    /// Whether this account may open the deck, given what the server last said
    /// it holds.
    ///
    /// An access model this build does not know reads as closed. The safe
    /// reading of a value published after this release is that it needs
    /// something the release cannot check — and the backend will refuse it
    /// anyway, so drawing it as open would only promise a screen that then
    /// fails.
    public func isOpen(given entitlementKeys: Set<String>) -> Bool {
        switch access {
        case .free:
            return true
        case .entitlement:
            guard let requiredEntitlementKey else {
                // An entitlement deck that names no entitlement cannot be
                // matched against anything. It stays closed rather than
                // becoming free by omission.
                return false
            }
            return entitlementKeys.contains(requiredEntitlementKey)
        case .unknown:
            return false
        }
    }

    /// Whether the deck is sold rather than simply published — true even for an
    /// owner, because it is a property of the deck and not of the account.
    public var isSold: Bool { !isFree }
}

/// What a screen may say about the price of a deck.
///
/// Three cases and no fourth, because the fourth is the bug the spec names:
/// a placeholder price. The store is the only thing that knows what a product
/// costs in this storefront, in this currency, after this region's tax, and a
/// number assembled anywhere else is a number App Review never approved.
public enum StorePriceState: Hashable, Sendable {
    /// The store has not answered yet. The screen reserves the space and says
    /// so; it does not guess.
    case loading
    /// The store's own formatting, verbatim.
    case priced(String)
    /// The store does not sell this product to this account, in this
    /// storefront, today — or the storefront is switched off.
    case unavailable
}

/// Where one deck's purchase stands on this device.
///
/// Held per deck rather than as one "is busy" flag: two paid decks are two
/// products, and a tap on one must not disable the other.
public enum DeckPurchasePhase: Hashable, Sendable {
    /// Nothing is happening. The buy action is live.
    case idle
    /// The store sheet is up, or the app is settling what it returned. A
    /// second tap joins this rather than starting a second purchase.
    case purchasing
    /// Ask to Buy, or a payment the store still has to confirm. The deck stays
    /// locked, the answer arrives at the transaction listener, and the action
    /// says so instead of inviting another attempt.
    case awaitingApproval
    /// Paid for and verified; the cards are on their way.
    case delivering
    /// The last attempt ended in something the person has to be told about.
    /// A cancellation is not one of these — it is `idle`.
    case failed(PurchaseFailure)
}
