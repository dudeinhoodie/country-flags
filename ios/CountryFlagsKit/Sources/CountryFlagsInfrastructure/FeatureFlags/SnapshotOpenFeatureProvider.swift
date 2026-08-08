import Combine
import Foundation
import OpenFeature
import os

import CountryFlagsDomain

/// The OpenFeature provider of this app.
///
/// The backend evaluates the targeting rules and returns results, so there is
/// nothing for a vendor SDK to do on the device: this provider answers from the
/// snapshot the client fetched, the copy cached from the previous run, and the
/// bundled registry. That keeps management credentials and targeting rules off
/// the device while feature code still talks to the standard evaluation API.
///
/// `FeatureProvider` is not `Sendable` — the SDK is still written for Swift 5 —
/// so the conformance here is unchecked. It holds: every stored property is
/// either immutable or behind the lock below, and the evaluation methods read a
/// copy of the state rather than the state itself.
final class SnapshotOpenFeatureProvider: FeatureProvider, @unchecked Sendable {
    /// Metadata keys the client reads back off an evaluation to describe an
    /// exposure without asking the provider a second question.
    enum MetadataKey {
        static let source = "source"
        static let configVersion = "configVersion"
    }

    struct State: Sendable {
        var snapshot: AppConfigSnapshot?
        var scopeKey: String?
        var overrides: [String: FeatureFlagValue]
    }

    private struct Metadata: ProviderMetadata {
        let name: String? = "country-flags-snapshot"
    }

    private let state: OSAllocatedUnfairLock<State>
    private let resolver: FeatureFlagResolver
    private let dates: any DateProviding
    private let eventHandler = EventHandler()

    let metadata: ProviderMetadata = Metadata()
    var hooks: [any Hook] { [] }

    init(
        overrides: FeatureFlagOverrides,
        resolver: FeatureFlagResolver = FeatureFlagResolver(),
        dates: any DateProviding
    ) {
        self.state = OSAllocatedUnfairLock(
            initialState: State(snapshot: nil, scopeKey: nil, overrides: overrides.values)
        )
        self.resolver = resolver
        self.dates = dates
    }

    /// Replaces what the provider answers from.
    ///
    /// Setting the scope together with the snapshot is deliberate: the two are
    /// one fact, and an intermediate state where a new account is paired with
    /// the previous snapshot must not be observable.
    func apply(snapshot: AppConfigSnapshot?, scopeKey: String) {
        state.withLock {
            $0.snapshot = snapshot
            $0.scopeKey = scopeKey
        }
        eventHandler.send(.configurationChanged(nil))
    }

    var currentSnapshot: AppConfigSnapshot? {
        state.withLock { $0.snapshot }
    }

    // MARK: - FeatureProvider

    /// Nothing to start: the state is in place before the provider is
    /// registered, which is what makes the first evaluation answer from the
    /// cache instead of from a default.
    func initialize(initialContext: EvaluationContext?) async throws {}

    /// The client sets the state and refreshes explicitly, so a context change
    /// has nothing left to reconcile here.
    func onContextSet(oldContext: EvaluationContext?, newContext: EvaluationContext) async throws {}

    func getBooleanEvaluation(
        key: String,
        defaultValue: Bool,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<Bool> {
        let resolution = try resolve(key)
        guard case .boolean(let value) = resolution.value else {
            throw OpenFeatureError.typeMismatchError
        }
        return evaluation(value: value, from: resolution)
    }

    func getStringEvaluation(
        key: String,
        defaultValue: String,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<String> {
        let resolution = try resolve(key)
        guard case .string(let value) = resolution.value else {
            throw OpenFeatureError.typeMismatchError
        }
        return evaluation(value: value, from: resolution)
    }

    func getIntegerEvaluation(
        key: String,
        defaultValue: Int64,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<Int64> {
        let resolution = try resolve(key)
        // The contract has one numeric type. A whole number is returned as an
        // integer; a fractional one is a type mismatch rather than a silently
        // truncated value.
        guard case .number(let value) = resolution.value,
            value.rounded() == value,
            let integer = Int64(exactly: value.rounded())
        else {
            throw OpenFeatureError.typeMismatchError
        }
        return evaluation(value: integer, from: resolution)
    }

    func getDoubleEvaluation(
        key: String,
        defaultValue: Double,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<Double> {
        let resolution = try resolve(key)
        guard case .number(let value) = resolution.value else {
            throw OpenFeatureError.typeMismatchError
        }
        return evaluation(value: value, from: resolution)
    }

    /// The registry has no object flag, and an app-config snapshot cannot carry
    /// one, so asking for one is a programming error rather than a fallback.
    func getObjectEvaluation(
        key: String,
        defaultValue: Value,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<Value> {
        throw OpenFeatureError.typeMismatchError
    }

    func observe() -> AnyPublisher<ProviderEvent?, Never> {
        eventHandler.observe()
    }

    // MARK: - Resolution

    private func resolve(_ key: String) throws -> FeatureFlagResolution {
        let state = state.withLock { $0 }
        guard let scopeKey = state.scopeKey else {
            // No account context yet. The evaluation API answers with the
            // bundled default the caller passed in, which is exactly what a
            // cold launch should show.
            throw OpenFeatureError.providerNotReadyError
        }
        guard
            let resolution = resolver.resolve(
                key: key,
                snapshot: state.snapshot,
                scopeKey: scopeKey,
                overrides: state.overrides,
                at: dates.now()
            )
        else {
            throw OpenFeatureError.flagNotFoundError(key: key)
        }
        return resolution
    }

    private func evaluation<T>(
        value: T,
        from resolution: FeatureFlagResolution
    ) -> ProviderEvaluation<T> {
        var metadata: [String: FlagMetadataValue] = [
            MetadataKey.source: .string(resolution.source.rawValue)
        ]
        if let configVersion = resolution.configVersion {
            metadata[MetadataKey.configVersion] = .string(configVersion)
        }
        return ProviderEvaluation(
            value: value,
            flagMetadata: metadata,
            variant: resolution.variant,
            reason: reason(for: resolution.source).rawValue
        )
    }

    private func reason(for source: FeatureFlagSource) -> Reason {
        switch source {
        case .remoteSnapshot: .targetingMatch
        case .cachedSnapshot: .cached
        case .bundledDefault: .defaultReason
        case .debugOverride: .staticReason
        }
    }
}
