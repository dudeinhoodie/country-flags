import XCTest

@testable import CountryFlagsDomain

/// The fallback chain, tested without a network, a provider or a real clock.
final class FeatureFlagResolverTests: XCTestCase {
    private let resolver = FeatureFlagResolver()
    private let scopeKey = AccountScope.guest(installationID: UUID()).key
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: - Cold launch

    /// A device that has never reached the backend still has an answer for
    /// every flag, and it is the one the registry declares.
    func testResolvesBundledDefaultWithoutSnapshot() throws {
        for definition in FeatureFlagRegistry.definitions {
            let resolution = try XCTUnwrap(
                resolver.resolve(
                    key: definition.key,
                    snapshot: nil,
                    scopeKey: scopeKey,
                    at: now
                )
            )
            XCTAssertEqual(resolution.value, definition.defaultValue)
            XCTAssertEqual(resolution.source, .bundledDefault)
            XCTAssertEqual(resolution.variant, bundledFeatureFlagVariant)
            XCTAssertNil(resolution.configVersion)
        }
    }

    func testUnknownKeyHasNoResolution() {
        XCTAssertNil(
            resolver.resolve(
                key: "study.telepathy.enabled",
                snapshot: nil,
                scopeKey: scopeKey,
                at: now
            )
        )
    }

    // MARK: - Snapshot

    func testFreshSnapshotWins() throws {
        let snapshot = makeSnapshot(
            flags: [
                BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: EvaluatedFeatureFlag(
                    value: .boolean(true),
                    variant: "enabled",
                    activationPolicy: .nextSession
                )
            ]
        )

        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue,
                snapshot: snapshot,
                scopeKey: scopeKey,
                at: now
            )
        )
        XCTAssertEqual(resolution.value, .boolean(true))
        XCTAssertEqual(resolution.source, .remoteSnapshot)
        XCTAssertEqual(resolution.variant, "enabled")
        XCTAssertEqual(resolution.configVersion, "config-1")
    }

    func testCachedSnapshotIsReportedAsCached() throws {
        let snapshot = makeSnapshot(
            flags: [
                BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: EvaluatedFeatureFlag(
                    value: .boolean(true),
                    variant: "enabled",
                    activationPolicy: .nextSession
                )
            ]
        ).withOrigin(.cache)

        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue,
                snapshot: snapshot,
                scopeKey: scopeKey,
                at: now
            )
        )
        XCTAssertEqual(resolution.value, .boolean(true))
        XCTAssertEqual(resolution.source, .cachedSnapshot)
    }

    /// An expired snapshot is not served. A device that stays offline must not
    /// keep a killed feature running because its last snapshot said so.
    func testExpiredSnapshotFallsBackToDefault() throws {
        let snapshot = makeSnapshot(
            expiresAt: now.addingTimeInterval(-1),
            flags: [
                BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: EvaluatedFeatureFlag(
                    value: .boolean(true),
                    variant: "enabled",
                    activationPolicy: .nextSession
                )
            ]
        )

        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue,
                snapshot: snapshot,
                scopeKey: scopeKey,
                at: now
            )
        )
        XCTAssertEqual(resolution.value, .boolean(false))
        XCTAssertEqual(resolution.source, .bundledDefault)
    }

    /// The snapshot of another account answers nothing. After a sign-in the
    /// previous person's configuration is not an approximation of the new
    /// one — it is the wrong one, and it may say what they were targeted with.
    func testSnapshotOfAnotherScopeIsIgnored() throws {
        let snapshot = makeSnapshot(
            scopeKey: AccountScope.authenticated(userID: UUID()).key,
            flags: [
                BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: EvaluatedFeatureFlag(
                    value: .boolean(true),
                    variant: "enabled",
                    activationPolicy: .nextSession
                )
            ]
        )

        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue,
                snapshot: snapshot,
                scopeKey: scopeKey,
                at: now
            )
        )
        XCTAssertEqual(resolution.value, .boolean(false))
        XCTAssertEqual(resolution.source, .bundledDefault)
    }

    // MARK: - Refused values

    func testTypeMismatchFallsBackToDefault() throws {
        let snapshot = makeSnapshot(
            flags: [
                // A boolean key carrying a string.
                BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: EvaluatedFeatureFlag(
                    value: .string("true"),
                    variant: "enabled",
                    activationPolicy: .nextSession
                )
            ]
        )

        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue,
                snapshot: snapshot,
                scopeKey: scopeKey,
                at: now
            )
        )
        XCTAssertEqual(resolution.value, .boolean(false))
        XCTAssertEqual(resolution.source, .bundledDefault)
    }

    func testVariantOutsideTheAllowedSetIsRefused() throws {
        let snapshot = makeSnapshot(
            flags: [
                StringFeatureFlag.homeRecommendedDecksVariant.rawValue: EvaluatedFeatureFlag(
                    value: .string("chaotic"),
                    variant: "chaotic",
                    activationPolicy: .nextLaunch
                )
            ]
        )

        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: StringFeatureFlag.homeRecommendedDecksVariant.rawValue,
                snapshot: snapshot,
                scopeKey: scopeKey,
                at: now
            )
        )
        XCTAssertEqual(resolution.value, .string("control"))
        XCTAssertEqual(resolution.source, .bundledDefault)
    }

    func testNumberOutsideTheBoundsIsRefused() throws {
        let snapshot = makeSnapshot(
            flags: [
                NumberFeatureFlag.studyMaxNewCardsPerSession.rawValue: EvaluatedFeatureFlag(
                    value: .number(500),
                    variant: "large",
                    activationPolicy: .nextSession
                )
            ]
        )

        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: NumberFeatureFlag.studyMaxNewCardsPerSession.rawValue,
                snapshot: snapshot,
                scopeKey: scopeKey,
                at: now
            )
        )
        XCTAssertEqual(resolution.value, .number(10))
        XCTAssertEqual(resolution.source, .bundledDefault)
    }

    // MARK: - Overrides

    func testOverrideWinsOverSnapshot() throws {
        let snapshot = makeSnapshot(
            flags: [
                BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: EvaluatedFeatureFlag(
                    value: .boolean(false),
                    variant: "disabled",
                    activationPolicy: .nextSession
                )
            ]
        )

        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue,
                snapshot: snapshot,
                scopeKey: scopeKey,
                overrides: [
                    BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: .boolean(true)
                ],
                at: now
            )
        )
        XCTAssertEqual(resolution.value, .boolean(true))
        XCTAssertEqual(resolution.source, .debugOverride)
    }

    func testOverrideOfTheWrongTypeIsIgnored() throws {
        let resolution = try XCTUnwrap(
            resolver.resolve(
                key: BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue,
                snapshot: nil,
                scopeKey: scopeKey,
                overrides: [
                    BooleanFeatureFlag.studyMultipleChoiceEnabled.rawValue: .number(1)
                ],
                at: now
            )
        )
        XCTAssertEqual(resolution.source, .bundledDefault)
    }

    // MARK: - Fixtures

    private func makeSnapshot(
        scopeKey: String? = nil,
        expiresAt: Date? = nil,
        flags: [String: EvaluatedFeatureFlag]
    ) -> AppConfigSnapshot {
        AppConfigSnapshot(
            configVersion: "config-1",
            generatedAt: now.addingTimeInterval(-60),
            expiresAt: expiresAt ?? now.addingTimeInterval(900),
            fetchedAt: now.addingTimeInterval(-60),
            scopeKey: scopeKey ?? self.scopeKey,
            entityTag: "\"config-1\"",
            contentVersion: "content-1",
            supportedTemplateSchemaVersions: [1],
            clientVersionPolicy: ClientVersionPolicy(
                minimumSupported: "1.0.0",
                latest: "1.0.0",
                updateMode: .none
            ),
            flags: flags,
            advertising: .off,
            origin: .remote
        )
    }
}
