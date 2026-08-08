import Foundation
import XCTest

import CountryFlagsDomain

/// The typed keys must stay identical to the canonical registry: the backend
/// enforces the same flags, and a client that disagrees about a default would
/// take a different decision from the one the server is guarding.
final class FeatureFlagRegistryParityTests: XCTestCase {
    func testEveryClientVisibleCanonicalFlagIsTyped() throws {
        for entry in try canonicalFlags() {
            let key = try XCTUnwrap(entry["key"] as? String)
            guard entry["clientVisible"] as? Bool == true else { continue }
            XCTAssertNotNil(
                FeatureFlagRegistry.definition(forKey: key),
                "\(key) is client-visible in the contract but missing from the typed registry"
            )
        }
    }

    func testTypedFlagsMatchTheCanonicalTypeDefaultAndPolicy() throws {
        let canonical = try Dictionary(
            uniqueKeysWithValues: canonicalFlags().map { entry in
                (try XCTUnwrap(entry["key"] as? String), entry)
            }
        )

        for definition in FeatureFlagRegistry.definitions {
            let entry = try XCTUnwrap(
                canonical[definition.key],
                "\(definition.key) is not in contracts/registries/feature-flags.json"
            )
            XCTAssertEqual(entry["type"] as? String, definition.type.rawValue, definition.key)
            XCTAssertEqual(
                entry["activationPolicy"] as? String,
                definition.activationPolicy.rawValue,
                definition.key
            )
            XCTAssertEqual(entry["category"] as? String, definition.category.rawValue, definition.key)
            XCTAssertEqual(entry["owner"] as? String, definition.owner, definition.key)

            switch definition.defaultValue {
            case .boolean(let value):
                XCTAssertEqual(entry["defaultValue"] as? Bool, value, definition.key)
            case .string(let value):
                XCTAssertEqual(entry["defaultValue"] as? String, value, definition.key)
            case .number(let value):
                XCTAssertEqual(
                    (entry["defaultValue"] as? NSNumber)?.doubleValue,
                    value,
                    definition.key
                )
            }
        }
    }

    func testNumberAndStringBoundsMatchTheContract() throws {
        let canonical = try Dictionary(
            uniqueKeysWithValues: canonicalFlags().map { entry in
                (try XCTUnwrap(entry["key"] as? String), entry)
            }
        )

        for flag in NumberFeatureFlag.allCases {
            let entry = try XCTUnwrap(canonical[flag.key])
            XCTAssertEqual(
                (entry["minimum"] as? NSNumber)?.doubleValue,
                flag.allowedRange.lowerBound,
                flag.key
            )
            XCTAssertEqual(
                (entry["maximum"] as? NSNumber)?.doubleValue,
                flag.allowedRange.upperBound,
                flag.key
            )
        }

        for flag in StringFeatureFlag.allCases {
            let entry = try XCTUnwrap(canonical[flag.key])
            let allowed = try XCTUnwrap(entry["allowedValues"] as? [String])
            XCTAssertEqual(Set(allowed), flag.allowedValues, flag.key)
        }
    }

    private func canonicalFlags() throws -> [[String: Any]] {
        let registry = try PolicyFixtures.registry(named: "feature-flags")
        return try XCTUnwrap(registry["flags"] as? [[String: Any]])
    }
}

final class FeatureFlagDefaultsTests: XCTestCase {
    func testEveryAdvertisingFlagDefaultsToOff() {
        for flag in BooleanFeatureFlag.allCases where flag.key.hasPrefix("ads.") {
            XCTAssertFalse(flag.defaultValue, flag.key)
            // A kill switch that only takes effect next launch is not a kill
            // switch.
            XCTAssertEqual(flag.activationPolicy, .immediate, flag.key)
        }
    }

    func testTheOperationalWritePathDefaultsToWorking() {
        XCTAssertTrue(BooleanFeatureFlag.studyReviewSubmissionEnabled.defaultValue)
    }

    func testUnreleasedFeaturesDefaultToOff() {
        XCTAssertFalse(BooleanFeatureFlag.studyMultipleChoiceEnabled.defaultValue)
    }

    func testEveryKeyIsUnique() {
        let keys = FeatureFlagRegistry.definitions.map(\.key)
        XCTAssertEqual(Set(keys).count, keys.count)
    }

    func testKeysFollowTheNamingFormat() throws {
        let pattern = try NSRegularExpression(
            pattern: #"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,}$"#
        )
        for key in FeatureFlagRegistry.definitions.map(\.key) {
            let range = NSRange(key.startIndex..., in: key)
            XCTAssertNotNil(pattern.firstMatch(in: key, range: range), key)
        }
    }

    func testAnUnknownKeyHasNoDefinition() {
        XCTAssertNil(FeatureFlagRegistry.definition(forKey: "study.telepathy.enabled"))
    }

    func testBundledDefaultsCoverEveryKey() {
        XCTAssertEqual(
            FeatureFlagRegistry.bundledDefaults.count,
            FeatureFlagRegistry.definitions.count
        )
    }
}

final class BundledFeatureFlagProviderTests: XCTestCase {
    func testWithoutOverridesEveryValueIsTheRegistryDefault() {
        let provider = BundledFeatureFlagProvider()

        XCTAssertFalse(provider.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertTrue(provider.boolValue(for: .studyReviewSubmissionEnabled))
        XCTAssertEqual(provider.stringValue(for: .homeRecommendedDecksVariant), "control")
        XCTAssertEqual(provider.numberValue(for: .studyMaxNewCardsPerSession), 10)
    }

    func testAnOverrideOutsideTheRegistryBoundsIsIgnored() {
        let provider = BundledFeatureFlagProvider(
            overrides: [
                NumberFeatureFlag.studyMaxNewCardsPerSession.key: .number(500),
                StringFeatureFlag.homeRecommendedDecksVariant.key: .string("mystery"),
            ]
        )

        XCTAssertEqual(provider.numberValue(for: .studyMaxNewCardsPerSession), 10)
        XCTAssertEqual(provider.stringValue(for: .homeRecommendedDecksVariant), "control")
    }

    func testAnOverrideOfTheWrongTypeIsIgnored() {
        let provider = BundledFeatureFlagProvider(
            overrides: [BooleanFeatureFlag.studyMultipleChoiceEnabled.key: .string("true")]
        )

        XCTAssertFalse(provider.boolValue(for: .studyMultipleChoiceEnabled))
    }

    func testTheSessionSnapshotCarriesOnlySessionScopedKeys() {
        let snapshot = BundledFeatureFlagProvider().sessionSnapshot()

        let sessionScoped = FeatureFlagRegistry.definitions
            .filter { $0.activationPolicy == .nextSession }
            .map(\.key)
        XCTAssertEqual(Set(snapshot.values.keys), Set(sessionScoped))
        XCTAssertFalse(snapshot.values.keys.contains(BooleanFeatureFlag.adsEnabled.key))
    }

    func testASessionSnapshotFallsBackToTheDefaultForAValueItDoesNotCarry() {
        let snapshot = FeatureFlagSessionSnapshot(configVersion: "v1", values: [:])

        XCTAssertFalse(snapshot.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(snapshot.numberValue(for: .studyMaxNewCardsPerSession), 10)
    }

    func testASessionSnapshotRejectsAValueOfTheWrongType() {
        let snapshot = FeatureFlagSessionSnapshot(
            configVersion: "v1",
            values: [BooleanFeatureFlag.studyMultipleChoiceEnabled.key: .number(1)]
        )

        XCTAssertFalse(snapshot.boolValue(for: .studyMultipleChoiceEnabled))
    }
}
