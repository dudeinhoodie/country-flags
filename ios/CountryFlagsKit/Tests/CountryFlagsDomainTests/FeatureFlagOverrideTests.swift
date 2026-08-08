import XCTest

@testable import CountryFlagsDomain

final class FeatureFlagOverrideTests: XCTestCase {
    private let arguments = [
        "/path/to/app",
        FeatureFlagOverrides.launchArgument,
        "study.multiple_choice.enabled=true",
        FeatureFlagOverrides.launchArgument,
        "study.max_new_cards_per_session=5",
        FeatureFlagOverrides.launchArgument,
        "home.recommended_decks.variant=personalized",
    ]

    func testParsesOverridesInADebugEnvironment() {
        for environment in [AppEnvironment.mock, .dev] {
            let overrides = FeatureFlagOverrides.fromLaunchArguments(
                arguments,
                environment: environment
            )

            XCTAssertEqual(
                overrides.values[BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue],
                .boolean(true)
            )
            XCTAssertEqual(
                overrides.values[NumberFeatureFlag.studyMaxNewCardsPerSession.rawValue],
                .number(5)
            )
            XCTAssertEqual(
                overrides.values[StringFeatureFlag.homeRecommendedDecksVariant.rawValue],
                .string("personalized")
            )
        }
    }

    /// The App Store build has no override at all. A release binary that could
    /// be talked into one by a launch argument is a release binary whose flags
    /// are not the ones the backend evaluated.
    func testProductionIgnoresOverridesEntirely() {
        let overrides = FeatureFlagOverrides.fromLaunchArguments(
            arguments,
            environment: .prod
        )

        XCTAssertTrue(overrides.values.isEmpty)
    }

    func testRefusesUnknownKeysAndUnusableValues() {
        let overrides = FeatureFlagOverrides.fromLaunchArguments(
            [
                FeatureFlagOverrides.launchArgument, "study.telepathy.enabled=true",
                FeatureFlagOverrides.launchArgument, "study.multiple_choice.enabled=perhaps",
                FeatureFlagOverrides.launchArgument, "home.recommended_decks.variant=chaotic",
                FeatureFlagOverrides.launchArgument, "study.max_new_cards_per_session=500",
                FeatureFlagOverrides.launchArgument, "malformed",
                FeatureFlagOverrides.launchArgument,
            ],
            environment: .dev
        )

        XCTAssertTrue(overrides.values.isEmpty)
    }
}
