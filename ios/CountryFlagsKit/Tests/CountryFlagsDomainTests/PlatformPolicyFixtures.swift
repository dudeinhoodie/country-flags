import Foundation
import XCTest

import CountryFlagsDomain

/// Deterministic values so a failure points at the behaviour, not at the data.
enum PolicyFixtures {
    static let instant = Date(timeIntervalSince1970: 1_760_000_000)

    static let guestScope = AccountScope.guest(
        installationID: UUID(uuidString: "81000000-0000-4000-8000-000000000001")!
    )
    static let userScope = AccountScope.authenticated(
        userID: UUID(uuidString: "80000000-0000-4000-8000-000000000001")!
    )

    static func context(
        scope: AccountScope = guestScope,
        environment: AppEnvironment = .dev,
        locale: String = "ru-RU"
    ) -> FeatureFlagContext {
        FeatureFlagContext(
            scope: scope,
            environment: environment,
            appVersion: "1.2.3",
            build: "42",
            locale: locale
        )
    }

    /// A policy that would allow the banner if nothing else objected. Every
    /// eligibility test starts from it and switches one condition off, so the
    /// assertion is about that condition and not about the pile of defaults.
    static func permissivePolicy(
        placement: AdPlacement = .homeBottomBanner
    ) -> AdvertisingPolicy {
        AdvertisingPolicy(
            policyVersion: "test-only-ads-v1",
            isEnabled: true,
            mode: .contextualOnly,
            placements: [
                placement: AdvertisingPolicy.PlacementPolicy(
                    isEnabled: true,
                    format: placement.format
                )
            ],
            refreshAfter: instant.addingTimeInterval(900)
        )
    }

    static let permissivePrivacy = AdvertisingPrivacyState(
        trackingAuthorization: .notDetermined,
        advertisingConsent: .granted,
        isChildDirectedTreatment: false,
        hasAdFreeEntitlement: false
    )

    static let satisfiedFrequency = AdFrequencyState(
        completedStudySessions: 10,
        presentationsOfPlacementThisAppSession: 0,
        presentationsToday: 0,
        lastInterstitialAt: nil,
        lastDismissOrFailureAt: nil
    )

    /// Everything switched on. Advertising is still refused for reasons a flag
    /// cannot override, which is the point of the tests that use it.
    static func allowingRequest(
        placement: AdPlacement = .homeBottomBanner,
        surface: AdSurface = .home,
        interface: AdInterfaceState = .idle,
        privacy: AdvertisingPrivacyState = permissivePrivacy,
        providerStatus: AdProviderStatus = .ready,
        frequency: AdFrequencyState = satisfiedFrequency
    ) -> AdEligibilityRequest {
        AdEligibilityRequest(
            placement: placement,
            surface: surface,
            policy: permissivePolicy(placement: placement),
            privacy: privacy,
            providerStatus: providerStatus,
            interface: interface,
            frequency: frequency,
            // The shipping app passes the registry's empty set. A test says the
            // placement was approved so the checks after that one can be
            // exercised at all.
            approvedPlacements: [placement],
            now: instant
        )
    }

    /// Every advertising flag switched on, which is what makes the "a flag
    /// cannot override policy" assertions meaningful.
    static let flagsWithAdvertisingOn = BundledFeatureFlagProvider(
        overrides: Dictionary(
            uniqueKeysWithValues: BooleanFeatureFlag.allCases
                .filter { $0.key.hasPrefix("ads.") }
                .map { ($0.key, FeatureFlagValue.boolean(true)) }
        )
    )

    /// Loads a mirror of a canonical registry from the test bundle.
    static func registry(named name: String) throws -> [String: Any] {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: name, withExtension: "json"),
            "The \(name) mirror is missing. Run ios/Scripts/sync-registries.sh."
        )
        let data = try Data(contentsOf: url)
        let json = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(json as? [String: Any])
    }
}

/// A clock a test moves by hand.
final class TestClock: DateProviding, @unchecked Sendable {
    private let lock = NSLock()
    private var instant: Date

    init(now: Date = PolicyFixtures.instant) {
        self.instant = now
    }

    func now() -> Date {
        lock.lock()
        defer { lock.unlock() }
        return instant
    }

    func advance(by interval: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        instant = instant.addingTimeInterval(interval)
    }
}

/// Collects what was reported so a test can count exposures.
actor RecordingExposureReporter: FeatureExposureReporting {
    private(set) var exposures: [FeatureExposure] = []

    func report(_ exposure: FeatureExposure) async {
        exposures.append(exposure)
    }

    func recorded() -> [FeatureExposure] {
        exposures
    }
}

/// Collects log events after redaction.
final class RecordingAppLogger: AppLogging, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [LogEvent] = []

    func log(_ event: LogEvent) {
        lock.lock()
        defer { lock.unlock() }
        storage.append(event)
    }

    var events: [LogEvent] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    /// Everything the logger was handed, flattened, for a redaction assertion.
    var renderedText: String {
        events
            .map { "\($0.category.rawValue) \($0.event) \($0.requestID ?? "-") \($0.renderedFields)" }
            .joined(separator: "\n")
    }
}
