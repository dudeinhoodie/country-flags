import Foundation
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

final class AppConfigurationRepositoryTests: XCTestCase {
    private func makeRepository(
        transport: MockClientTransport,
        dates: any DateProviding = TestClock()
    ) -> AppConfigurationRepository {
        AppConfigurationRepository(
            factory: APIClientFactory(
                configuration: APITestClient.configuration,
                transport: transport,
                logger: NoOpAPIRequestLogger(),
                scheduler: RecordingBackoffScheduler(),
                jitter: ZeroJitterProvider()
            ),
            dates: dates
        )
    }

    private func updated(
        _ result: AppConfigurationFetchResult,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> AppConfiguration {
        guard case .updated(let configuration) = result else {
            XCTFail("Expected an updated configuration, got \(result)", file: file, line: line)
            throw APIError.decoding("not an updated configuration")
        }
        return configuration
    }

    func testTheCommittedFixtureIsMappedToDomainValues() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(TestFixtures.appConfigJSON, headerFields: ["etag": "\"config-1\""]),
            for: "getAppConfig"
        )
        let context = FlagFixtures.context()

        let configuration = try updated(
            try await makeRepository(transport: transport).fetch(context: context, entityTag: nil)
        )

        XCTAssertEqual(configuration.snapshot.configVersion, "config-2026-07-28.1")
        XCTAssertEqual(configuration.snapshot.contextKey, context.cacheKey)
        XCTAssertEqual(configuration.snapshot.entityTag, "\"config-1\"")
        XCTAssertEqual(
            configuration.snapshot.flags[BooleanFeatureFlag.studyMultipleChoiceEnabled.key],
            EvaluatedFeatureFlag(
                value: .boolean(false),
                variant: "disabled",
                activationPolicy: .nextSession
            )
        )
        XCTAssertEqual(
            configuration.snapshot.flags[StringFeatureFlag.homeRecommendedDecksVariant.key],
            EvaluatedFeatureFlag(
                value: .string("control"),
                variant: "control",
                activationPolicy: .nextLaunch
            )
        )
    }

    func testTheAdvertisingPolicyOfTheFixtureIsDisabled() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(TestFixtures.appConfigJSON), for: "getAppConfig")

        let configuration = try updated(
            try await makeRepository(transport: transport)
                .fetch(context: FlagFixtures.context(), entityTag: nil)
        )

        XCTAssertEqual(configuration.advertising.policyVersion, "ads-policy-v1")
        XCTAssertFalse(configuration.advertising.isEnabled)
        XCTAssertEqual(configuration.advertising.mode, .disabled)
        XCTAssertEqual(
            configuration.advertising.placements[.homeBottomBanner],
            AdvertisingPolicy.PlacementPolicy(isEnabled: false, format: .banner)
        )
    }

    func testAStoredEntityTagIsSentAsIfNoneMatch() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(TestFixtures.appConfigJSON), for: "getAppConfig")

        _ = try await makeRepository(transport: transport)
            .fetch(context: FlagFixtures.context(), entityTag: "\"etag-7\"")

        // Literally, quotation marks and all: a percent-encoded validator would
        // never match on the server and every revalidation would download a
        // snapshot the device already has.
        let requests = await transport.requests(for: "getAppConfig")
        XCTAssertEqual(requests.first?.header("if-none-match"), "\"etag-7\"")
    }

    func testNoConditionalHeaderIsSentWithoutAStoredEntityTag() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(TestFixtures.appConfigJSON), for: "getAppConfig")

        _ = try await makeRepository(transport: transport)
            .fetch(context: FlagFixtures.context(), entityTag: nil)

        let requests = await transport.requests(for: "getAppConfig")
        XCTAssertNil(requests.first?.header("if-none-match"))
    }

    func testTheContextTravelsInTheQuery() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(TestFixtures.appConfigJSON), for: "getAppConfig")

        _ = try await makeRepository(transport: transport)
            .fetch(context: FlagFixtures.context(), entityTag: nil)

        let requests = await transport.requests(for: "getAppConfig")
        let path = try XCTUnwrap(requests.first?.path)
        XCTAssertTrue(path.contains("platform=ios"))
        XCTAssertTrue(path.contains("appVersion=1.2.3"))
        XCTAssertTrue(path.contains("locale=ru-RU"))
    }

    func testANotModifiedResponseIsReportedAsSuch() async throws {
        let transport = MockClientTransport()
        await transport.always(
            MockClientTransport.Response(statusCode: 304),
            for: "getAppConfig"
        )

        let result = try await makeRepository(transport: transport)
            .fetch(context: FlagFixtures.context(), entityTag: "\"etag-7\"")

        XCTAssertEqual(
            result,
            .notModified(
                revalidatedUntil: FlagFixtures.instant.addingTimeInterval(
                    AppConfigurationRepository.revalidationLifetime
                )
            )
        )
    }

    func testAFailureSurfacesAsADomainError() async {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            for: "getAppConfig"
        )

        do {
            _ = try await makeRepository(transport: transport)
                .fetch(context: FlagFixtures.context(), entityTag: nil)
            XCTFail("The repository should have thrown")
        } catch let error as APIError {
            XCTAssertEqual(error.details?.code, "SERVICE_UNAVAILABLE")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    /// The backend serves several client versions, so an unknown key is normal
    /// and must not be an error. It is dropped, and a key the build does know
    /// in the same payload still arrives.
    func testAnUnknownKeyIsIgnored() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.payload(featureFlags: """
            "study.telepathy.enabled": {
              "type": "boolean",
              "value": true,
              "variant": "enabled",
              "activationPolicy": "immediate"
            },
            "ads.enabled": {
              "type": "boolean",
              "value": false,
              "variant": "disabled",
              "activationPolicy": "immediate"
            }
            """)), for: "getAppConfig")

        let configuration = try updated(
            try await makeRepository(transport: transport)
                .fetch(context: FlagFixtures.context(), entityTag: nil)
        )

        XCTAssertEqual(Set(configuration.snapshot.flags.keys), [BooleanFeatureFlag.adsEnabled.key])
    }

    /// A payload that declares one type and carries another decodes by shape,
    /// so the discriminator has to be compared explicitly.
    func testAFlagWhoseDeclaredTypeContradictsItsValueIsDropped() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.payload(featureFlags: """
            "study.multiple_choice.enabled": {
              "type": "boolean",
              "value": "true",
              "variant": "enabled",
              "activationPolicy": "nextSession"
            }
            """)), for: "getAppConfig")

        let configuration = try updated(
            try await makeRepository(transport: transport)
                .fetch(context: FlagFixtures.context(), entityTag: nil)
        )

        XCTAssertTrue(configuration.snapshot.flags.isEmpty)
    }

    func testAFlagWhoseTypeContradictsTheRegistryIsDropped() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.payload(featureFlags: """
            "study.multiple_choice.enabled": {
              "type": "string",
              "value": "enabled",
              "variant": "enabled",
              "activationPolicy": "nextSession"
            }
            """)), for: "getAppConfig")

        let configuration = try updated(
            try await makeRepository(transport: transport)
                .fetch(context: FlagFixtures.context(), entityTag: nil)
        )

        XCTAssertTrue(configuration.snapshot.flags.isEmpty)
    }

    func testAnUnknownActivationPolicyIsDropped() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.payload(featureFlags: """
            "ads.enabled": {
              "type": "boolean",
              "value": true,
              "variant": "enabled",
              "activationPolicy": "someday"
            }
            """)), for: "getAppConfig")

        let configuration = try updated(
            try await makeRepository(transport: transport)
                .fetch(context: FlagFixtures.context(), entityTag: nil)
        )

        XCTAssertTrue(configuration.snapshot.flags.isEmpty)
    }

    func testAnUnknownPlacementOrFormatIsIgnored() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.payload(advertising: """
            {
              "policyVersion": "ads-policy-v2",
              "enabled": true,
              "mode": "CONTEXTUAL_ONLY",
              "placements": {
                "home.mystery_banner": { "enabled": true, "format": "BANNER" },
                "home.bottom_banner": { "enabled": true, "format": "HOLOGRAM" },
                "catalog.inline_native": { "enabled": true, "format": "NATIVE" }
              },
              "refreshAfter": "2026-07-28T12:15:00Z"
            }
            """)), for: "getAppConfig")

        let configuration = try updated(
            try await makeRepository(transport: transport)
                .fetch(context: FlagFixtures.context(), entityTag: nil)
        )

        XCTAssertEqual(
            Set(configuration.advertising.placements.keys),
            [.catalogInlineNative]
        )
    }

    func testAnUnknownAdvertisingModeDisablesAdvertising() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.payload(advertising: """
            {
              "policyVersion": "ads-policy-v3",
              "enabled": true,
              "mode": "PERSONALIZED",
              "placements": {},
              "refreshAfter": "2026-07-28T12:15:00Z"
            }
            """)), for: "getAppConfig")

        let configuration = try updated(
            try await makeRepository(transport: transport)
                .fetch(context: FlagFixtures.context(), entityTag: nil)
        )

        XCTAssertEqual(configuration.advertising, .disabled)
    }

    /// The same shape as the committed fixture with the two parts under test
    /// substituted, so the rest of the payload stays contract-shaped.
    private static func payload(
        featureFlags: String = "",
        advertising: String = """
            {
              "policyVersion": "ads-policy-v1",
              "enabled": false,
              "mode": "DISABLED",
              "placements": {},
              "refreshAfter": "2026-07-28T12:15:00Z"
            }
            """
    ) -> String {
        """
        {
          "configVersion": "config-2026-07-28.1",
          "generatedAt": "2026-07-28T12:00:00Z",
          "expiresAt": "2026-07-28T12:15:00Z",
          "minimumClientVersions": {
            "ios": { "minimumSupported": "1.0.0", "latest": "1.0.0", "updateMode": "NONE" }
          },
          "contentVersion": "2026.07-draft.1",
          "supportedTemplateSchemaVersions": [1],
          "featureFlags": { \(featureFlags) },
          "advertising": \(advertising)
        }
        """
    }
}
