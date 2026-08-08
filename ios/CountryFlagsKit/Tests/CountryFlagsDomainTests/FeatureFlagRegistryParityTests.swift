import XCTest

@testable import CountryFlagsDomain

/// Holds the client registry to the shared one.
///
/// The backend enforces the same flags server-side, so a key, a type or a
/// default that drifts is not a client bug — it is two systems disagreeing
/// about what a feature is, and the disagreement only shows up in production.
///
/// The canonical file is read from the repository rather than mirrored into the
/// package: a mirror is one more thing that can be stale, and this check exists
/// precisely to catch staleness. Tests always run from a checkout, so the path
/// resolves in CI exactly as it does locally.
final class FeatureFlagRegistryParityTests: XCTestCase {
    private struct CanonicalRegistry: Decodable {
        struct Flag: Decodable {
            let key: String
            let type: String
            let defaultValue: CanonicalValue
            let category: String
            let activationPolicy: String
            let serverEnforced: Bool
            let clientVisible: Bool
            let owner: String
            let allowedValues: [String]?
            let minimum: Double?
            let maximum: Double?
        }

        let flags: [Flag]
    }

    /// The registry types the defaults per flag, so the JSON value is decoded
    /// as whichever of the three it happens to be.
    private enum CanonicalValue: Decodable {
        case boolean(Bool)
        case string(String)
        case number(Double)

        init(from decoder: any Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let value = try? container.decode(Bool.self) {
                self = .boolean(value)
            } else if let value = try? container.decode(Double.self) {
                self = .number(value)
            } else {
                self = .string(try container.decode(String.self))
            }
        }

        var featureFlagValue: FeatureFlagValue {
            switch self {
            case .boolean(let value): .boolean(value)
            case .string(let value): .string(value)
            case .number(let value): .number(value)
            }
        }
    }

    func testClientRegistryMatchesTheCanonicalOne() throws {
        let canonical = try loadCanonicalRegistry()
        let clientVisible = canonical.flags.filter(\.clientVisible)
        XCTAssertFalse(clientVisible.isEmpty)

        for flag in clientVisible {
            let definition = try XCTUnwrap(
                FeatureFlagRegistry.definition(forKey: flag.key),
                "\(flag.key) is client visible but missing from the typed registry"
            )
            XCTAssertEqual(definition.type.rawValue, flag.type, flag.key)
            XCTAssertEqual(definition.defaultValue, flag.defaultValue.featureFlagValue, flag.key)
            XCTAssertEqual(definition.activationPolicy.rawValue, flag.activationPolicy, flag.key)
            XCTAssertEqual(definition.category.rawValue, flag.category, flag.key)
            XCTAssertEqual(definition.owner, flag.owner, flag.key)
            XCTAssertEqual(definition.allowedValues, flag.allowedValues, flag.key)

            if let minimum = flag.minimum, let maximum = flag.maximum {
                XCTAssertEqual(definition.bounds, minimum...maximum, flag.key)
            } else {
                XCTAssertNil(definition.bounds, flag.key)
            }
        }
    }

    /// The client cannot invent a key: the backend would never evaluate it, so
    /// it would silently sit at its default forever.
    func testTypedRegistryHasNoUnknownKeys() throws {
        let canonical = try loadCanonicalRegistry()
        let canonicalKeys = Set(canonical.flags.map(\.key))

        for definition in FeatureFlagRegistry.definitions {
            XCTAssertTrue(
                canonicalKeys.contains(definition.key),
                "\(definition.key) is not registered in contracts/registries/feature-flags.json"
            )
        }
    }

    /// Advertising defaults are the one set the product decided cannot be
    /// wrong: every placement is off until a policy says otherwise.
    func testAdvertisingFlagsDefaultToOff() {
        for flag in BooleanFeatureFlag.allCases where flag.rawValue.hasPrefix("ads.") {
            XCTAssertFalse(flag.defaultValue, flag.rawValue)
            XCTAssertEqual(flag.activationPolicy, .immediate, flag.rawValue)
        }
    }

    private func loadCanonicalRegistry() throws -> CanonicalRegistry {
        let url = Self.repositoryRoot
            .appending(path: "contracts/registries/feature-flags.json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(CanonicalRegistry.self, from: data)
    }

    /// This file sits at `ios/CountryFlagsKit/Tests/CountryFlagsDomainTests/`.
    private static let repositoryRoot: URL = URL(filePath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}
