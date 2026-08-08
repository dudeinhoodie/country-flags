import Foundation
import XCTest

import CountryFlagsDomain

@MainActor
private final class TestPresentationHost: AdPresentationHost {
    let surface: AdSurface

    init(surface: AdSurface) {
        self.surface = surface
    }
}

final class NoOpAdvertisingProviderTests: XCTestCase {
    func testNothingEverLoads() async {
        let provider = NoOpAdvertisingProvider()

        for placement in AdPlacement.allCases {
            let result = await provider.load(placement)
            XCTAssertEqual(result, .unavailable, placement.key)
        }
    }

    @MainActor
    func testNothingIsEverPresented() async {
        let provider = NoOpAdvertisingProvider()
        let host = TestPresentationHost(surface: .home)

        let result = await provider.present(.homeBottomBanner, from: host)

        XCTAssertEqual(result, .notPresented)
    }

    /// Preparing must not become a way to start an SDK before eligibility has
    /// been decided. There is nothing to start, and this records that.
    func testPreparingAndResettingAreSafeToCallRepeatedly() async {
        let provider = NoOpAdvertisingProvider()
        let context = AdvertisingContext(
            policyVersion: "test-only-ads-v1",
            mode: .disabled,
            locale: "ru-RU",
            isChildDirectedTreatment: true
        )

        for _ in 0..<3 {
            await provider.prepare(context: context)
            await provider.reset()
        }

        let result = await provider.load(.homeBottomBanner)
        XCTAssertEqual(result, .unavailable)
    }

    /// The context an adapter would receive carries no account, no device and no
    /// advertising identifier. The assertion is on the type, because the
    /// guarantee is structural rather than a value that happens to be absent.
    func testTheProviderContextCarriesNoIdentity() {
        let mirror = Mirror(
            reflecting: AdvertisingContext(
                policyVersion: "test-only-ads-v1",
                mode: .disabled,
                locale: "ru-RU",
                isChildDirectedTreatment: true
            )
        )

        XCTAssertEqual(
            Set(mirror.children.compactMap(\.label)),
            ["policyVersion", "mode", "locale", "isChildDirectedTreatment"]
        )
    }
}

/// The MVP ships without an advertising SDK, an advertising identifier and an
/// App Tracking Transparency prompt. A linked framework would publish its
/// classes into the runtime, so their absence is checkable.
final class NoTrackingFrameworkTests: XCTestCase {
    func testAppTrackingTransparencyIsNotLinked() {
        XCTAssertNil(NSClassFromString("ATTrackingManager"))
    }

    func testTheAdvertisingIdentifierFrameworkIsNotLinked() {
        XCTAssertNil(NSClassFromString("ASIdentifierManager"))
    }

    func testNoGoogleMobileAdsSdkIsLinked() {
        XCTAssertNil(NSClassFromString("GADMobileAds"))
    }
}

final class AdvertisingPolicyStoreTests: XCTestCase {
    func testThePolicyStartsDisabled() async {
        let store = AdvertisingPolicyStore()

        let policy = await store.current()

        XCTAssertFalse(policy.isEnabled)
        XCTAssertEqual(policy.mode, .disabled)
        XCTAssertTrue(policy.placements.isEmpty)
    }

    func testApplyingAPolicyReplacesTheCurrentOne() async {
        let store = AdvertisingPolicyStore()

        await store.apply(PolicyFixtures.permissivePolicy())
        let applied = await store.current()
        await store.apply(.disabled)
        let cleared = await store.current()

        XCTAssertTrue(applied.isEnabled)
        XCTAssertFalse(cleared.isEnabled)
    }
}
