import Foundation
import OpenFeature

import CountryFlagsDomain

/// The typed wrapper feature code depends on.
///
/// Evaluation runs through the OpenFeature Swift SDK and our
/// `SnapshotOpenFeatureProvider`, but nothing outside this file knows that: a
/// screen names a registry key and receives a value of the right Swift type.
/// Replacing the provider — or adding a second one for streaming — is therefore
/// a change here and nowhere else.
///
/// The chain behind every read is remote snapshot, then the cached snapshot of
/// the same account, then the bundled registry default. The default is
/// available synchronously, so the first screen is never waiting for a network
/// call. Registering the provider with the SDK is asynchronous and happens once,
/// in the first `refresh(context:)`, so until it returns reads answer from the
/// bundled registry; the composition root awaits that refresh in the app's first
/// task, and it performs no request when the build has no backend.
///
/// `@unchecked Sendable` covers the SDK types this holds: `OpenFeatureAPI` and
/// its client are internally synchronized but predate strict concurrency. The
/// state this file adds is guarded by the lock below.
public final class FeatureFlagClient: FeatureFlagProviding, @unchecked Sendable {
    private let api: OpenFeatureAPI
    /// Qualified: `Client` alone is the generated API client of this module.
    private let evaluation: any OpenFeature.Client
    private let provider: SnapshotOpenFeatureProvider
    private let cache: any FeatureFlagSnapshotCaching
    private let remote: (any AppConfigurationFetching)?
    private let advertisingSink: (any AdvertisingPolicyReceiving)?
    private let logger: any AppLogging
    /// Debug and UI-test values. Production composition passes nothing: the
    /// overrides are assembled in the app target, which is the only place that
    /// can tell a Debug build from a release one.
    private let overrides: [String: FeatureFlagValue]

    private let lock = NSLock()
    /// `nil` until the account scope is known. Reads answer from the bundled
    /// registry in the meantime, which is what makes the first screen
    /// independent of both the keychain and the network.
    private var context: FeatureFlagContext?
    /// The provider is handed to the SDK once and only once.
    ///
    /// Registering it a second time takes the API back through `notReady`
    /// while it re-runs `initialize`, and an evaluation landing in that window
    /// is answered with the caller's bundled default rather than the snapshot.
    /// Every later refresh therefore updates the evaluation context instead.
    private var hasRegisteredProvider = false

    public init(
        context: FeatureFlagContext? = nil,
        cache: any FeatureFlagSnapshotCaching = UserDefaultsFeatureFlagSnapshotCache(),
        remote: (any AppConfigurationFetching)? = nil,
        advertisingSink: (any AdvertisingPolicyReceiving)? = nil,
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpAppLogger(),
        overrides: [String: FeatureFlagValue] = [:]
    ) {
        self.context = context
        self.cache = cache
        self.remote = remote
        self.advertisingSink = advertisingSink
        self.logger = logger
        self.overrides = overrides

        // Read on the calling thread: the snapshot of the previous run is
        // already on the device, and the first screen should not wait for it.
        let cached = context.flatMap { cache.snapshot(forContextKey: $0.cacheKey) }
        provider = SnapshotOpenFeatureProvider(launchSnapshot: cached, dates: dates)
        api = OpenFeatureAPI()
        evaluation = api.getClient()
        // The provider is registered by the first `refresh(context:)`, which
        // awaits it. Starting a second, unawaited registration here would race
        // with that one and leave evaluations answering from the bundled
        // defaults for as long as it took to land.
    }

    // MARK: Reading

    public func boolValue(for key: BooleanFeatureFlag) -> Bool {
        if case .boolean(let override)? = overrides[key.key] { return override }
        return evaluation.getBooleanValue(key: key.key, defaultValue: key.defaultValue)
    }

    public func stringValue(for key: StringFeatureFlag) -> String {
        if case .string(let override)? = overrides[key.key], key.accepts(override) {
            return override
        }
        let value = evaluation.getStringValue(key: key.key, defaultValue: key.defaultValue)
        // A variant this build cannot render is not applied: the registry, not
        // the control plane, decides what the client understands.
        return key.accepts(value) ? value : key.defaultValue
    }

    public func numberValue(for key: NumberFeatureFlag) -> Double {
        if case .number(let override)? = overrides[key.key], key.accepts(override) {
            return override
        }
        let value = evaluation.getDoubleValue(key: key.key, defaultValue: key.defaultValue)
        return key.accepts(value) ? value : key.defaultValue
    }

    public func sessionSnapshot() -> FeatureFlagSessionSnapshot {
        var values: [String: FeatureFlagValue] = [:]
        for flag in BooleanFeatureFlag.allCases where flag.activationPolicy == .nextSession {
            values[flag.key] = .boolean(boolValue(for: flag))
        }
        for flag in StringFeatureFlag.allCases where flag.activationPolicy == .nextSession {
            values[flag.key] = .string(stringValue(for: flag))
        }
        for flag in NumberFeatureFlag.allCases where flag.activationPolicy == .nextSession {
            values[flag.key] = .number(numberValue(for: flag))
        }
        return FeatureFlagSessionSnapshot(
            configVersion: provider.storedSnapshot()?.configVersion,
            values: values
        )
    }

    /// The configuration version currently answering, for an exposure event.
    public func currentConfigVersion() -> String? {
        provider.storedSnapshot()?.configVersion
    }

    // MARK: Refreshing

    /// Points the evaluation at `context` and fetches its configuration.
    ///
    /// A failure is not propagated: the app keeps the values it has, which is
    /// the whole point of a bundled default and a cache. Switching accounts
    /// drops the previous account's snapshot before anything is fetched, so a
    /// failed refresh cannot leave the new account reading the old one's
    /// configuration.
    public func refresh(context newContext: FeatureFlagContext) async {
        let (previousContextKey, isFirstRegistration) = withLock { () -> (String?, Bool) in
            let previous = context?.cacheKey
            context = newContext
            let isFirst = !hasRegisteredProvider
            hasRegisteredProvider = true
            return (previous, isFirst)
        }
        let contextChanged = previousContextKey != newContext.cacheKey

        if contextChanged {
            provider.resetContext(to: cache.snapshot(forContextKey: newContext.cacheKey))
            // Only a real switch invalidates a policy; the first resolution has
            // nothing to invalidate.
            if previousContextKey != nil {
                await advertisingSink?.apply(.disabled)
            }
        }

        let evaluationContext = Self.evaluationContext(for: newContext)
        if isFirstRegistration {
            await api.setProviderAndWait(provider: provider, initialContext: evaluationContext)
        } else if contextChanged {
            // The provider stays registered; only who it is evaluating for
            // changed.
            await api.setEvaluationContextAndWait(evaluationContext: evaluationContext)
        }

        guard let remote else { return }
        do {
            let result = try await remote.fetch(
                context: newContext,
                entityTag: provider.storedSnapshot()?.entityTag
            )
            switch result {
            case .updated(let configuration):
                provider.install(configuration.snapshot)
                cache.store(configuration.snapshot)
                await advertisingSink?.apply(configuration.advertising)
            case .notModified(let revalidatedUntil):
                guard let stored = provider.storedSnapshot() else { return }
                let revalidated = stored.revalidated(
                    at: Date(),
                    expiresAt: revalidatedUntil
                )
                provider.install(revalidated)
                cache.store(revalidated)
            }
        } catch {
            // Nothing is discarded and no screen is told: an unreachable
            // configuration endpoint is a normal offline outcome, not a failure
            // of the feature the user is in.
            logger.log(
                .notice,
                "snapshot.refresh_failed",
                category: .featureFlags,
                fields: ["error": String(describing: APIError.from(error))]
            )
        }
    }

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    /// Only allowlisted attributes reach the SDK. The targeting key is already
    /// an opaque hash, so nothing here identifies a person.
    private static func evaluationContext(for context: FeatureFlagContext) -> EvaluationContext {
        ImmutableContext(
            targetingKey: context.targetingKey,
            structure: ImmutableStructure(
                attributes: context.attributes.mapValues { Value.string($0) }
            )
        )
    }
}
