import XCTest

@testable import CountryFlagsDomain

/// Holds the typed ad placements to the shared registry.
///
/// `AdPlacement` spells out the placements by hand so a surface the product
/// decided against cannot be named by passing a string. That hand-written list
/// is only as good as its agreement with the registry the backend serves from,
/// and a placement whose format or gating flag drifted would not fail until an
/// ad was actually wired to it.
///
/// The canonical file is read from the repository rather than mirrored into the
/// package, for the same reason as `FeatureFlagRegistryParityTests`: a mirror is
/// one more thing that can be stale, and this check exists to catch staleness.
final class AdPlacementRegistryParityTests: XCTestCase {
    private struct CanonicalRegistry: Decodable {
        struct Placement: Decodable {
            let key: String
            let format: String
            let defaultEnabled: Bool
            let approvedForRelease: Bool
            let featureFlag: String
            let activationPolicy: String
            let allowedSurfaces: [String]
            let owner: String
        }

        let placements: [Placement]
    }

    func testTypedPlacementsMatchTheCanonicalRegistry() throws {
        let canonical = try loadCanonicalRegistry()
        XCTAssertFalse(canonical.placements.isEmpty)

        for placement in canonical.placements {
            let typed = try XCTUnwrap(
                AdPlacement(rawValue: placement.key),
                "\(placement.key) is registered but missing from AdPlacement"
            )
            XCTAssertEqual(typed.format.rawValue, placement.format, placement.key)
            XCTAssertEqual(typed.featureFlag.rawValue, placement.featureFlag, placement.key)
        }
    }

    /// A placement the backend does not know about would never be served a
    /// policy, so it would sit silently disabled forever.
    func testTypedPlacementsHaveNoUnknownKeys() throws {
        let canonical = try loadCanonicalRegistry()
        let canonicalKeys = Set(canonical.placements.map(\.key))

        for placement in AdPlacement.allCases {
            XCTAssertTrue(
                canonicalKeys.contains(placement.rawValue),
                "\(placement.rawValue) is not registered in contracts/registries/ad-placements.json"
            )
        }
    }

    /// Advertising is off in the MVP. Flipping either of these in the registry
    /// is a product and privacy decision, not a config tweak, so it should fail
    /// here first and be argued for on its own.
    func testNoPlacementIsEnabledOrApprovedForRelease() throws {
        let canonical = try loadCanonicalRegistry()

        for placement in canonical.placements {
            XCTAssertFalse(placement.defaultEnabled, placement.key)
            XCTAssertFalse(placement.approvedForRelease, placement.key)
        }
    }

    /// The gating flag has to be one the client can actually read, otherwise
    /// the placement is gated on a key that never resolves.
    func testGatingFlagsAreRegisteredBooleanFlags() throws {
        let canonical = try loadCanonicalRegistry()

        for placement in canonical.placements {
            let flag = try XCTUnwrap(
                BooleanFeatureFlag(rawValue: placement.featureFlag),
                "\(placement.featureFlag) gates \(placement.key) but is not a known boolean flag"
            )
            XCTAssertEqual(flag.activationPolicy.rawValue, placement.activationPolicy, placement.key)
        }
    }

    private func loadCanonicalRegistry() throws -> CanonicalRegistry {
        let url = Self.repositoryRoot
            .appending(path: "contracts/registries/ad-placements.json")
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
