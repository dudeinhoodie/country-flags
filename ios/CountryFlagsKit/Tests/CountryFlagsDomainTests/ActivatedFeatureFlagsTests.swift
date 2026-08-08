import XCTest

@testable import CountryFlagsDomain

final class ActivatedFeatureFlagsTests: XCTestCase {
    private let dates = FixedDateProvider(instant: Date(timeIntervalSince1970: 1_800_000_000))

    /// A kill switch is worthless if it waits for the next launch.
    func testImmediatePolicyPassesThrough() {
        let live = StubFeatureFlags()
        let flags = ActivatedFeatureFlags(live: live, dates: dates)
        XCTAssertTrue(flags.boolValue(for: .studyReviewSubmissionEnabled))

        live.set(.boolean(false), for: BooleanFeatureFlag.studyReviewSubmissionEnabled)

        XCTAssertFalse(flags.boolValue(for: .studyReviewSubmissionEnabled))
    }

    /// The mode of a running session may not change under the person's hands.
    func testSessionScopedFlagIsFrozenForTheSession() {
        let live = StubFeatureFlags()
        live.set(.boolean(true), for: BooleanFeatureFlag.studyMultipleChoiceEnabled)
        live.set(.number(20), for: NumberFeatureFlag.studyMaxNewCardsPerSession)
        let flags = ActivatedFeatureFlags(live: live, dates: dates)

        let session = flags.beginSession(configVersion: "config-1")
        XCTAssertTrue(flags.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(flags.numberValue(for: .studyMaxNewCardsPerSession), 20)

        // A refresh lands mid-session.
        live.set(.boolean(false), for: BooleanFeatureFlag.studyMultipleChoiceEnabled)
        live.set(.number(5), for: NumberFeatureFlag.studyMaxNewCardsPerSession)

        XCTAssertTrue(flags.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(flags.numberValue(for: .studyMaxNewCardsPerSession), 20)
        XCTAssertEqual(
            session.values[BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue],
            .boolean(true)
        )
        XCTAssertEqual(session.configVersion, "config-1")

        // The next session picks up the new value.
        flags.endSession()
        flags.beginSession()
        XCTAssertFalse(flags.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(flags.numberValue(for: .studyMaxNewCardsPerSession), 5)
    }

    /// A session restored after a relaunch keeps the rules it began under.
    func testResumedSessionKeepsItsStoredValues() {
        let live = StubFeatureFlags()
        let flags = ActivatedFeatureFlags(live: live, dates: dates)

        flags.resumeSession(
            SessionFeatureFlagSnapshot(
                capturedAt: dates.now(),
                configVersion: "config-1",
                values: [
                    BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: .boolean(true)
                ]
            )
        )

        XCTAssertTrue(flags.boolValue(for: .studyMultipleChoiceEnabled))
    }

    /// Navigation is not rebuilt while somebody is using it.
    func testLaunchScopedFlagIsFrozenForTheRun() {
        let live = StubFeatureFlags()
        live.set(.string("personalized"), for: StringFeatureFlag.homeRecommendedDecksVariant)
        let flags = ActivatedFeatureFlags(live: live, dates: dates)
        flags.freezeLaunchValues()

        live.set(.string("control"), for: StringFeatureFlag.homeRecommendedDecksVariant)

        XCTAssertEqual(flags.stringValue(for: .homeRecommendedDecksVariant), "personalized")
    }

    /// Before the run has finished starting there is nothing to be pinned to,
    /// so the live value is the honest answer.
    func testLaunchScopedFlagFollowsLiveValueUntilFrozen() {
        let live = StubFeatureFlags()
        let flags = ActivatedFeatureFlags(live: live, dates: dates)

        live.set(.string("personalized"), for: StringFeatureFlag.homeRecommendedDecksVariant)

        XCTAssertEqual(flags.stringValue(for: .homeRecommendedDecksVariant), "personalized")
    }

    func testRefreshIsForwarded() async {
        let live = StubFeatureFlags()
        let flags = ActivatedFeatureFlags(live: live, dates: dates)
        let context = FeatureFlagContext(
            scope: .guest(installationID: UUID()),
            environment: .dev,
            appVersion: "1.0.0",
            locale: "en"
        )

        await flags.refresh(context: context)

        XCTAssertEqual(live.refreshedContexts.count, 1)
        XCTAssertEqual(live.refreshedContexts.first?.scope, context.scope)
    }
}
