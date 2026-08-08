import Foundation
import XCTest

import CountryFlagsDomain

final class FeatureFlagContextTests: XCTestCase {
    func testTheTargetingKeyIsStableForTheSameScope() {
        XCTAssertEqual(
            PolicyFixtures.context(scope: PolicyFixtures.guestScope).targetingKey,
            PolicyFixtures.context(scope: PolicyFixtures.guestScope, locale: "en-US").targetingKey
        )
    }

    func testDifferentScopesGetDifferentTargetingKeys() {
        XCTAssertNotEqual(
            PolicyFixtures.context(scope: PolicyFixtures.guestScope).targetingKey,
            PolicyFixtures.context(scope: PolicyFixtures.userScope).targetingKey
        )
    }

    /// A percentage rollout needs a stable key, but the key must not be a way
    /// to read the account identifier back off the wire.
    func testTheTargetingKeyDoesNotContainTheScopeIdentifier() {
        let context = PolicyFixtures.context(scope: PolicyFixtures.userScope)
        let userID = "80000000-0000-4000-8000-000000000001"

        XCTAssertFalse(context.targetingKey.localizedCaseInsensitiveContains(userID))
        XCTAssertFalse(context.targetingKey.contains("user:"))
        XCTAssertEqual(context.targetingKey.count, 64)
    }

    func testOnlyAllowlistedAttributesAreExposed() {
        let context = PolicyFixtures.context()

        XCTAssertEqual(
            Set(context.attributes.keys),
            ["environment", "platform", "appVersion", "build", "locale", "authenticated"]
        )
        XCTAssertEqual(context.attributes["platform"], "ios")
        XCTAssertEqual(context.attributes["authenticated"], "false")
    }

    func testAnAuthenticatedContextSaysSo() {
        let context = PolicyFixtures.context(scope: PolicyFixtures.userScope)

        XCTAssertTrue(context.isAuthenticated)
        XCTAssertEqual(context.attributes["authenticated"], "true")
    }

    func testTheCacheKeyIsTheTargetingKey() {
        let context = PolicyFixtures.context()

        XCTAssertEqual(context.cacheKey, context.targetingKey)
    }
}

final class FeatureFlagSnapshotTests: XCTestCase {
    private func snapshot(
        expiresAt: Date,
        contextKey: String = "context-a"
    ) -> FeatureFlagSnapshot {
        FeatureFlagSnapshot(
            configVersion: "v1",
            contextKey: contextKey,
            fetchedAt: PolicyFixtures.instant,
            expiresAt: expiresAt,
            flags: [:]
        )
    }

    func testFreshnessFollowsTheExpiryTimestamp() {
        let value = snapshot(expiresAt: PolicyFixtures.instant.addingTimeInterval(60))

        XCTAssertTrue(value.isFresh(at: PolicyFixtures.instant))
        XCTAssertFalse(value.isFresh(at: PolicyFixtures.instant.addingTimeInterval(60)))
    }

    func testASnapshotBelongsOnlyToItsOwnContext() {
        let context = PolicyFixtures.context()
        let mine = snapshot(
            expiresAt: PolicyFixtures.instant,
            contextKey: context.cacheKey
        )

        XCTAssertTrue(mine.belongs(to: context))
        XCTAssertFalse(
            mine.belongs(to: PolicyFixtures.context(scope: PolicyFixtures.userScope))
        )
    }

    func testRevalidationMovesOnlyTheFreshnessWindow() {
        let original = FeatureFlagSnapshot(
            configVersion: "v1",
            contextKey: "context-a",
            fetchedAt: PolicyFixtures.instant,
            expiresAt: PolicyFixtures.instant.addingTimeInterval(60),
            flags: [
                BooleanFeatureFlag.studyMultipleChoiceEnabled.key: EvaluatedFeatureFlag(
                    value: .boolean(true),
                    variant: "enabled",
                    activationPolicy: .nextSession
                )
            ],
            entityTag: "\"etag-1\""
        )

        let revalidated = original.revalidated(
            at: PolicyFixtures.instant.addingTimeInterval(60),
            expiresAt: PolicyFixtures.instant.addingTimeInterval(960)
        )

        XCTAssertEqual(revalidated.flags, original.flags)
        XCTAssertEqual(revalidated.configVersion, original.configVersion)
        XCTAssertEqual(revalidated.entityTag, original.entityTag)
        XCTAssertEqual(
            revalidated.expiresAt,
            PolicyFixtures.instant.addingTimeInterval(960)
        )
    }

    func testASnapshotSurvivesEncodingRoundTrip() throws {
        let original = FeatureFlagSnapshot(
            configVersion: "v1",
            contextKey: "context-a",
            fetchedAt: PolicyFixtures.instant,
            expiresAt: PolicyFixtures.instant.addingTimeInterval(900),
            flags: [
                StringFeatureFlag.homeRecommendedDecksVariant.key: EvaluatedFeatureFlag(
                    value: .string("personalized"),
                    variant: "personalized",
                    activationPolicy: .nextLaunch
                ),
                NumberFeatureFlag.studyMaxNewCardsPerSession.key: EvaluatedFeatureFlag(
                    value: .number(7),
                    variant: "seven",
                    activationPolicy: .nextSession
                ),
            ],
            entityTag: "\"etag-1\""
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(FeatureFlagSnapshot.self, from: data)

        XCTAssertEqual(decoded, original)
    }
}
