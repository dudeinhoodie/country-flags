import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

@MainActor
final class FeatureFlagCenterTests: XCTestCase {
    /// A view reads through the center, so a completed refresh is something
    /// SwiftUI can observe.
    func testRefreshPublishesANewRevision() async {
        let flags = StubFeatureFlags()
        let center = FeatureFlagCenter(flags: flags)
        let context = FeatureFlagContext(
            scope: .guest(installationID: UUID()),
            environment: .dev,
            appVersion: "1.0.0",
            locale: "en"
        )

        XCTAssertEqual(center.revision, 0)
        XCTAssertNil(center.context)
        XCTAssertFalse(center.isEnabled(.studyMultipleChoiceEnabled))

        flags.set(.boolean(true), for: BooleanFeatureFlag.studyMultipleChoiceEnabled)
        await center.refresh(context: context)

        XCTAssertEqual(center.revision, 1)
        XCTAssertEqual(center.context?.scope, context.scope)
        XCTAssertTrue(center.isEnabled(.studyMultipleChoiceEnabled))
        XCTAssertEqual(center.variant(of: .homeRecommendedDecksVariant), "control")
        XCTAssertEqual(center.number(of: .studyMaxNewCardsPerSession), 10)
    }
}

final class ErrorPresentationTests: XCTestCase {
    /// Every kind has copy of its own. A missing entry would show the lookup
    /// key on screen, which is worse than any of these sentences.
    func testEveryErrorKindHasTranslatedCopy() {
        for kind in PresentableError.Kind.allCases {
            let message = L10n.errorMessage(for: kind)

            XCTAssertNotEqual(message, "error.\(kind.rawValue)", kind.rawValue)
            XCTAssertFalse(message.isEmpty, kind.rawValue)
        }
    }

    /// The identifier a person reads out to support is shown, and it is the one
    /// the request carried.
    func testSupportReferenceCarriesTheRequestIdentifier() {
        let error = PresentableError(
            kind: .server,
            code: "INTERNAL_ERROR",
            supportRequestID: "3f1c0f4e-6d2b-4a5e-9b13-000000000001"
        )

        let reference = L10n.errorSupportReference(error.supportRequestID ?? "")

        XCTAssertTrue(reference.contains("3f1c0f4e-6d2b-4a5e-9b13-000000000001"))
        XCTAssertFalse(reference.contains("%@"))
    }

    func testAdvertisementLabelIsTranslated() {
        XCTAssertNotEqual(L10n.advertisementLabel, "ads.slot.label")
    }
}

final class AdSlotViewTests: XCTestCase {
    /// A hidden slot is not a slot with zero height that a query can still
    /// find: nothing is built at all.
    func testHiddenSlotReservesNothing() {
        let slot = AdSlot.hidden(.homeBottomBanner)

        XCTAssertFalse(slot.isVisible)
        XCTAssertEqual(slot.reservedHeight, 0)
        XCTAssertEqual(
            AccessibilityIdentifier.adSlot(.homeBottomBanner),
            "ads.slot.home.bottom_banner"
        )
    }
}

/// A flag source the presentation tests drive directly.
private final class StubFeatureFlags: FeatureFlagProviding, @unchecked Sendable {
    private var values: [String: FeatureFlagValue] = [:]

    func set(_ value: FeatureFlagValue, for key: some FeatureFlagKey) {
        values[key.rawValue] = value
    }

    func boolValue(for key: BooleanFeatureFlag) -> Bool {
        guard case .boolean(let value) = values[key.rawValue] else { return key.defaultValue }
        return value
    }

    func stringValue(for key: StringFeatureFlag) -> String {
        guard case .string(let value) = values[key.rawValue] else { return key.defaultValue }
        return value
    }

    func numberValue(for key: NumberFeatureFlag) -> Double {
        guard case .number(let value) = values[key.rawValue] else { return key.defaultValue }
        return value
    }

    func refresh(context: FeatureFlagContext) async {}
}
