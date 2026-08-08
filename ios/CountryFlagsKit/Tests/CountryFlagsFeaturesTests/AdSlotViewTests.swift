import SwiftUI
import UIKit
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

@MainActor
final class AdSlotViewTests: XCTestCase {
    /// A placement that is not eligible must not reserve room. A slot that kept
    /// its height would push the content the user came for down the screen for
    /// nothing, and with the shipped no-op provider that is every placement,
    /// on every screen, always.
    func testAnIneligibleSlotAddsNoHeight() {
        let host = UIHostingController(
            rootView: AdSlotView(eligibility: .denied(.globallyDisabled), loadResult: .unavailable)
        )

        let size = host.sizeThatFits(in: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))

        XCTAssertEqual(size.height, 0)
    }

    func testAStackWithAHiddenSlotIsAsTallAsItsContentAlone() {
        let withoutSlot = UIHostingController(
            rootView: VStack(spacing: 0) {
                Color.clear.frame(height: 100)
            }
        )
        let withSlot = UIHostingController(
            rootView: VStack(spacing: 0) {
                Color.clear.frame(height: 100)
                AdSlotView(eligibility: .denied(.providerUnavailable), loadResult: .noFill)
            }
        )
        let bounds = CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude)

        XCTAssertEqual(
            withSlot.sizeThatFits(in: bounds).height,
            withoutSlot.sizeThatFits(in: bounds).height
        )
    }

    func testAFilledSlotTakesTheRoomItsContentNeeds() {
        let host = UIHostingController(
            rootView: AdSlotView(presentation: .filled) {
                Color.clear.frame(width: 320, height: 50)
            }
        )

        let size = host.sizeThatFits(in: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))

        XCTAssertEqual(size.height, 50)
    }

    func testOnlyAnAllowedAndLoadedPlacementIsFilled() {
        XCTAssertEqual(AdSlotPresentation(eligibility: .allowed, loadResult: .ready), .filled)
        XCTAssertEqual(AdSlotPresentation(eligibility: .allowed, loadResult: .noFill), .hidden)
        XCTAssertEqual(AdSlotPresentation(eligibility: .allowed, loadResult: .unavailable), .hidden)
        XCTAssertEqual(
            AdSlotPresentation(eligibility: .allowed, loadResult: .failed(code: "NO_ADAPTER")),
            .hidden
        )
        XCTAssertEqual(
            AdSlotPresentation(eligibility: .denied(.adFreeEntitlement), loadResult: .ready),
            .hidden
        )
    }

    /// The whole shipped configuration, end to end: nothing is eligible and the
    /// no-op provider loads nothing, so no screen reserves space for an ad.
    func testTheShippedConfigurationNeverFillsASlot() async {
        let flags = BundledFeatureFlagProvider()
        let service = AdEligibilityService(flags: flags)
        let provider = NoOpAdvertisingProvider()

        for placement in AdPlacement.allCases {
            for surface in placement.allowedSurfaces {
                let eligibility = service.decide(
                    AdEligibilityRequest(
                        placement: placement,
                        surface: surface,
                        now: Date(timeIntervalSince1970: 1_760_000_000)
                    )
                )
                let loadResult = await provider.load(placement)

                XCTAssertEqual(
                    AdSlotPresentation(eligibility: eligibility, loadResult: loadResult),
                    .hidden,
                    placement.key
                )
            }
        }
    }
}
