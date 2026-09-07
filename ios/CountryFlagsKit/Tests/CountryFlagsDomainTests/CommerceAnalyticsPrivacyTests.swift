import XCTest

@testable import CountryFlagsDomain

/// The half of "no event carries money or an Apple Account" that can be
/// proved without running the app.
///
/// `CommerceAnalyticsTests` drives a real purchase and reads what came out;
/// this reads the shape instead. Both are needed: a behavioural test proves
/// today's call sites are clean, and this proves the registry cannot declare a
/// place to put the forbidden value tomorrow. A property that does not exist
/// cannot be filled in by a call site somebody adds in a hurry.
///
/// Document 17 §17.2: never a transaction ID, an `appAccountToken`, a raw
/// price or currency string, or Apple Account data.
final class CommerceAnalyticsPrivacyTests: XCTestCase {
    private struct CanonicalRegistry: Decodable {
        struct Property: Decodable {
            let type: String
            let required: Bool?
            let enumValues: [String]?
        }

        struct Event: Decodable {
            let name: String
            let category: String
            let consentCategory: String
            let properties: [String: Property]?
        }

        let events: [Event]
    }

    /// Fragments that name something a commerce event may never carry. Matched
    /// against property names rather than against values, because a property
    /// is the only thing that has a name before anybody sends anything.
    private static let forbiddenNameFragments = [
        "transaction",
        "appaccount",
        "accounttoken",
        "originalid",
        "price",
        "currency",
        "amount",
        "revenue",
        "receipt",
        "jws",
        "signed",
        "appleid",
        "email",
        "storefront",
    ]

    private lazy var registry: CanonicalRegistry = {
        let url = repositoryRoot.appending(path: "contracts/registries/analytics-events.json")
        guard let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode(CanonicalRegistry.self, from: data)
        else {
            fatalError("The analytics registry could not be read from \(url.path())")
        }
        return decoded
    }()

    /// No event — commerce or otherwise — declares somewhere to put a
    /// transaction, a token or a price.
    func testNoRegisteredPropertyNamesSomethingForbidden() {
        for event in registry.events {
            for name in (event.properties ?? [:]).keys {
                let lowered = name.lowercased()
                for fragment in Self.forbiddenNameFragments {
                    XCTAssertFalse(
                        lowered.contains(fragment),
                        "\(event.name).\(name) names something an event may never carry"
                    )
                }
            }
        }
    }

    /// A price is a number the store formatted, so it would arrive as a string
    /// with a symbol or a separator in it. No enumerated value looks like one,
    /// and the price of a deck is reported as a state instead.
    func testNoEnumeratedValueLooksLikeMoney() {
        let money = CharacterSet(charactersIn: "$€£¥₽.,")
        for event in registry.events {
            for (name, property) in event.properties ?? [:] {
                for value in property.enumValues ?? [] {
                    XCTAssertNil(
                        value.rangeOfCharacter(from: money),
                        "\(event.name).\(name) can be \(value), which reads like a price"
                    )
                }
            }
        }
    }

    /// Every commerce event is optional product analytics, so a device that
    /// said no to it collects none of it.
    ///
    /// The transaction ledger the server keeps is a different thing entirely —
    /// essential app functionality, not analytics — and it does not travel
    /// through here at all.
    func testEveryCommerceEventObeysConsent() {
        for name in AnalyticsEventName.allCases where Self.isCommerce(name) {
            XCTAssertEqual(
                name.consentCategory,
                .productAnalytics,
                "\(name.rawValue) must be withheld from somebody who said no"
            )
            XCTAssertTrue(name.isOptional)
        }
        // And the registry agrees, which is what the backend enforces.
        for event in registry.events where Self.isCommerce(event.name) {
            XCTAssertEqual(event.consentCategory, "product_analytics", event.name)
            XCTAssertEqual(event.category, "product", event.name)
        }
    }

    /// Every way a purchase can fail has a bounded reason. A case added to the
    /// domain without one here would otherwise be reported as nothing at all.
    func testEveryPurchaseFailureHasABoundedReason() {
        let reported = Set(
            PurchaseFailure.Reason.allCases.map { AnalyticsPurchaseFailureReason($0).rawValue }
        )
        XCTAssertEqual(
            reported,
            Set(AnalyticsPurchaseFailureReason.allCases.map(\.rawValue)),
            "A failure reason maps to no analytics value, or one nothing produces"
        )
    }

    /// A content kind published after this release reports as `unknown`
    /// rather than as the string the pipeline sent.
    func testAnUnknownContentKindIsNotFreeText() {
        XCTAssertEqual(AnalyticsContentKind(AssetType(rawValue: "ANTHEM")), .unknown)
        XCTAssertEqual(AnalyticsContentKind(AssetType(rawValue: "COAT_OF_ARMS")), .coatOfArms)
    }

    /// The price is reported as which of the three states the screen was in,
    /// never as what the store said.
    func testThePriceIsReportedAsAStateAndNotAsANumber() {
        XCTAssertEqual(AnalyticsStorePriceState(.priced("€4.99")), .priced)
        XCTAssertEqual(AnalyticsStorePriceState(.loading), .loading)
        XCTAssertEqual(AnalyticsStorePriceState(.unavailable), .unavailable)

        let event = AnalyticsEvent.paywallViewed(
            offerState: AnalyticsStorePriceState(.priced("€4.99")),
            isPurchaseOffered: true,
            at: Date(timeIntervalSince1970: 1_800_000_000)
        )
        for value in event.properties.values {
            guard case .string(let text) = value else { continue }
            XCTAssertFalse(text.contains("4.99"))
            XCTAssertFalse(text.contains("€"))
        }
    }

    // MARK: - Harness

    private static func isCommerce(_ name: AnalyticsEventName) -> Bool {
        isCommerce(name.rawValue)
    }

    private static func isCommerce(_ name: String) -> Bool {
        name.hasPrefix("purchase.") || name.hasPrefix("paid_deck.") || name.hasPrefix("paywall.")
    }

    private var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // CountryFlagsDomainTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // CountryFlagsKit
            .deletingLastPathComponent()  // ios
            .deletingLastPathComponent()  // repository root
    }
}
