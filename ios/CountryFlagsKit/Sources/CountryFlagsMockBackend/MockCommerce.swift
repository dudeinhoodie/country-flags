import CryptoKit
import Foundation

/// The commerce half of the Mock build: one deck for sale, and an account that
/// comes to own it.
///
/// Access is not in the content release. Which deck costs money is a backend
/// fact — offers, entitlements and grants live in its tables, not in
/// `content/generated` — so the mock backend is the honest place to state it,
/// and `sync-mock-content.mjs --check` still governs everything the release
/// does own.
///
/// It is stateful on purpose, and that is the whole point of it: the paywall,
/// the purchase, the download and the owned list can be walked end to end
/// without a server, which is what makes them reviewable and what a UI test
/// drives. Nothing here verifies anything — the real backend reads the signed
/// payload and decides — so a submission is simply believed.
public final class MockCommerce: @unchecked Sendable {
    /// The deck the Mock build sells. Small, curated, and not the deck any
    /// existing test opens: `EUROPE` is what the browse and screenshot suites
    /// walk through, and it stays free.
    public static let deckCode = "SPECIAL_AREAS"
    public static let entitlementKey = "entitlement.special_areas"
    public static let offerCode = "SPECIAL_AREAS_LIFETIME"
    /// A mock identifier, spelled as one. The production and dev identifiers
    /// belong to products that exist in App Store Connect; inventing a fourth
    /// under either of their names would be a build claiming to sell something
    /// real.
    public static let productID = "app.countryflags.mock.deck.special_areas.lifetime.v1"

    private let lock = NSLock()
    private var isGranted = false

    public init(isGranted: Bool = false) {
        self.isGranted = isGranted
    }

    private var granted: Bool {
        lock.lock()
        defer { lock.unlock() }
        return isGranted
    }

    private func grant() {
        lock.lock()
        defer { lock.unlock() }
        isGranted = true
    }

    // MARK: - Registration

    /// Answered from the request rather than from a fixed response, because
    /// the answer changes when somebody buys something.
    public func handlers() -> [String: MockClientTransport.Handler] {
        [
            "listCommerceOffers": { [self] _ in .json(offers) },
            "getMyEntitlements": { [self] _ in
                .json(snapshot, headerFields: ["etag": entityTag])
            },
            "submitAppleTransactions": { [self] _ in
                // The store said it happened and the device verified the
                // signature. A real backend checks it again with Apple; a mock
                // has nothing to check with, so it records the grant and
                // answers with the account's whole snapshot, which is what
                // replaces the local one.
                grant()
                return .json(snapshot)
            },
        ]
    }

    /// Whether a deck's cards may be served.
    ///
    /// The guard, in one line: the paid deck refuses its cards until the
    /// account holds the entitlement, which is what makes the client's
    /// `awaiting-entitlement` handling reachable without a server.
    public func allowsCards(inDeckCoded code: String) -> Bool {
        code != Self.deckCode || granted
    }

    /// The `access` block the deck list carries for the deck that is for sale,
    /// and nothing for any other deck.
    public func access(forDeckCoded code: String) -> [String: Any]? {
        guard code == Self.deckCode else { return nil }
        return [
            "model": "ENTITLEMENT",
            "requiredEntitlementKey": Self.entitlementKey,
            "offerCodes": [Self.offerCode],
        ]
    }

    // MARK: - Documents

    private var offers: String {
        """
        {"items":[{"code":"\(Self.offerCode)","kind":"ONE_TIME",\
        "storeProduct":{"provider":"APPLE_APP_STORE","productId":"\(Self.productID)"},\
        "grants":["\(Self.entitlementKey)"],\
        "title":"Special areas","description":"Antarctica and the islands that belong to no country."}]}
        """
    }

    private var snapshot: String {
        let keys = granted ? "\"\(Self.entitlementKey)\"" : ""
        return """
            {"entitlementKeys":[\(keys)],"checkedAt":"2026-01-01T00:00:00.000Z"}
            """
    }

    /// The tag is a function of the answer, so a foreground check costs a
    /// `304` until a purchase changes what the answer is.
    private var entityTag: String {
        let digest = SHA256.hash(data: Data(snapshot.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return "\"\(digest)\""
    }
}
