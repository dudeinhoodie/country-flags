import Foundation
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// Builds a client and registers its provider.
///
/// Registration is the asynchronous half of the SDK contract. With no backend
/// configured it performs no request at all, which is what an offline cold
/// launch does.
private func makeStartedClient(
    context: FeatureFlagContext,
    cache: any FeatureFlagSnapshotCaching,
    dates: any DateProviding = TestClock(),
    overrides: [String: FeatureFlagValue] = [:]
) async -> FeatureFlagClient {
    let client = FeatureFlagClient(
        context: context,
        cache: cache,
        remote: nil,
        dates: dates,
        overrides: overrides
    )
    await client.refresh(context: context)
    return client
}

/// The resolution order: a fresh snapshot, then the cached snapshot of the same
/// account, then the bundled registry default.
final class FeatureFlagResolutionTests: XCTestCase {
    func testWithoutAnySnapshotEveryValueIsTheBundledDefault() async {
        let client = await makeStartedClient(
            context: FlagFixtures.context(),
            cache: InMemorySnapshotCache()
        )

        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertTrue(client.boolValue(for: .studyReviewSubmissionEnabled))
        XCTAssertEqual(client.stringValue(for: .homeRecommendedDecksVariant), "control")
        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 10)
    }

    /// A cold launch with no network still answers from the configuration the
    /// device already had.
    func testACachedSnapshotAnswersOnAColdLaunchWithoutNetwork() async {
        let context = FlagFixtures.context()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    flags: [
                        BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(
                            true,
                            policy: .nextSession
                        )
                    ]
                )
            ])
        )

        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
    }

    func testAnExpiredSnapshotFallsBackToTheBundledDefault() async {
        let context = FlagFixtures.context()
        let clock = TestClock()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    expiresAt: FlagFixtures.instant.addingTimeInterval(60),
                    flags: [
                        BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(
                            true,
                            policy: .nextSession
                        )
                    ]
                )
            ]),
            dates: clock
        )

        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
        clock.advance(by: 61)
        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
    }

    func testAKeyTheSnapshotDoesNotCarryFallsBackToTheBundledDefault() async {
        let context = FlagFixtures.context()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    flags: [BooleanFeatureFlag.adsEnabled.key: FlagFixtures.boolean(true)]
                )
            ])
        )

        XCTAssertTrue(client.boolValue(for: .adsEnabled))
        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
    }

    func testAValueOfTheWrongTypeFallsBackToTheBundledDefault() async {
        let context = FlagFixtures.context()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    flags: [
                        // A boolean key carrying a string, which is what a
                        // mistake in the control plane looks like on the wire.
                        BooleanFeatureFlag.studyReviewSubmissionEnabled.key: FlagFixtures.string(
                            "yes",
                            policy: .immediate
                        ),
                        NumberFeatureFlag.studyMaxNewCardsPerSession.key: FlagFixtures.boolean(
                            true,
                            policy: .nextSession
                        ),
                    ]
                )
            ])
        )

        XCTAssertTrue(client.boolValue(for: .studyReviewSubmissionEnabled))
        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 10)
    }

    func testAVariantTheBuildCannotRenderFallsBackToTheControlVariant() async {
        let context = FlagFixtures.context()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    flags: [
                        StringFeatureFlag.homeRecommendedDecksVariant.key: FlagFixtures.string(
                            "handwritten"
                        )
                    ]
                )
            ])
        )

        XCTAssertEqual(client.stringValue(for: .homeRecommendedDecksVariant), "control")
    }

    func testANumberOutsideTheRegistryBoundsFallsBackToTheDefault() async {
        let context = FlagFixtures.context()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    flags: [
                        NumberFeatureFlag.studyMaxNewCardsPerSession.key: FlagFixtures.number(999)
                    ]
                )
            ])
        )

        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 10)
    }

    func testAValueInsideTheBoundsIsApplied() async {
        let context = FlagFixtures.context()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    flags: [
                        NumberFeatureFlag.studyMaxNewCardsPerSession.key: FlagFixtures.number(7)
                    ]
                )
            ])
        )

        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 7)
    }
}

final class FeatureFlagRefreshTests: XCTestCase {
    private func configuration(
        context: FeatureFlagContext,
        configVersion: String = "config-2",
        flags: [String: EvaluatedFeatureFlag],
        advertising: AdvertisingPolicy = .disabled
    ) -> AppConfiguration {
        AppConfiguration(
            snapshot: FlagFixtures.snapshot(
                context: context,
                configVersion: configVersion,
                flags: flags
            ),
            advertising: advertising
        )
    }

    func testARefreshAppliesAndCachesTheNewSnapshot() async {
        let context = FlagFixtures.context()
        let cache = InMemorySnapshotCache()
        let client = FeatureFlagClient(
            context: context,
            cache: cache,
            remote: StubConfigurationFetcher([
                .result(
                    .updated(
                        configuration(
                            context: context,
                            flags: [
                                BooleanFeatureFlag.studyReviewSubmissionEnabled.key:
                                    FlagFixtures.boolean(false, variant: "disabled")
                            ]
                        )
                    )
                )
            ]),
            dates: TestClock()
        )

        await client.refresh(context: context)

        // An immediate kill switch takes effect while the app is running.
        XCTAssertFalse(client.boolValue(for: .studyReviewSubmissionEnabled))
        XCTAssertEqual(cache.stored.count, 1)
        XCTAssertEqual(client.currentConfigVersion(), "config-2")
    }

    func testAFailedRefreshKeepsTheValuesTheDeviceAlreadyHas() async {
        let context = FlagFixtures.context()
        let logger = RecordingAppLogger()
        let client = FeatureFlagClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    flags: [
                        BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(
                            true,
                            policy: .nextSession
                        )
                    ]
                )
            ]),
            remote: StubConfigurationFetcher([.failure(.transport("-1009"))]),
            dates: TestClock(),
            logger: logger
        )

        await client.refresh(context: context)

        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(logger.events.map(\.event), ["snapshot.refresh_failed"])
    }

    func testARefreshSendsTheStoredEntityTag() async {
        let context = FlagFixtures.context()
        let remote = StubConfigurationFetcher([
            .result(.notModified(revalidatedUntil: FlagFixtures.instant.addingTimeInterval(900)))
        ])
        let client = FeatureFlagClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(context: context, flags: [:], entityTag: "\"etag-7\"")
            ]),
            remote: remote,
            dates: TestClock()
        )

        await client.refresh(context: context)

        let tags = await remote.observedEntityTags()
        XCTAssertEqual(tags, ["\"etag-7\""])
    }

    func testANotModifiedResponseOnlyExtendsFreshness() async {
        let context = FlagFixtures.context()
        let clock = TestClock()
        let client = FeatureFlagClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    expiresAt: FlagFixtures.instant.addingTimeInterval(60),
                    flags: [
                        BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(
                            true,
                            policy: .nextSession
                        )
                    ]
                )
            ]),
            remote: StubConfigurationFetcher([
                .result(
                    .notModified(revalidatedUntil: FlagFixtures.instant.addingTimeInterval(900))
                )
            ]),
            dates: clock
        )

        await client.refresh(context: context)
        clock.advance(by: 120)

        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(client.currentConfigVersion(), "config-1")
    }

    func testTheAdvertisingPolicyOfARefreshReachesItsReceiver() async {
        let context = FlagFixtures.context()
        let sink = RecordingAdvertisingSink()
        let policy = AdvertisingPolicy(
            policyVersion: "ads-policy-v1",
            isEnabled: false,
            mode: .disabled,
            placements: [
                .homeBottomBanner: AdvertisingPolicy.PlacementPolicy(
                    isEnabled: false,
                    format: .banner
                )
            ],
            refreshAfter: FlagFixtures.instant.addingTimeInterval(900)
        )
        let client = FeatureFlagClient(
            context: context,
            cache: InMemorySnapshotCache(),
            remote: StubConfigurationFetcher([
                .result(.updated(configuration(context: context, flags: [:], advertising: policy)))
            ]),
            advertisingSink: sink,
            dates: TestClock()
        )

        await client.refresh(context: context)

        let applied = await sink.observed()
        XCTAssertEqual(applied, [policy])
    }
}

final class FeatureFlagActivationPolicyTests: XCTestCase {
    /// A session freezes what it started with, so a refresh cannot change its
    /// mode, its card set or its interface halfway through.
    func testAnActiveSessionKeepsTheValuesItStartedWith() async {
        let context = FlagFixtures.context()
        let started = AppConfiguration(
            snapshot: FlagFixtures.snapshot(
                context: context,
                flags: [
                    BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(
                        true,
                        policy: .nextSession
                    ),
                    NumberFeatureFlag.studyMaxNewCardsPerSession.key: FlagFixtures.number(15),
                ]
            ),
            advertising: .disabled
        )
        let changed = AppConfiguration(
            snapshot: FlagFixtures.snapshot(
                context: context,
                configVersion: "config-2",
                flags: [
                    BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(
                        false,
                        variant: "disabled",
                        policy: .nextSession
                    ),
                    NumberFeatureFlag.studyMaxNewCardsPerSession.key: FlagFixtures.number(3),
                ]
            ),
            advertising: .disabled
        )
        let client = FeatureFlagClient(
            context: context,
            cache: InMemorySnapshotCache(),
            remote: StubConfigurationFetcher([.result(.updated(started)), .result(.updated(changed))]),
            dates: TestClock()
        )

        await client.refresh(context: context)
        let session = client.sessionSnapshot()
        await client.refresh(context: context)

        XCTAssertTrue(session.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(session.numberValue(for: .studyMaxNewCardsPerSession), 15)
        // The live values did change; the session simply is not reading them.
        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 3)
    }

    /// A navigation-shaped change waits for the next process, so nothing is
    /// rebuilt under the user's hands.
    func testANextLaunchKeyKeepsTheValueTheProcessStartedWith() async {
        let context = FlagFixtures.context()
        let cache = InMemorySnapshotCache([
            FlagFixtures.snapshot(
                context: context,
                flags: [
                    StringFeatureFlag.homeRecommendedDecksVariant.key: FlagFixtures.string(
                        "control"
                    )
                ]
            )
        ])
        let client = FeatureFlagClient(
            context: context,
            cache: cache,
            remote: StubConfigurationFetcher([
                .result(
                    .updated(
                        AppConfiguration(
                            snapshot: FlagFixtures.snapshot(
                                context: context,
                                configVersion: "config-2",
                                flags: [
                                    StringFeatureFlag.homeRecommendedDecksVariant.key:
                                        FlagFixtures.string("personalized")
                                ]
                            ),
                            advertising: .disabled
                        )
                    )
                )
            ]),
            dates: TestClock()
        )

        await client.refresh(context: context)

        XCTAssertEqual(client.stringValue(for: .homeRecommendedDecksVariant), "control")

        // The next launch reads the same cache and now sees the new value.
        let relaunched = await makeStartedClient(context: context, cache: cache)
        XCTAssertEqual(relaunched.stringValue(for: .homeRecommendedDecksVariant), "personalized")
    }

    func testAnImmediateKeyChangesWhileTheAppIsRunning() async {
        let context = FlagFixtures.context()
        let client = FeatureFlagClient(
            context: context,
            cache: InMemorySnapshotCache(),
            remote: StubConfigurationFetcher([
                .result(
                    .updated(
                        AppConfiguration(
                            snapshot: FlagFixtures.snapshot(
                                context: context,
                                flags: [
                                    BooleanFeatureFlag.studyReviewSubmissionEnabled.key:
                                        FlagFixtures.boolean(false, variant: "disabled")
                                ]
                            ),
                            advertising: .disabled
                        )
                    )
                )
            ]),
            dates: TestClock()
        )

        XCTAssertTrue(client.boolValue(for: .studyReviewSubmissionEnabled))
        await client.refresh(context: context)
        XCTAssertFalse(client.boolValue(for: .studyReviewSubmissionEnabled))
    }

    func testTheSessionSnapshotCarriesOnlySessionScopedKeys() async {
        let context = FlagFixtures.context()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(context: context, flags: [:])
            ])
        )

        let snapshot = client.sessionSnapshot()

        XCTAssertEqual(snapshot.configVersion, "config-1")
        XCTAssertEqual(
            Set(snapshot.values.keys),
            Set(
                FeatureFlagRegistry.definitions
                    .filter { $0.activationPolicy == .nextSession }
                    .map(\.key)
            )
        )
    }
}

final class FeatureFlagAccountSwitchTests: XCTestCase {
    /// Signing in must not keep answering with the guest's configuration, and a
    /// refresh that fails must not leave it in place either.
    func testSwitchingAccountsDropsThePreviousSnapshot() async {
        let guest = FlagFixtures.context(scope: FlagFixtures.guestScope)
        let user = FlagFixtures.context(scope: FlagFixtures.userScope)
        let client = FeatureFlagClient(
            context: guest,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: guest,
                    flags: [
                        BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(
                            true,
                            policy: .nextSession
                        ),
                        StringFeatureFlag.homeRecommendedDecksVariant.key: FlagFixtures.string(
                            "personalized"
                        ),
                    ]
                )
            ]),
            remote: StubConfigurationFetcher([.failure(.transport("-1009"))]),
            dates: TestClock()
        )

        await client.refresh(context: guest)
        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(client.stringValue(for: .homeRecommendedDecksVariant), "personalized")

        await client.refresh(context: user)

        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
        // Not even a launch-frozen key survives the switch.
        XCTAssertEqual(client.stringValue(for: .homeRecommendedDecksVariant), "control")
    }

    func testSwitchingAccountsLoadsTheNewAccountsOwnCache() async {
        let guest = FlagFixtures.context(scope: FlagFixtures.guestScope)
        let user = FlagFixtures.context(scope: FlagFixtures.userScope)
        let client = FeatureFlagClient(
            context: guest,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: guest,
                    flags: [
                        NumberFeatureFlag.studyMaxNewCardsPerSession.key: FlagFixtures.number(5)
                    ]
                ),
                FlagFixtures.snapshot(
                    context: user,
                    configVersion: "config-user",
                    flags: [
                        NumberFeatureFlag.studyMaxNewCardsPerSession.key: FlagFixtures.number(20)
                    ]
                ),
            ]),
            remote: StubConfigurationFetcher([.failure(.transport("-1009"))]),
            dates: TestClock()
        )

        await client.refresh(context: guest)
        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 5)

        await client.refresh(context: user)

        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 20)
    }

    func testSwitchingAccountsAsksTheBackendForTheNewContext() async {
        let guest = FlagFixtures.context(scope: FlagFixtures.guestScope)
        let user = FlagFixtures.context(scope: FlagFixtures.userScope)
        let remote = StubConfigurationFetcher([.failure(.transport("-1009"))])
        let client = FeatureFlagClient(
            context: guest,
            cache: InMemorySnapshotCache(),
            remote: remote,
            dates: TestClock()
        )

        await client.refresh(context: user)

        let keys = await remote.observedContextKeys()
        XCTAssertEqual(keys, [user.cacheKey])
        XCTAssertNotEqual(user.cacheKey, guest.cacheKey)
    }

    func testSwitchingAccountsDisablesAdvertisingUntilTheNewPolicyArrives() async {
        let guest = FlagFixtures.context(scope: FlagFixtures.guestScope)
        let user = FlagFixtures.context(scope: FlagFixtures.userScope)
        let sink = RecordingAdvertisingSink()
        let client = FeatureFlagClient(
            context: guest,
            cache: InMemorySnapshotCache(),
            remote: StubConfigurationFetcher([.failure(.transport("-1009"))]),
            advertisingSink: sink,
            dates: TestClock()
        )

        await client.refresh(context: guest)
        await client.refresh(context: user)

        let applied = await sink.observed()
        XCTAssertEqual(applied, [.disabled])
    }
}

final class FeatureFlagOverrideTests: XCTestCase {
    func testAnOverrideWinsOverTheSnapshot() async {
        let context = FlagFixtures.context()
        let client = await makeStartedClient(
            context: context,
            cache: InMemorySnapshotCache([
                FlagFixtures.snapshot(
                    context: context,
                    flags: [
                        BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(
                            false,
                            variant: "disabled",
                            policy: .nextSession
                        )
                    ]
                )
            ]),
            overrides: [BooleanFeatureFlag.studyMultipleChoiceEnabled.key: .boolean(true)]
        )

        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
    }

    func testAnOverrideOfTheWrongTypeIsIgnored() async {
        let client = await makeStartedClient(
            context: FlagFixtures.context(),
            cache: InMemorySnapshotCache(),
            overrides: [BooleanFeatureFlag.studyMultipleChoiceEnabled.key: .string("true")]
        )

        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
    }
}

final class FeatureFlagOverrideParserTests: XCTestCase {
    func testAnOverrideOfEachTypeIsParsed() {
        let overrides = FeatureFlagOverrideParser.overrides(
            from: [
                "-application", "-feature-flag", "study.multiple_choice.enabled=true",
                "-feature-flag", "home.recommended_decks.variant=personalized",
                "-feature-flag", "study.max_new_cards_per_session=5",
            ]
        )

        XCTAssertEqual(
            overrides,
            [
                "study.multiple_choice.enabled": .boolean(true),
                "home.recommended_decks.variant": .string("personalized"),
                "study.max_new_cards_per_session": .number(5),
            ]
        )
    }

    func testNoArgumentsMeanNoOverrides() {
        XCTAssertTrue(FeatureFlagOverrideParser.overrides(from: ["-reset-store"]).isEmpty)
    }

    func testAnUnknownKeyIsRejected() {
        let overrides = FeatureFlagOverrideParser.overrides(
            from: ["-feature-flag", "study.telepathy.enabled=true"]
        )

        XCTAssertTrue(overrides.isEmpty)
    }

    func testAValueOutsideTheRegistryBoundsIsRejected() {
        let overrides = FeatureFlagOverrideParser.overrides(
            from: [
                "-feature-flag", "study.max_new_cards_per_session=999",
                "-feature-flag", "home.recommended_decks.variant=handwritten",
                "-feature-flag", "study.multiple_choice.enabled=yes",
            ]
        )

        XCTAssertTrue(overrides.isEmpty)
    }

    func testAMalformedArgumentIsIgnored() {
        let overrides = FeatureFlagOverrideParser.overrides(
            from: ["-feature-flag", "study.multiple_choice.enabled", "-feature-flag"]
        )

        XCTAssertTrue(overrides.isEmpty)
    }
}

final class UserDefaultsSnapshotCacheTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "country-flags-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testASnapshotSurvivesAWriteAndARead() throws {
        let cache = UserDefaultsFeatureFlagSnapshotCache(defaults: defaults)
        let context = FlagFixtures.context()
        let snapshot = FlagFixtures.snapshot(
            context: context,
            flags: [
                BooleanFeatureFlag.studyMultipleChoiceEnabled.key: FlagFixtures.boolean(true)
            ]
        )

        cache.store(snapshot)

        XCTAssertEqual(cache.snapshot(forContextKey: context.cacheKey), snapshot)
    }

    /// A guest and an account share a device; they must not share a snapshot.
    func testOneAccountCannotReadAnothersSnapshot() {
        let cache = UserDefaultsFeatureFlagSnapshotCache(defaults: defaults)
        let guest = FlagFixtures.context(scope: FlagFixtures.guestScope)
        let user = FlagFixtures.context(scope: FlagFixtures.userScope)

        cache.store(FlagFixtures.snapshot(context: guest, flags: [:]))

        XCTAssertNotNil(cache.snapshot(forContextKey: guest.cacheKey))
        XCTAssertNil(cache.snapshot(forContextKey: user.cacheKey))
    }

    func testAnUndecodableEntryIsDiscardedRatherThanCrashing() {
        let cache = UserDefaultsFeatureFlagSnapshotCache(defaults: defaults)
        let context = FlagFixtures.context()
        defaults.set(
            Data("not a snapshot".utf8),
            forKey: "featureFlags.snapshot." + context.cacheKey
        )

        XCTAssertNil(cache.snapshot(forContextKey: context.cacheKey))
        XCTAssertNil(defaults.data(forKey: "featureFlags.snapshot." + context.cacheKey))
    }

    func testRemovingASnapshotLeavesTheOthers() {
        let cache = UserDefaultsFeatureFlagSnapshotCache(defaults: defaults)
        let guest = FlagFixtures.context(scope: FlagFixtures.guestScope)
        let user = FlagFixtures.context(scope: FlagFixtures.userScope)
        cache.store(FlagFixtures.snapshot(context: guest, flags: [:]))
        cache.store(FlagFixtures.snapshot(context: user, flags: [:]))

        cache.removeSnapshot(forContextKey: guest.cacheKey)

        XCTAssertNil(cache.snapshot(forContextKey: guest.cacheKey))
        XCTAssertNotNil(cache.snapshot(forContextKey: user.cacheKey))
    }

    /// The cache is allowed in `UserDefaults` only because a snapshot holds no
    /// secret. The stored bytes are checked for one.
    func testTheStoredPayloadCarriesNoIdentifierOrSecret() throws {
        let cache = UserDefaultsFeatureFlagSnapshotCache(defaults: defaults)
        let context = FlagFixtures.context(scope: FlagFixtures.userScope)
        cache.store(
            FlagFixtures.snapshot(
                context: context,
                flags: [BooleanFeatureFlag.adsEnabled.key: FlagFixtures.boolean(false)]
            )
        )

        let data = try XCTUnwrap(
            defaults.data(forKey: "featureFlags.snapshot." + context.cacheKey)
        )
        let text = String(decoding: data, as: UTF8.self)

        XCTAssertFalse(text.contains("80000000-0000-4000-8000-000000000001"))
        XCTAssertFalse(text.localizedCaseInsensitiveContains("token"))
        XCTAssertFalse(text.localizedCaseInsensitiveContains("@"))
    }
}
