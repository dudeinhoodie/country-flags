import XCTest

@testable import CountryFlagsDomain

final class AdvertisingPolicyTests: XCTestCase {
    private let service = AdEligibilityService()

    /// Everything a placement needs, so each test can take exactly one thing
    /// away and see which reason comes back.
    private func eligibleInput(
        placement: AdPlacement = .homeBottomBanner
    ) -> AdEligibilityInput {
        AdEligibilityInput(
            placement: placement,
            globallyEnabled: true,
            placementFlagEnabled: true,
            policy: AdvertisingPolicy(
                policyVersion: "ads-1",
                enabled: true,
                mode: .contextualOnly,
                placements: [
                    placement.rawValue: AdPlacementPolicy(
                        enabled: true,
                        format: placement.format
                    )
                ],
                refreshAfter: Date(timeIntervalSince1970: 1_800_000_900)
            ),
            providerState: .ready,
            privacy: AdvertisingPrivacyState(
                trackingAuthorization: .notDetermined,
                regionalConsent: .notRequired,
                personalizationConsent: .denied
            ),
            entitlement: .absent,
            frequency: AdFrequencyState(
                capReached: false,
                completedSessions: 5,
                minimumCompletedSessions: 3
            ),
            surface: .safe
        )
    }

    func testEveryConditionTogetherIsEligible() {
        XCTAssertEqual(service.evaluate(eligibleInput()), .eligible)
    }

    /// The state the MVP actually ships in: no flags, no policy, no provider.
    func testShippedDefaultsBlockEveryPlacement() {
        for placement in AdPlacement.allCases {
            let input = AdEligibilityInput(
                placement: placement,
                globallyEnabled: BooleanFeatureFlag.adsEnabled.defaultValue,
                placementFlagEnabled: placement.featureFlag.defaultValue,
                policy: nil,
                providerState: .absent,
                privacy: .none,
                entitlement: .unknown,
                frequency: .untouched,
                surface: .safe
            )

            XCTAssertEqual(service.evaluate(input), .blocked(.globallyDisabled))
        }
    }

    func testGlobalSwitchOverridesAnEnabledPlacement() {
        var input = eligibleInput()
        input = AdEligibilityInput(
            placement: input.placement,
            globallyEnabled: false,
            placementFlagEnabled: true,
            policy: input.policy,
            providerState: input.providerState,
            privacy: input.privacy,
            entitlement: input.entitlement,
            frequency: input.frequency,
            surface: input.surface
        )

        XCTAssertEqual(service.evaluate(input), .blocked(.globallyDisabled))
    }

    /// Anything unknown blocks. A missing answer is not a permission.
    func testUnknownInputsBlock() {
        let base = eligibleInput()

        let withoutPolicy = AdEligibilityInput(
            placement: base.placement,
            globallyEnabled: true,
            placementFlagEnabled: true,
            policy: nil,
            providerState: base.providerState,
            privacy: base.privacy,
            entitlement: base.entitlement,
            frequency: base.frequency,
            surface: base.surface
        )
        XCTAssertEqual(service.evaluate(withoutPolicy), .blocked(.policyUnknown))

        let unknownEntitlement = AdEligibilityInput(
            placement: base.placement,
            globallyEnabled: true,
            placementFlagEnabled: true,
            policy: base.policy,
            providerState: base.providerState,
            privacy: base.privacy,
            entitlement: .unknown,
            frequency: base.frequency,
            surface: base.surface
        )
        XCTAssertEqual(service.evaluate(unknownEntitlement), .blocked(.adFreeEntitlement))

        let unknownConsent = AdEligibilityInput(
            placement: base.placement,
            globallyEnabled: true,
            placementFlagEnabled: true,
            policy: base.policy,
            providerState: base.providerState,
            privacy: AdvertisingPrivacyState(),
            entitlement: base.entitlement,
            frequency: base.frequency,
            surface: base.surface
        )
        XCTAssertEqual(service.evaluate(unknownConsent), .blocked(.privacyNotSatisfied))
    }

    /// An entitlement outranks every flag: somebody who paid for no ads does
    /// not get them because a rollout reached their device.
    func testEntitlementOverridesTheFlags() {
        let base = eligibleInput()
        let input = AdEligibilityInput(
            placement: base.placement,
            globallyEnabled: true,
            placementFlagEnabled: true,
            policy: base.policy,
            providerState: base.providerState,
            privacy: base.privacy,
            entitlement: .active,
            frequency: base.frequency,
            surface: base.surface
        )

        XCTAssertEqual(service.evaluate(input), .blocked(.adFreeEntitlement))
    }

    func testForbiddenSurfaceBlocks() {
        let base = eligibleInput()
        let input = AdEligibilityInput(
            placement: base.placement,
            globallyEnabled: true,
            placementFlagEnabled: true,
            policy: base.policy,
            providerState: base.providerState,
            privacy: base.privacy,
            entitlement: base.entitlement,
            frequency: base.frequency,
            surface: .forbidden
        )

        XCTAssertEqual(service.evaluate(input), .blocked(.forbiddenSurface))
    }

    func testFrequencyCapBlocks() {
        let base = eligibleInput()
        let input = AdEligibilityInput(
            placement: base.placement,
            globallyEnabled: true,
            placementFlagEnabled: true,
            policy: base.policy,
            providerState: base.providerState,
            privacy: base.privacy,
            entitlement: base.entitlement,
            frequency: AdFrequencyState(
                capReached: false,
                completedSessions: 1,
                minimumCompletedSessions: 3
            ),
            surface: base.surface
        )

        XCTAssertEqual(service.evaluate(input), .blocked(.frequencyCapReached))
    }

    // MARK: - Layout

    /// A build with no provider leaves no gap where an ad would have been.
    func testBlockedPlacementReservesNothing() {
        for placement in AdPlacement.allCases {
            let slot = AdSlot(
                placement: placement,
                eligibility: .blocked(.providerUnavailable),
                loadedHeight: 250
            )

            XCTAssertFalse(slot.isVisible, placement.rawValue)
            XCTAssertEqual(slot.reservedHeight, 0, placement.rawValue)
        }
    }

    /// Eligible but nothing loaded is still nothing drawn.
    func testEligiblePlacementWithoutContentReservesNothing() {
        let slot = AdSlot(placement: .homeBottomBanner, eligibility: .eligible, loadedHeight: 0)

        XCTAssertFalse(slot.isVisible)
        XCTAssertEqual(slot.reservedHeight, 0)
    }

    // MARK: - Provider

    /// The shipped provider answers without starting anything.
    func testNoOpProviderNeverOffersAnAd() async {
        let provider = NoOpAdvertisingProvider()
        await provider.prepare(
            context: AdvertisingContext(
                scope: .guest(installationID: UUID()),
                policy: .off,
                privacy: .none
            )
        )

        for placement in AdPlacement.allCases {
            let result = await provider.load(placement)
            XCTAssertEqual(result, .unavailable, placement.rawValue)
        }

        await provider.reset()
    }

    /// The registry the client ships has to name the same placements and
    /// formats as the shared one, or a policy entry would never match.
    func testPlacementsMatchTheirFeatureFlags() {
        XCTAssertEqual(
            Set(AdPlacement.allCases.map(\.featureFlag.rawValue)),
            [
                "ads.home.bottom_banner.enabled",
                "ads.catalog.inline_native.enabled",
                "ads.session_result.interstitial.enabled",
                "ads.rewarded.optional_bonus.enabled",
            ]
        )
    }

    /// A policy entry whose format disagrees with the registry is refused: it
    /// describes a unit this build does not know how to place.
    func testFormatMismatchBlocks() {
        let base = eligibleInput()
        let input = AdEligibilityInput(
            placement: .homeBottomBanner,
            globallyEnabled: true,
            placementFlagEnabled: true,
            policy: AdvertisingPolicy(
                policyVersion: "ads-1",
                enabled: true,
                mode: .contextualOnly,
                placements: [
                    AdPlacement.homeBottomBanner.rawValue: AdPlacementPolicy(
                        enabled: true,
                        format: .interstitial
                    )
                ],
                refreshAfter: Date(timeIntervalSince1970: 1_800_000_900)
            ),
            providerState: base.providerState,
            privacy: base.privacy,
            entitlement: base.entitlement,
            frequency: base.frequency,
            surface: base.surface
        )

        XCTAssertEqual(service.evaluate(input), .blocked(.policyDisallows))
    }
}
