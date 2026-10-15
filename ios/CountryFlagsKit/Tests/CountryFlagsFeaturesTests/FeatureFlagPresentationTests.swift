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

    /// The version policy is read from the snapshot answering now: the cached
    /// one before the network (so a refused build stays refused offline), and
    /// the fresh one after every refresh (so a relaxed policy lets it in).
    func testTheVersionPolicyIsReadBeforeAndAfterTheNetwork() async {
        let policy = StubVersionPolicy(
            ClientVersionPolicy(minimumSupported: "0.3.0", latest: "0.3.0", updateMode: .forced)
        )
        let center = FeatureFlagCenter(
            flags: StubFeatureFlags(),
            versionPolicy: policy,
            appVersion: "0.2.0"
        )
        XCTAssertEqual(center.updateRequirement, .none, "nothing is read before activation")

        center.evaluateVersionPolicy()
        XCTAssertEqual(center.updateRequirement, .required(minimumSupported: "0.3.0"))

        policy.policy = ClientVersionPolicy(
            minimumSupported: "0.1.0",
            latest: "0.3.0",
            updateMode: .soft
        )
        await center.refresh(
            context: FeatureFlagContext(
                scope: .guest(installationID: UUID()),
                environment: .dev,
                appVersion: "0.2.0",
                locale: "en"
            )
        )
        XCTAssertEqual(center.updateRequirement, .recommended(latest: "0.3.0"))
    }

    /// No policy source asks nothing of the build.
    func testWithoutAPolicyNothingIsAsked() {
        let center = FeatureFlagCenter(flags: StubFeatureFlags())
        center.evaluateVersionPolicy()
        XCTAssertEqual(center.updateRequirement, .none)
    }

    /// Every update string is translated, so a key never reaches the screen.
    func testTheUpdateCopyIsTranslated() {
        for text in [
            L10n.updateRequiredTitle, L10n.updateRequiredMessage, L10n.updateOpenAppStore,
            L10n.updateRecommendedTitle, L10n.updateRecommendedMessage,
            L10n.updateRecommendedUpdate, L10n.updateRecommendedLater,
        ] {
            XCTAssertFalse(text.hasPrefix("update."), text)
        }
    }
}

/// A version policy the test moves between reads.
private final class StubVersionPolicy: ClientVersionPolicyProviding, @unchecked Sendable {
    var policy: ClientVersionPolicy?

    init(_ policy: ClientVersionPolicy?) {
        self.policy = policy
    }

    var clientVersionPolicy: ClientVersionPolicy? { policy }
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
