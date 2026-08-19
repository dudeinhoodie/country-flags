import XCTest

@testable import CountryFlagsDomain

final class LogRedactionTests: XCTestCase {
    /// Everything on this list has a way of ending up in a message assembled
    /// from an error, a URL or a decoded body.
    ///
    /// The values are shaped like the real thing but deliberately carry no
    /// entropy: the redaction patterns match on shape, and a fixture that looked
    /// statistically like a key would be reported by the repository secret scan
    /// — of the very test that exists to remove keys.
    func testRemovesSecretsAndPersonalDataFromAMessage() {
        let samples = [
            "Authorization: Bearer aaaa-bbbb-cccc-dddd",
            "token=aaaa-bbbb-cccc refresh_token=eeee-ffff-gggg",
            "id_token=hhhh-iiii-jjjj",
            "The response carried eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIwMDEifQ.c2lnbmF0dXJl",
            "Signed in as person@example.com",
            "GET /v1/app-config?platform=ios&locale=ru failed",
            "password: hunter2",
        ]

        for sample in samples {
            let redacted = LogRedaction.redact(sample)
            XCTAssertTrue(redacted.contains(LogRedaction.mask), sample)
            for secret in [
                "aaaa-bbbb-cccc-dddd", "aaaa-bbbb-cccc", "eeee-ffff-gggg",
                "hhhh-iiii-jjjj", "eyJhbGciOiJSUzI1NiJ9", "person@example.com",
                "platform=ios", "hunter2",
            ] where sample.contains(secret) {
                XCTAssertFalse(redacted.contains(secret), "\(secret) survived in: \(redacted)")
            }
        }
    }

    /// A sensitive value never reaches the output, whatever the sink does with
    /// it afterwards.
    func testSensitiveMetadataIsMasked() {
        let line = LogRedaction.render(
            LogEntry(
                level: .error,
                category: .auth,
                message: "Sign-in failed",
                metadata: [
                    "code": .safe("UNAUTHORIZED"),
                    "refreshToken": .sensitive("kkkk-llll-mmmm"),
                    "attempts": .count(2),
                ]
            )
        )

        XCTAssertTrue(line.contains("code=UNAUTHORIZED"))
        XCTAssertTrue(line.contains("refreshToken=\(LogRedaction.mask)"))
        XCTAssertTrue(line.contains("attempts=2"))
        XCTAssertFalse(line.contains("kkkk-llll-mmmm"))
    }

    /// A value declared safe is still scrubbed: the call site can be wrong.
    func testSafeMetadataIsStillScrubbed() {
        let line = LogRedaction.render(
            LogEntry(
                level: .info,
                category: .network,
                message: "Request finished",
                metadata: ["path": .safe("/v1/decks?cursor=abc")]
            )
        )

        XCTAssertFalse(line.contains("cursor=abc"))
    }

    /// An ordinary sentence is left readable.
    func testOrdinaryMessagesSurvive() {
        let line = LogRedaction.render(
            LogEntry(level: .info, category: .sync, message: "Sync finished")
        )

        XCTAssertEqual(line, "[sync] Sync finished")
    }
}

final class FeatureExposureRecorderTests: XCTestCase {
    private let dates = FixedDateProvider(instant: Date(timeIntervalSince1970: 1_800_000_000))

    private func resolution(
        variant: String = "enabled",
        configVersion: String? = "config-1"
    ) -> FeatureFlagResolution {
        FeatureFlagResolution(
            key: BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue,
            value: .boolean(true),
            variant: variant,
            source: .remoteSnapshot,
            activationPolicy: .nextSession,
            configVersion: configVersion
        )
    }

    /// A screen reads a flag on every render. Only the first use is an
    /// exposure; counting the rest would drown the measurement.
    func testRepeatedUseReportsOnce() async {
        let analytics = RecordingAnalyticsTracker()
        let recorder = FeatureExposureRecorder(analytics: analytics, dates: dates)

        let first = await recorder.recordExposure(of: resolution(), surface: "deck_details")
        let second = await recorder.recordExposure(of: resolution(), surface: "deck_details")
        let third = await recorder.recordExposure(of: resolution(), surface: "deck_details")

        XCTAssertTrue(first)
        XCTAssertFalse(second)
        XCTAssertFalse(third)
        XCTAssertEqual(analytics.events.count, 1)

        let event = try? XCTUnwrap(analytics.events.first)
        XCTAssertEqual(event?.name, .featureExposed)
        XCTAssertEqual(
            event?.properties["flagKey"],
            .string(BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue)
        )
        XCTAssertEqual(event?.properties["variant"], .string("enabled"))
        XCTAssertEqual(event?.properties["surface"], .string("deck_details"))
    }

    /// A new assignment is a new exposure: an experiment whose variant changed
    /// has to be measurable from the moment it did.
    func testANewVariantIsReportedAgain() async {
        let analytics = RecordingAnalyticsTracker()
        let recorder = FeatureExposureRecorder(analytics: analytics, dates: dates)

        await recorder.recordExposure(of: resolution(variant: "enabled"), surface: "deck_details")
        await recorder.recordExposure(of: resolution(variant: "disabled"), surface: "deck_details")
        await recorder.recordExposure(
            of: resolution(configVersion: "config-2"),
            surface: "deck_details"
        )

        XCTAssertEqual(analytics.events.count, 3)
    }

    /// The event carries an opaque key and a variant, and nothing that
    /// identifies a person.
    func testEventCarriesNoIdentity() async {
        let analytics = RecordingAnalyticsTracker()
        let recorder = FeatureExposureRecorder(analytics: analytics, dates: dates)

        await recorder.recordExposure(of: resolution(), surface: "deck_details")

        // Exactly the registry's four properties, and nothing that identifies
        // a person. The configuration the assignment came from rides in the
        // envelope's context rather than here.
        let properties = analytics.events.first?.properties ?? [:]
        XCTAssertEqual(
            Set(properties.keys),
            ["flagKey", "variant", "experimentId", "surface"]
        )
    }
}

final class FeatureFlagContextTests: XCTestCase {
    /// A rollout has to put the same device in the same bucket every time.
    func testTargetingKeyIsStableAndOpaque() {
        let scope = AccountScope.authenticated(userID: UUID())
        let first = FeatureFlagContext(
            scope: scope,
            environment: .prod,
            appVersion: "1.0.0",
            locale: "en"
        )
        let second = FeatureFlagContext(
            scope: scope,
            environment: .prod,
            appVersion: "1.0.0",
            locale: "en"
        )

        XCTAssertEqual(first.targetingKey, second.targetingKey)
        // The account identifier cannot be read back out of the key.
        XCTAssertFalse(first.targetingKey.contains(scope.key))
        XCTAssertTrue(first.isAuthenticated)
    }

    func testDifferentAccountsGetDifferentKeys() {
        let guest = FeatureFlagContext(
            scope: .guest(installationID: UUID()),
            environment: .prod,
            appVersion: "1.0.0",
            locale: "en"
        )
        let user = FeatureFlagContext(
            scope: .authenticated(userID: UUID()),
            environment: .prod,
            appVersion: "1.0.0",
            locale: "en"
        )

        XCTAssertNotEqual(guest.targetingKey, user.targetingKey)
        XCTAssertFalse(guest.isAuthenticated)
    }
}
