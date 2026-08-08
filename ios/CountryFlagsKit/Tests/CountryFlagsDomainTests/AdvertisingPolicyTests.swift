import Foundation
import XCTest

import CountryFlagsDomain

/// The placement registry must stay identical to the canonical one: the backend
/// evaluates the same keys, and a placement the client understood differently
/// would be a placement nobody approved.
final class AdPlacementRegistryParityTests: XCTestCase {
    func testEveryCanonicalPlacementIsTyped() throws {
        let canonical = try canonicalPlacements()
        let keys = try canonical.map { try XCTUnwrap($0["key"] as? String) }

        XCTAssertEqual(Set(keys), Set(AdPlacement.allCases.map(\.key)))
    }

    func testPlacementMetadataMatchesTheContract() throws {
        let canonical = try Dictionary(
            uniqueKeysWithValues: canonicalPlacements().map { entry in
                (try XCTUnwrap(entry["key"] as? String), entry)
            }
        )

        for placement in AdPlacement.allCases {
            let entry = try XCTUnwrap(canonical[placement.key])
            XCTAssertEqual(entry["format"] as? String, placement.format.rawValue, placement.key)
            XCTAssertEqual(
                entry["featureFlag"] as? String,
                placement.featureFlag.key,
                placement.key
            )
            XCTAssertEqual(entry["owner"] as? String, placement.owner, placement.key)
            XCTAssertEqual(entry["defaultEnabled"] as? Bool, false, placement.key)
            XCTAssertEqual(
                entry["approvedForRelease"] as? Bool,
                placement.isApprovedForRelease,
                placement.key
            )
            let surfaces = try XCTUnwrap(entry["allowedSurfaces"] as? [String])
            XCTAssertEqual(
                Set(surfaces),
                Set(placement.allowedSurfaces.map(\.rawValue)),
                placement.key
            )
        }
    }

    func testNoPlacementIsApprovedForRelease() {
        for placement in AdPlacement.allCases {
            XCTAssertFalse(placement.isApprovedForRelease, placement.key)
        }
    }

    func testAnUnknownPlacementKeyIsNotResolved() {
        XCTAssertNil(AdPlacementRegistry.placement(forKey: "home.mystery_banner"))
    }

    private func canonicalPlacements() throws -> [[String: Any]] {
        let registry = try PolicyFixtures.registry(named: "ad-placements")
        return try XCTUnwrap(registry["placements"] as? [[String: Any]])
    }
}

final class AdEligibilityTests: XCTestCase {
    private let service = AdEligibilityService(flags: PolicyFixtures.flagsWithAdvertisingOn)

    /// The state the MVP is actually in.
    func testTheShippedConfigurationShowsNothing() {
        let bundled = AdEligibilityService(flags: BundledFeatureFlagProvider())

        let decision = bundled.decide(
            AdEligibilityRequest(
                placement: .homeBottomBanner,
                surface: .home,
                now: PolicyFixtures.instant
            )
        )

        XCTAssertFalse(decision.isAllowed)
    }

    func testEveryPlacementIsDeniedWithTheShippedDefaults() {
        let bundled = AdEligibilityService(flags: BundledFeatureFlagProvider())

        for placement in AdPlacement.allCases {
            for surface in placement.allowedSurfaces {
                let decision = bundled.decide(
                    AdEligibilityRequest(
                        placement: placement,
                        surface: surface,
                        now: PolicyFixtures.instant
                    )
                )
                XCTAssertFalse(decision.isAllowed, placement.key)
            }
        }
    }

    /// The one arrangement in which everything says yes. Each test below turns
    /// exactly one condition off and expects a refusal, which is what proves the
    /// condition is load-bearing rather than accidentally satisfied.
    func testEverythingSatisfiedIsAllowed() {
        XCTAssertEqual(service.decide(PolicyFixtures.allowingRequest()), .allowed)
    }

    func testAnEntitlementOutranksEveryFlag() {
        let decision = service.decide(
            PolicyFixtures.allowingRequest(
                privacy: AdvertisingPrivacyState(
                    advertisingConsent: .granted,
                    isChildDirectedTreatment: false,
                    hasAdFreeEntitlement: true
                )
            )
        )

        XCTAssertEqual(decision.denialReason, .adFreeEntitlement)
    }

    func testAnUndecidedAudienceDeniesAdvertising() {
        let decision = service.decide(
            PolicyFixtures.allowingRequest(
                privacy: AdvertisingPrivacyState(
                    advertisingConsent: .granted,
                    isChildDirectedTreatment: true
                )
            )
        )

        XCTAssertEqual(decision.denialReason, .childDirectedAudience)
    }

    func testUnknownConsentIsNotConsent() {
        for status in [ConsentStatus.unknown, .denied] {
            let decision = service.decide(
                PolicyFixtures.allowingRequest(
                    privacy: AdvertisingPrivacyState(
                        advertisingConsent: status,
                        isChildDirectedTreatment: false
                    )
                )
            )
            XCTAssertEqual(decision.denialReason, .consentMissing, status.rawValue)
        }
    }

    func testAnActiveStudySessionIsAdFree() {
        let decision = service.decide(
            PolicyFixtures.allowingRequest(interface: .activeStudySession)
        )

        XCTAssertEqual(decision.denialReason, .unsafeInterfaceState)
    }

    func testForbiddenSurfacesAreAdFree() {
        for state in AdInterfaceState.allCases where state != .idle {
            let decision = service.decide(PolicyFixtures.allowingRequest(interface: state))
            XCTAssertEqual(decision.denialReason, .unsafeInterfaceState, state.rawValue)
        }
    }

    func testAPlacementCannotAppearOnAnotherSurface() {
        let decision = service.decide(
            PolicyFixtures.allowingRequest(placement: .homeBottomBanner, surface: .catalog)
        )

        XCTAssertEqual(decision.denialReason, .surfaceNotAllowed)
    }

    func testTheGlobalKillSwitchStopsEveryPlacement() {
        let flags = BundledFeatureFlagProvider(
            overrides: [
                BooleanFeatureFlag.adsEnabled.key: .boolean(false),
                BooleanFeatureFlag.adsHomeBottomBannerEnabled.key: .boolean(true),
            ]
        )

        let decision = AdEligibilityService(flags: flags)
            .decide(PolicyFixtures.allowingRequest())

        XCTAssertEqual(decision.denialReason, .globallyDisabled)
    }

    func testAPlacementFlagOfItsOwnIsRequired() {
        let flags = BundledFeatureFlagProvider(
            overrides: [
                BooleanFeatureFlag.adsEnabled.key: .boolean(true),
                BooleanFeatureFlag.adsHomeBottomBannerEnabled.key: .boolean(false),
            ]
        )

        let decision = AdEligibilityService(flags: flags)
            .decide(PolicyFixtures.allowingRequest())

        XCTAssertEqual(decision.denialReason, .placementFlagDisabled)
    }

    func testAnUnapprovedPlacementIsDeniedWithEverythingElseSatisfied() {
        let request = PolicyFixtures.allowingRequest()

        let decision = service.decide(
            Self.replacing(request, approvedPlacements: AdPlacementRegistry.approvedForRelease)
        )

        XCTAssertEqual(decision.denialReason, .placementNotApproved)
    }

    func testAServerPolicyThatDisablesAdvertisingWinsOverTheFlags() {
        let decision = service.decide(
            Self.replacing(PolicyFixtures.allowingRequest(), policy: .disabled)
        )

        XCTAssertEqual(decision.denialReason, .globallyDisabled)
    }

    func testAPlacementMissingFromThePolicyIsDenied() {
        let policy = AdvertisingPolicy(
            policyVersion: "test-only-ads-v1",
            isEnabled: true,
            mode: .contextualOnly,
            placements: [:],
            refreshAfter: PolicyFixtures.instant
        )

        let decision = service.decide(
            Self.replacing(PolicyFixtures.allowingRequest(), policy: policy)
        )

        XCTAssertEqual(decision.denialReason, .placementNotInPolicy)
    }

    func testAFormatTheBuildDidNotRegisterIsDenied() {
        let policy = AdvertisingPolicy(
            policyVersion: "test-only-ads-v1",
            isEnabled: true,
            mode: .contextualOnly,
            placements: [
                .homeBottomBanner: AdvertisingPolicy.PlacementPolicy(
                    isEnabled: true,
                    format: .interstitial
                )
            ],
            refreshAfter: PolicyFixtures.instant
        )

        let decision = service.decide(
            Self.replacing(PolicyFixtures.allowingRequest(), policy: policy)
        )

        XCTAssertEqual(decision.denialReason, .formatMismatch)
    }

    private static func replacing(
        _ request: AdEligibilityRequest,
        policy: AdvertisingPolicy? = nil,
        approvedPlacements: Set<AdPlacement>? = nil
    ) -> AdEligibilityRequest {
        AdEligibilityRequest(
            placement: request.placement,
            surface: request.surface,
            policy: policy ?? request.policy,
            privacy: request.privacy,
            providerStatus: request.providerStatus,
            interface: request.interface,
            frequency: request.frequency,
            caps: request.caps,
            approvedPlacements: approvedPlacements ?? request.approvedPlacements,
            now: request.now
        )
    }

    func testAProviderThatIsNotReadyIsDenied() {
        for status in [AdProviderStatus.absent, .initializing] {
            let decision = service.decide(
                PolicyFixtures.allowingRequest(providerStatus: status)
            )
            XCTAssertEqual(decision.denialReason, .providerUnavailable, status.rawValue)
        }
    }

    func testTooFewCompletedSessionsIsDenied() {
        let decision = service.decide(
            PolicyFixtures.allowingRequest(
                frequency: AdFrequencyState(completedStudySessions: 1)
            )
        )

        XCTAssertEqual(decision.denialReason, .frequencyCapReached)
    }

    func testASecondPresentationInTheSameAppSessionIsDenied() {
        let decision = service.decide(
            PolicyFixtures.allowingRequest(
                frequency: AdFrequencyState(
                    completedStudySessions: 10,
                    presentationsOfPlacementThisAppSession: 1
                )
            )
        )

        XCTAssertEqual(decision.denialReason, .frequencyCapReached)
    }

    func testTheDailyCapIsEnforced() {
        let decision = service.decide(
            PolicyFixtures.allowingRequest(
                frequency: AdFrequencyState(
                    completedStudySessions: 10,
                    presentationsToday: AdFrequencyCapPolicy.bundled.maximumPresentationsPerDay
                )
            )
        )

        XCTAssertEqual(decision.denialReason, .frequencyCapReached)
    }

    func testAFailureStartsACooldown() {
        let decision = service.decide(
            PolicyFixtures.allowingRequest(
                frequency: AdFrequencyState(
                    completedStudySessions: 10,
                    lastDismissOrFailureAt: PolicyFixtures.instant.addingTimeInterval(-60)
                )
            )
        )

        XCTAssertEqual(decision.denialReason, .frequencyCapReached)
    }

    func testTheCooldownEndsAfterTheConfiguredInterval() {
        let elapsed = AdFrequencyCapPolicy.bundled.cooldownAfterDismissOrFailure + 1

        let decision = service.decide(
            PolicyFixtures.allowingRequest(
                frequency: AdFrequencyState(
                    completedStudySessions: 10,
                    lastDismissOrFailureAt: PolicyFixtures.instant.addingTimeInterval(-elapsed)
                )
            )
        )

        XCTAssertEqual(decision, .allowed)
    }
}
