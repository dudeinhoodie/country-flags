import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// The flag client end to end: transport, mapping, cache and evaluation.
final class FeatureFlagClientTests: XCTestCase {
    /// Inside the validity window of the committed app-config fixture, so the
    /// snapshots below are fresh without any date arithmetic in the tests.
    private static let now = Date(timeIntervalSince1970: 1_785_240_300)

    private let dates = FixedDateProvider(instant: FeatureFlagClientTests.now)
    private let guestScope = AccountScope.guest(
        installationID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    )
    private let userScope = AccountScope.authenticated(
        userID: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    )

    // MARK: - Cold launch

    /// A first launch with no network still answers every flag, and it answers
    /// with what the registry declares.
    func testColdLaunchWithoutNetworkUsesBundledDefaults() async {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            for: "getAppConfig"
        )
        let client = makeClient(transport: transport)

        await start(client, scope: guestScope)

        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertTrue(client.boolValue(for: .studyReviewSubmissionEnabled))
        XCTAssertEqual(client.stringValue(for: .homeRecommendedDecksVariant), "control")
        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 10)
        XCTAssertEqual(client.exposure(for: .studyMultipleChoiceEnabled).source, .bundledDefault)
        XCTAssertEqual(client.advertisingPolicy, .off)
    }

    /// The first screen is drawn from the cache, not from the network. Nothing
    /// leaves the device until the app asks for a refresh.
    func testActivationAnswersFromTheCacheWithoutARequest() async {
        let transport = MockClientTransport()
        let cache = InMemoryAppConfigCache()
        cache.store(snapshot(multipleChoiceEnabled: true, for: guestScope))
        let client = makeClient(transport: transport, cache: cache)

        await client.activate(context: context(for: guestScope))

        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
        let requests = await transport.requests(for: "getAppConfig")
        XCTAssertTrue(requests.isEmpty)
    }

    /// A failed refresh is not a failure of the app: the previous run's answers
    /// stand, and the failure is recorded without a payload.
    func testCachedSnapshotSurvivesAFailedRefresh() async {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 500, code: "INTERNAL_ERROR"),
            for: "getAppConfig"
        )
        let cache = InMemoryAppConfigCache()
        cache.store(snapshot(multipleChoiceEnabled: true, for: guestScope))
        let logger = RecordingLogger()
        let client = makeClient(transport: transport, cache: cache, logger: logger)

        await start(client, scope: guestScope)

        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(client.exposure(for: .studyMultipleChoiceEnabled).source, .cachedSnapshot)
        XCTAssertEqual(logger.recorded.count, 1)
        XCTAssertEqual(logger.recorded.first?.category, .featureFlags)
    }

    // MARK: - Remote snapshot

    func testRemoteSnapshotIsAppliedAndCached() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(Self.remoteConfigJSON, headerFields: ["etag": "\"config-remote-1\""]),
            for: "getAppConfig"
        )
        let cache = InMemoryAppConfigCache()
        let client = makeClient(transport: transport, cache: cache)

        await start(client, scope: guestScope)

        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(client.stringValue(for: .homeRecommendedDecksVariant), "personalized")
        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 15)

        let stored = try XCTUnwrap(cache.snapshot(for: guestScope.key))
        XCTAssertEqual(stored.configVersion, "config-remote-1")
        XCTAssertEqual(stored.entityTag, "\"config-remote-1\"")
        XCTAssertEqual(stored.advertising.mode, .contextualOnly)
        XCTAssertEqual(stored.clientVersionPolicy.updateMode, .soft)
    }

    /// The request states who is asking, and replays the tag of what it already
    /// holds so an unchanged configuration costs no body.
    func testRequestCarriesTheContextAndTheEntityTag() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(Self.remoteConfigJSON, headerFields: ["etag": "\"config-remote-1\""]),
            for: "getAppConfig"
        )
        let cache = InMemoryAppConfigCache()
        cache.store(snapshot(multipleChoiceEnabled: false, for: guestScope))
        let client = makeClient(transport: transport, cache: cache)

        await start(client, scope: guestScope)

        let requests = await transport.requests(for: "getAppConfig")
        let request = try XCTUnwrap(requests.first)
        XCTAssertTrue(request.path.contains("platform=ios"))
        XCTAssertTrue(request.path.contains("appVersion=1.2.3"))
        XCTAssertTrue(request.path.contains("locale=ru"))
        XCTAssertEqual(request.header("If-None-Match"), "\"cached-1\"")
    }

    /// A `304` means the cached copy is current, so its lifetime starts again.
    /// Leaving the old expiry in place would throw away a snapshot the backend
    /// had just vouched for.
    func testNotModifiedRenewsTheCachedSnapshot() async throws {
        let transport = MockClientTransport()
        await transport.always(.init(statusCode: 304), for: "getAppConfig")
        let cache = InMemoryAppConfigCache()
        let expiring = snapshot(
            multipleChoiceEnabled: true,
            for: guestScope,
            expiresAt: Self.now.addingTimeInterval(30)
        )
        cache.store(expiring)
        let client = makeClient(transport: transport, cache: cache)

        await start(client, scope: guestScope)

        let renewed = try XCTUnwrap(cache.snapshot(for: guestScope.key))
        XCTAssertGreaterThan(renewed.expiresAt, expiring.expiresAt)
        XCTAssertEqual(renewed.fetchedAt, Self.now)
        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))
    }

    // MARK: - Refused payloads

    /// A key this build does not know, a value of the wrong type and a variant
    /// outside the agreed set are all dropped: the bundled default is a value
    /// the app is known to be able to render.
    func testUnknownAndUnusableValuesAreDropped() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.unusableConfigJSON), for: "getAppConfig")
        let cache = InMemoryAppConfigCache()
        let client = makeClient(transport: transport, cache: cache)

        await start(client, scope: guestScope)

        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(client.stringValue(for: .homeRecommendedDecksVariant), "control")
        XCTAssertEqual(client.numberValue(for: .studyMaxNewCardsPerSession), 10)

        let stored = try XCTUnwrap(cache.snapshot(for: guestScope.key))
        XCTAssertTrue(stored.flags.isEmpty)
        // An unknown advertising mode is not a reason to guess.
        XCTAssertEqual(stored.advertising, .off)
    }

    // MARK: - Account switch

    /// Signing in must not let the previous account's configuration answer for
    /// the new one, not even while the new snapshot is on its way.
    func testAccountSwitchNeverUsesTheOtherSnapshot() async {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            for: "getAppConfig"
        )
        let cache = InMemoryAppConfigCache()
        cache.store(snapshot(multipleChoiceEnabled: true, for: guestScope))
        let client = makeClient(transport: transport, cache: cache)

        await start(client, scope: guestScope)
        XCTAssertTrue(client.boolValue(for: .studyMultipleChoiceEnabled))

        await client.refresh(context: context(for: userScope))

        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
        XCTAssertEqual(client.exposure(for: .studyMultipleChoiceEnabled).source, .bundledDefault)
        // The guest snapshot is still there for the guest; it was not erased,
        // only refused for somebody else.
        XCTAssertNotNil(cache.snapshot(for: guestScope.key))
    }

    /// Each account keeps its own entry, so one device holding two of them
    /// never mixes their values.
    func testCacheKeepsAnEntryPerAccount() {
        let cache = InMemoryAppConfigCache()
        cache.store(snapshot(multipleChoiceEnabled: true, for: guestScope))
        cache.store(snapshot(multipleChoiceEnabled: false, for: userScope))

        XCTAssertEqual(cache.snapshot(for: guestScope.key)?.flags.count, 1)
        XCTAssertEqual(
            cache.snapshot(for: userScope.key)?
                .flags[BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue]?.value,
            .boolean(false)
        )

        cache.removeSnapshot(for: guestScope.key)

        XCTAssertNil(cache.snapshot(for: guestScope.key))
        XCTAssertNotNil(cache.snapshot(for: userScope.key))
    }

    // MARK: - Exposure

    func testExposureCarriesTheVariantAndConfigVersion() async {
        let transport = MockClientTransport()
        await transport.always(
            .json(Self.remoteConfigJSON, headerFields: ["etag": "\"config-remote-1\""]),
            for: "getAppConfig"
        )
        let client = makeClient(transport: transport)

        await start(client, scope: guestScope)
        let exposure = client.exposure(for: .homeRecommendedDecksVariant)

        XCTAssertEqual(exposure.key, StringFeatureFlag.homeRecommendedDecksVariant.rawValue)
        XCTAssertEqual(exposure.value, .string("personalized"))
        XCTAssertEqual(exposure.variant, "personalized")
        XCTAssertEqual(exposure.source, .remoteSnapshot)
        XCTAssertEqual(exposure.configVersion, "config-remote-1")
    }

    // MARK: - Committed fixture

    /// The payload the contract fixtures validate has to map without loss.
    func testCommittedFixtureIsAccepted() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(TestFixtures.appConfigJSON, headerFields: ["etag": "\"fixture-1\""]),
            for: "getAppConfig"
        )
        let cache = InMemoryAppConfigCache()
        let client = makeClient(transport: transport, cache: cache)

        await start(client, scope: guestScope)

        let stored = try XCTUnwrap(cache.snapshot(for: guestScope.key))
        XCTAssertEqual(stored.configVersion, "config-2026-07-28.1")
        XCTAssertEqual(stored.contentVersion, "2026.07-draft.1")
        XCTAssertEqual(stored.supportedTemplateSchemaVersions, [1])
        XCTAssertEqual(stored.flags.count, 2)
        XCTAssertEqual(stored.advertising.enabled, false)
        XCTAssertEqual(stored.advertising.mode, .disabled)
        XCTAssertEqual(
            stored.advertising.policy(for: .homeBottomBanner),
            AdPlacementPolicy(enabled: false, format: .banner)
        )
        XCTAssertFalse(client.boolValue(for: .studyMultipleChoiceEnabled))
    }

    /// A snapshot round-trips through the cache: a launch that restores one
    /// gets back exactly what was stored.
    func testSnapshotSurvivesEncoding() throws {
        let original = snapshot(multipleChoiceEnabled: true, for: guestScope)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AppConfigSnapshot.self, from: data)

        XCTAssertEqual(decoded, original)
    }

    // MARK: - Fixtures

    private func makeClient(
        transport: MockClientTransport,
        cache: any AppConfigSnapshotCaching = InMemoryAppConfigCache(),
        overrides: FeatureFlagOverrides = .none,
        logger: any AppLogging = NoOpLogger()
    ) -> OpenFeatureFlagClient {
        OpenFeatureFlagClient(
            service: AppConfigService(
                clientFactory: APIClientFactory(
                    configuration: APITestClient.configuration,
                    transport: transport,
                    identifiers: SequentialIdentifierProvider(),
                    retryPolicy: RetryPolicy(maximumAttempts: 1),
                    scheduler: RecordingBackoffScheduler(),
                    jitter: ZeroJitterProvider()
                ),
                dates: dates
            ),
            cache: cache,
            overrides: overrides,
            dates: dates,
            logger: logger
        )
    }

    /// What the app does at launch: make the cached snapshot answerable, then
    /// fetch.
    private func start(_ client: OpenFeatureFlagClient, scope: AccountScope) async {
        await client.activate(context: context(for: scope))
        await client.refresh(context: context(for: scope))
    }

    private func context(for scope: AccountScope) -> FeatureFlagContext {
        FeatureFlagContext(
            scope: scope,
            environment: .dev,
            appVersion: "1.2.3",
            locale: "ru"
        )
    }

    private func snapshot(
        multipleChoiceEnabled: Bool,
        for scope: AccountScope,
        expiresAt: Date? = nil
    ) -> AppConfigSnapshot {
        AppConfigSnapshot(
            configVersion: "cached-1",
            generatedAt: Self.now.addingTimeInterval(-60),
            expiresAt: expiresAt ?? Self.now.addingTimeInterval(600),
            fetchedAt: Self.now.addingTimeInterval(-60),
            scopeKey: scope.key,
            entityTag: "\"cached-1\"",
            contentVersion: "content-1",
            supportedTemplateSchemaVersions: [1],
            clientVersionPolicy: ClientVersionPolicy(
                minimumSupported: "1.0.0",
                latest: "1.0.0",
                updateMode: .none
            ),
            flags: [
                BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: EvaluatedFeatureFlag(
                    value: .boolean(multipleChoiceEnabled),
                    variant: multipleChoiceEnabled ? "enabled" : "disabled",
                    activationPolicy: .nextSession
                )
            ],
            advertising: .off,
            origin: .remote
        )
    }

    /// Every flag of the registry, set to something other than its default, so
    /// a value that fails to arrive is visible.
    private static let remoteConfigJSON = """
        {
          "configVersion": "config-remote-1",
          "generatedAt": "2026-07-28T12:00:00.000Z",
          "expiresAt": "2026-07-28T12:15:00.000Z",
          "minimumClientVersions": {
            "ios": { "minimumSupported": "1.0.0", "latest": "1.1.0", "updateMode": "SOFT" }
          },
          "contentVersion": "2026.07-draft.1",
          "supportedTemplateSchemaVersions": [1],
          "featureFlags": {
            "study.multiple_choice.enabled": {
              "type": "boolean", "value": true, "variant": "enabled",
              "activationPolicy": "nextSession"
            },
            "home.recommended_decks.variant": {
              "type": "string", "value": "personalized", "variant": "personalized",
              "activationPolicy": "nextLaunch"
            },
            "study.max_new_cards_per_session": {
              "type": "number", "value": 15, "variant": "large",
              "activationPolicy": "nextSession"
            }
          },
          "advertising": {
            "policyVersion": "ads-policy-v1",
            "enabled": false,
            "mode": "CONTEXTUAL_ONLY",
            "placements": {
              "home.bottom_banner": { "enabled": false, "format": "BANNER" }
            },
            "refreshAfter": "2026-07-28T12:15:00.000Z"
          }
        }
        """

    /// A key this build never registered, a boolean carrying a string, a number
    /// past its bound, a variant nobody agreed to, and an advertising mode from
    /// a future release.
    private static let unusableConfigJSON = """
        {
          "configVersion": "config-unusable-1",
          "generatedAt": "2026-07-28T12:00:00.000Z",
          "expiresAt": "2026-07-28T12:15:00.000Z",
          "minimumClientVersions": {
            "ios": { "minimumSupported": "1.0.0", "latest": "1.0.0", "updateMode": "MANDATORY" }
          },
          "contentVersion": "2026.07-draft.1",
          "supportedTemplateSchemaVersions": [1],
          "featureFlags": {
            "study.telepathy.enabled": {
              "type": "boolean", "value": true, "variant": "enabled",
              "activationPolicy": "immediate"
            },
            "study.multiple_choice.enabled": {
              "type": "string", "value": "true", "variant": "enabled",
              "activationPolicy": "nextSession"
            },
            "study.max_new_cards_per_session": {
              "type": "number", "value": 500, "variant": "huge",
              "activationPolicy": "nextSession"
            },
            "home.recommended_decks.variant": {
              "type": "string", "value": "chaotic", "variant": "chaotic",
              "activationPolicy": "nextLaunch"
            }
          },
          "advertising": {
            "policyVersion": "ads-policy-v2",
            "enabled": true,
            "mode": "PERSONALIZED",
            "placements": {
              "home.bottom_banner": { "enabled": true, "format": "BANNER" }
            },
            "refreshAfter": "2026-07-28T12:15:00.000Z"
          }
        }
        """
}
