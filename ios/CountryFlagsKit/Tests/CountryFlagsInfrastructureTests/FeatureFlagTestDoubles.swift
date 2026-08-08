import Foundation

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// Deterministic values for the platform policy tests.
enum FlagFixtures {
    static let instant = Date(timeIntervalSince1970: 1_760_000_000)

    static let guestScope = AccountScope.guest(
        installationID: UUID(uuidString: "81000000-0000-4000-8000-000000000001")!
    )
    static let userScope = AccountScope.authenticated(
        userID: UUID(uuidString: "80000000-0000-4000-8000-000000000001")!
    )

    static func context(scope: AccountScope = guestScope) -> FeatureFlagContext {
        FeatureFlagContext(
            scope: scope,
            environment: .dev,
            appVersion: "1.2.3",
            build: "42",
            locale: "ru-RU"
        )
    }

    static func snapshot(
        context: FeatureFlagContext,
        configVersion: String = "config-1",
        expiresAt: Date = instant.addingTimeInterval(900),
        flags: [String: EvaluatedFeatureFlag],
        entityTag: String? = "\"etag-1\""
    ) -> FeatureFlagSnapshot {
        FeatureFlagSnapshot(
            configVersion: configVersion,
            contextKey: context.cacheKey,
            fetchedAt: instant,
            expiresAt: expiresAt,
            flags: flags,
            entityTag: entityTag
        )
    }

    static func boolean(
        _ value: Bool,
        variant: String = "enabled",
        policy: FeatureFlagActivationPolicy = .immediate
    ) -> EvaluatedFeatureFlag {
        EvaluatedFeatureFlag(value: .boolean(value), variant: variant, activationPolicy: policy)
    }

    static func string(
        _ value: String,
        variant: String? = nil,
        policy: FeatureFlagActivationPolicy = .nextLaunch
    ) -> EvaluatedFeatureFlag {
        EvaluatedFeatureFlag(
            value: .string(value),
            variant: variant ?? value,
            activationPolicy: policy
        )
    }

    static func number(
        _ value: Double,
        variant: String = "tuned",
        policy: FeatureFlagActivationPolicy = .nextSession
    ) -> EvaluatedFeatureFlag {
        EvaluatedFeatureFlag(value: .number(value), variant: variant, activationPolicy: policy)
    }
}

/// A clock a test moves by hand.
final class TestClock: DateProviding, @unchecked Sendable {
    private let lock = NSLock()
    private var instant: Date

    init(now: Date = FlagFixtures.instant) {
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

/// A cache that lives only as long as the test.
final class InMemorySnapshotCache: FeatureFlagSnapshotCaching, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: FeatureFlagSnapshot] = [:]

    init(_ initial: [FeatureFlagSnapshot] = []) {
        for snapshot in initial {
            storage[snapshot.contextKey] = snapshot
        }
    }

    func snapshot(forContextKey contextKey: String) -> FeatureFlagSnapshot? {
        lock.lock()
        defer { lock.unlock() }
        return storage[contextKey]
    }

    func store(_ snapshot: FeatureFlagSnapshot) {
        lock.lock()
        defer { lock.unlock() }
        storage[snapshot.contextKey] = snapshot
    }

    func removeSnapshot(forContextKey contextKey: String) {
        lock.lock()
        defer { lock.unlock() }
        storage.removeValue(forKey: contextKey)
    }

    var stored: [String: FeatureFlagSnapshot] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// Answers a configuration fetch from a script, and records what it was asked.
actor StubConfigurationFetcher: AppConfigurationFetching {
    enum Outcome: Sendable {
        case result(AppConfigurationFetchResult)
        case failure(APIError)
    }

    private var outcomes: [Outcome]
    private let repeatsLast: Bool
    private(set) var requestedEntityTags: [String?] = []
    private(set) var requestedContextKeys: [String] = []

    init(_ outcomes: [Outcome], repeatsLast: Bool = true) {
        self.outcomes = outcomes
        self.repeatsLast = repeatsLast
    }

    func fetch(
        context: FeatureFlagContext,
        entityTag: String?
    ) async throws -> AppConfigurationFetchResult {
        requestedEntityTags.append(entityTag)
        requestedContextKeys.append(context.cacheKey)

        let outcome: Outcome
        if outcomes.count > 1 || !repeatsLast {
            guard !outcomes.isEmpty else {
                throw APIError.transport("no outcome registered")
            }
            outcome = outcomes.removeFirst()
        } else {
            guard let last = outcomes.first else {
                throw APIError.transport("no outcome registered")
            }
            outcome = last
        }

        switch outcome {
        case .result(let result): return result
        case .failure(let error): throw error
        }
    }

    func observedEntityTags() -> [String?] { requestedEntityTags }
    func observedContextKeys() -> [String] { requestedContextKeys }
}

/// Records what a refresh handed to the advertising side.
actor RecordingAdvertisingSink: AdvertisingPolicyReceiving {
    private(set) var applied: [AdvertisingPolicy] = []

    func apply(_ policy: AdvertisingPolicy) {
        applied.append(policy)
    }

    func observed() -> [AdvertisingPolicy] { applied }
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

    var renderedText: String {
        events
            .map { "\($0.category.rawValue) \($0.event) \($0.requestID ?? "-") \($0.renderedFields)" }
            .joined(separator: "\n")
    }
}
