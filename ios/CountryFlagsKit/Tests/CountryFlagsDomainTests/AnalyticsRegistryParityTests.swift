import XCTest

@testable import CountryFlagsDomain

/// Holds the typed event API to the shared registry.
///
/// The backend validates every event against the same file — name, property
/// names, types and enumerated values — so a client that drifts does not fail
/// at compile time or in review: it fails as a rejected event in production,
/// where nobody is looking. The canonical file is read from the repository
/// rather than mirrored into the package, for the same reason the feature flag
/// parity test reads it: a mirror is one more thing that can go stale, and this
/// check exists precisely to catch staleness.
final class AnalyticsRegistryParityTests: XCTestCase {
    private struct CanonicalRegistry: Decodable {
        struct Property: Decodable {
            let type: String
            let required: Bool?
            let enumValues: [String]?
        }

        struct Event: Decodable {
            let name: String
            let schemaVersion: Int
            let category: String
            let consentCategory: String
            let properties: [String: Property]?
        }

        let schemaVersion: Int
        let events: [Event]
    }

    private lazy var registry: CanonicalRegistry = {
        let url = repositoryRoot.appending(path: "contracts/registries/analytics-events.json")
        guard let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode(CanonicalRegistry.self, from: data)
        else {
            fatalError("The analytics registry could not be read from \(url.path())")
        }
        return decoded
    }()

    /// Every registered event has a name in the enum, and the enum has no name
    /// the registry does not know.
    func testTheClientKnowsExactlyTheRegisteredEvents() {
        let canonical = Set(registry.events.map(\.name))
        let client = Set(AnalyticsEventName.allCases.map(\.rawValue))

        XCTAssertEqual(client, canonical, "The client and the registry disagree about events")
    }

    func testEverySchemaVersionMatches() {
        for event in registry.events {
            guard let name = AnalyticsEventName(rawValue: event.name) else { continue }
            XCTAssertEqual(
                name.schemaVersion,
                event.schemaVersion,
                "\(event.name) is versioned differently by the client"
            )
        }
    }

    /// Consent is the whole privacy model: an event the registry calls optional
    /// must be optional here, or it would be collected from somebody who said
    /// no.
    func testConsentCategoriesMatch() {
        for event in registry.events {
            guard let name = AnalyticsEventName(rawValue: event.name) else { continue }
            XCTAssertEqual(
                name.consentCategory.rawValue,
                event.consentCategory,
                "\(event.name) has a different consent category on the client"
            )
        }
    }

    /// The factories are the only way to build an event, so building one of
    /// each proves the property names and types the client sends. A property
    /// the registry requires and the client omits is caught here rather than by
    /// a rejected batch.
    func testEveryEventCarriesExactlyItsRegisteredProperties() {
        for event in Fixtures.oneOfEach {
            guard let definition = registry.events.first(where: { $0.name == event.name.rawValue })
            else {
                return XCTFail("\(event.name.rawValue) is not in the registry")
            }
            let declared = definition.properties ?? [:]

            for (name, property) in declared where property.required == true {
                XCTAssertNotNil(
                    event.properties[name],
                    "\(event.name.rawValue) omits the required property \(name)"
                )
            }
            for (name, value) in event.properties {
                guard let property = declared[name] else {
                    return XCTFail("\(event.name.rawValue) sends the unregistered property \(name)")
                }
                XCTAssertTrue(
                    Self.matches(value, type: property.type),
                    "\(event.name.rawValue).\(name) is sent as the wrong type"
                )
                if let allowed = property.enumValues, case .string(let sent) = value {
                    XCTAssertTrue(
                        allowed.contains(sent),
                        "\(event.name.rawValue).\(name) sends the unregistered value \(sent)"
                    )
                }
            }
        }
    }

    /// Every enumerated value the registry lists is expressible, so a bucket
    /// the product asks for cannot be missing from the client's own enum.
    func testEveryEnumeratedValueIsExpressible() {
        let expressible: Set<String> =
            Set(AnalyticsAuthState.allCases.map(\.rawValue))
            .union(AnalyticsDeckType.allCases.map(\.rawValue))
            .union(AnalyticsStudyMode.allCases.map(\.rawValue))
            .union(AnalyticsSessionDurationBucket.allCases.map(\.rawValue))
            .union(AnalyticsCorrectRateBucket.allCases.map(\.rawValue))
            .union(AnalyticsProgressBucket.allCases.map(\.rawValue))
            .union(AnalyticsAchievementCategory.allCases.map(\.rawValue))
            .union(AnalyticsAchievementTier.allCases.map(\.rawValue))
            .union(AnalyticsAuthResult.allCases.map(\.rawValue))
            .union(AnalyticsSyncResult.allCases.map(\.rawValue))
            .union(AnalyticsSyncDurationBucket.allCases.map(\.rawValue))
            .union(AnalyticsContentUpdateResult.allCases.map(\.rawValue))
            .union(AnalyticsPaidDeckAccess.allCases.map(\.rawValue))
            .union(AnalyticsStorePriceState.allCases.map(\.rawValue))
            .union(AnalyticsPurchaseDelivery.allCases.map(\.rawValue))
            .union(AnalyticsPurchaseFailureReason.allCases.map(\.rawValue))
            .union(AnalyticsRestoreResult.allCases.map(\.rawValue))
            .union(AnalyticsPaidDeckLoadResult.allCases.map(\.rawValue))
            .union(AnalyticsContentKind.allCases.map(\.rawValue))
            .union(AuthProvider.allCases.map { $0.rawValue.lowercased() })

        for event in registry.events {
            for (name, property) in event.properties ?? [:] {
                for value in property.enumValues ?? [] {
                    XCTAssertTrue(
                        expressible.contains(value),
                        "\(event.name).\(name) can be \(value), which the client cannot express"
                    )
                }
            }
        }
    }

    // MARK: - Harness

    private static func matches(_ value: AnalyticsValue, type: String) -> Bool {
        switch (value, type) {
        case (.string, "string"), (.integer, "integer"), (.boolean, "boolean"): true
        case (.number, "number"), (.integer, "number"): true
        default: false
        }
    }

    private var repositoryRoot: URL {
        // Tests always run from a checkout, so walking up from this file
        // resolves in CI exactly as it does locally.
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // CountryFlagsDomainTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // CountryFlagsKit
            .deletingLastPathComponent()  // ios
            .deletingLastPathComponent()  // repository root
    }

    private enum Fixtures {
        static let instant = Date(timeIntervalSince1970: 1_800_000_000)

        /// One of every event the client can build. Adding a case to the enum
        /// without adding it here fails `testTheClientKnowsExactlyTheRegisteredEvents`'s
        /// sibling below.
        static let oneOfEach: [AnalyticsEvent] = [
            .onboardingCompleted(authState: .guest, at: instant),
            .deckOpened(deckType: .system, at: instant),
            .studySessionStarted(mode: .selfRated, requestedCardCount: 10, at: instant),
            .studySessionCompleted(
                mode: .multipleChoice,
                deckType: .system,
                requestedCardCount: 10,
                uniqueCardCount: 10,
                reviewCount: 12,
                duration: .oneToThreeMinutes,
                correctRate: .good,
                at: instant
            ),
            .studySessionAbandoned(mode: .selfRated, progress: .half, at: instant),
            .achievementEarned(category: .mastery, tier: .gold, at: instant),
            .featureExposed(
                flagKey: "study.multiple_choice.enabled",
                variant: "enabled",
                experimentId: "study.multiple_choice.enabled",
                surface: "deck_details",
                at: instant
            ),
            .authCompleted(provider: .apple, result: .success, at: instant),
            .syncCompleted(result: .success, duration: .underOneSecond, at: instant),
            .contentUpdateCompleted(result: .success, at: instant),
            .paidDeckImpression(access: .locked, at: instant),
            .paidDeckOpened(access: .owned, at: instant),
            .paywallViewed(offerState: .priced, isPurchaseOffered: true, at: instant),
            .purchaseStarted(at: instant),
            .purchaseCompleted(delivery: .acknowledged, at: instant),
            .purchasePending(at: instant),
            .purchaseCancelled(at: instant),
            .purchaseFailed(reason: .network, at: instant),
            .purchaseRestoreCompleted(result: .nothingFound, at: instant),
            .paidDeckContentLoaded(result: .success, at: instant),
            .paidDeckStudyStarted(mode: .selfRated, at: instant),
            .cardDetailOpened(contentKind: .coatOfArms, at: instant),
        ]
    }

    /// The fixtures above have to cover the enum, or the property check silently
    /// stops covering whatever was added last.
    func testTheFixturesCoverEveryEvent() {
        XCTAssertEqual(
            Set(Fixtures.oneOfEach.map(\.name)),
            Set(AnalyticsEventName.allCases)
        )
    }
}
