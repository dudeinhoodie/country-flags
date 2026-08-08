import Foundation
import OpenFeature
import os

import CountryFlagsDomain

/// The typed wrapper feature code depends on.
///
/// Evaluation goes through the OpenFeature API, so swapping in a real control
/// plane later is a change of provider rather than a change of every call site.
/// Reads are synchronous and always answerable: before a provider is registered
/// the evaluation API returns the bundled default that is passed in with every
/// call, which is what lets the first screen draw without waiting for a fetch.
///
/// The `Sendable` conformance is unchecked because `OpenFeatureAPI` and its
/// client come from an SDK written for Swift 5. Both serialize their own state
/// internally — the API on a private dispatch queue, the client behind a lock —
/// and everything this type adds is immutable or held in the lock below.
public final class OpenFeatureFlagClient: FeatureFlagProviding, @unchecked Sendable {
    private let provider: SnapshotOpenFeatureProvider
    /// An instance rather than `OpenFeatureAPI.shared`: the composition root
    /// owns it, a test owns its own, and no global state ties the two together.
    private let api: OpenFeatureAPI
    private let evaluation: any OpenFeature.Client
    private let service: AppConfigService
    private let cache: any AppConfigSnapshotCaching
    private let dates: any DateProviding
    private let logger: any AppLogging
    private let context: OSAllocatedUnfairLock<FeatureFlagContext?>

    public init(
        service: AppConfigService,
        cache: any AppConfigSnapshotCaching,
        overrides: FeatureFlagOverrides = .none,
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = OSLogAppLogger()
    ) {
        self.provider = SnapshotOpenFeatureProvider(overrides: overrides, dates: dates)
        self.api = OpenFeatureAPI()
        self.evaluation = api.getClient()
        self.service = service
        self.cache = cache
        self.dates = dates
        self.logger = logger
        self.context = OSAllocatedUnfairLock(initialState: nil)
    }

    /// Makes the client answer for an account, without touching the network.
    ///
    /// The cached snapshot is in place before the provider is registered, so
    /// the first evaluation after this call already reflects the previous run
    /// rather than the bundled defaults. Fetching is `refresh`, which the app
    /// runs after the first frame.
    public func activate(context: FeatureFlagContext) async {
        applyCachedSnapshot(for: context)
        await api.setProviderAndWait(
            provider: provider,
            initialContext: Self.evaluationContext(from: context)
        )
    }

    /// Fetches a new snapshot for the context.
    ///
    /// Switching accounts is a refresh with a different scope: the previous
    /// snapshot is dropped before the request goes out, so no read can be
    /// answered from the other account's configuration while it is in flight.
    public func refresh(context: FeatureFlagContext) async {
        let previous = self.context.withLock { $0 }
        if previous == nil {
            // Refreshing before the provider was registered would fetch a
            // snapshot nothing could read.
            await activate(context: context)
        } else if previous?.scope != context.scope {
            applyCachedSnapshot(for: context)
            await api.setEvaluationContextAndWait(
                evaluationContext: Self.evaluationContext(from: context)
            )
        }
        await fetchSnapshot(for: context)
    }

    /// The snapshot currently answering, for a diagnostics screen.
    public var currentSnapshot: AppConfigSnapshot? {
        provider.currentSnapshot
    }

    /// The advertising policy of the current snapshot, or the off policy when
    /// nothing has been accepted yet.
    public var advertisingPolicy: AdvertisingPolicy {
        guard let snapshot = provider.currentSnapshot,
            snapshot.isFresh(at: dates.now())
        else {
            return .off
        }
        return snapshot.advertising
    }

    // MARK: - FeatureFlagProviding

    public func boolValue(for key: BooleanFeatureFlag) -> Bool {
        evaluation.getBooleanValue(key: key.rawValue, defaultValue: key.defaultValue)
    }

    public func stringValue(for key: StringFeatureFlag) -> String {
        evaluation.getStringValue(key: key.rawValue, defaultValue: key.defaultValue)
    }

    public func numberValue(for key: NumberFeatureFlag) -> Double {
        evaluation.getDoubleValue(key: key.rawValue, defaultValue: key.defaultValue)
    }

    // MARK: - Exposure

    /// The detail an exposure event needs.
    ///
    /// Calling this does not report anything: whether a person actually saw the
    /// feature is a decision only the feature can make, and the recorder is
    /// what turns it into an event.
    public func exposure(for key: BooleanFeatureFlag) -> FeatureFlagResolution {
        resolution(
            for: key,
            details: evaluation.getBooleanDetails(
                key: key.rawValue,
                defaultValue: key.defaultValue
            ),
            value: FeatureFlagValue.boolean
        )
    }

    public func exposure(for key: StringFeatureFlag) -> FeatureFlagResolution {
        resolution(
            for: key,
            details: evaluation.getStringDetails(
                key: key.rawValue,
                defaultValue: key.defaultValue
            ),
            value: FeatureFlagValue.string
        )
    }

    public func exposure(for key: NumberFeatureFlag) -> FeatureFlagResolution {
        resolution(
            for: key,
            details: evaluation.getDoubleDetails(
                key: key.rawValue,
                defaultValue: key.defaultValue
            ),
            value: FeatureFlagValue.number
        )
    }

    // MARK: - Private

    private func applyCachedSnapshot(for context: FeatureFlagContext) {
        provider.apply(
            snapshot: cache.snapshot(for: context.scope.key),
            scopeKey: context.scope.key
        )
        self.context.withLock { $0 = context }
    }

    private func fetchSnapshot(for context: FeatureFlagContext) async {
        let cached = provider.currentSnapshot
        do {
            switch try await service.fetch(context: context, entityTag: cached?.entityTag) {
            case .updated(let snapshot):
                cache.store(snapshot)
                provider.apply(snapshot: snapshot, scopeKey: context.scope.key)
            case .notModified:
                // The server confirmed the cached copy is current, so its
                // lifetime starts again. Leaving the old expiry in place would
                // discard a snapshot the backend just vouched for.
                guard let cached else { break }
                let renewed = cached.renewed(at: dates.now())
                cache.store(renewed)
                provider.apply(snapshot: renewed, scopeKey: context.scope.key)
            }
        } catch {
            // A failed refresh is not a failure of the app: the previous
            // answers stand and the next attempt will try again.
            logger.log(
                .error,
                .featureFlags,
                "App configuration refresh failed",
                ["code": .safe(Self.code(for: error))]
            )
        }
    }

    private func resolution<T>(
        for key: some FeatureFlagKey,
        details: FlagEvaluationDetails<T>,
        value: (T) -> FeatureFlagValue
    ) -> FeatureFlagResolution {
        let source =
            details.flagMetadata[SnapshotOpenFeatureProvider.MetadataKey.source]?
            .asString()
            .flatMap(FeatureFlagSource.init(rawValue:)) ?? .bundledDefault
        return FeatureFlagResolution(
            key: key.rawValue,
            value: value(details.value),
            variant: details.variant ?? bundledFeatureFlagVariant,
            source: source,
            activationPolicy: key.definition.activationPolicy,
            configVersion: details.flagMetadata[
                SnapshotOpenFeatureProvider.MetadataKey.configVersion
            ]?.asString()
        )
    }

    private static func code(for error: any Error) -> String {
        let apiError = APIError.from(error)
        return apiError.details?.code ?? String(describing: apiError)
    }

    private static func evaluationContext(from context: FeatureFlagContext) -> EvaluationContext {
        // The allowlist of the feature flag spec and nothing else. There is no
        // branch here that could add an email or a provider subject.
        ImmutableContext(
            targetingKey: context.targetingKey,
            structure: ImmutableStructure(attributes: [
                "environment": .string(context.environment.rawValue),
                "platform": .string(context.platform),
                "appVersion": .string(context.appVersion),
                "locale": .string(context.locale),
                "authenticated": .boolean(context.isAuthenticated),
            ])
        )
    }
}
