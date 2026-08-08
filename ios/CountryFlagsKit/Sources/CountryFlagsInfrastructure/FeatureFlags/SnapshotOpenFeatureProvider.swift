import Combine
import Foundation
import OpenFeature

import CountryFlagsDomain

/// Resolves flags from an already evaluated backend snapshot.
///
/// The app holds no control plane SDK and no management credentials: the
/// backend evaluates the targeting rules and returns values, and this provider
/// only decides which snapshot answers. When none does it returns the default
/// the caller passed — the bundled registry value — so an evaluation is total
/// offline and before the first refresh.
///
/// Two snapshots are kept because activation policy decides which one applies.
/// A `nextLaunch` key answers from the configuration the process started with,
/// so a refresh cannot rebuild navigation under the user's hands; every other
/// key answers from the current one, which is what makes a kill switch a kill
/// switch.
///
/// The class is `@unchecked Sendable` because the SDK protocol it implements
/// predates strict concurrency. The two snapshots are guarded by the lock below
/// and nothing else here is mutable.
final class SnapshotOpenFeatureProvider: FeatureProvider, @unchecked Sendable {
    let metadata: ProviderMetadata = Metadata()
    let hooks: [any Hook] = []

    private let lock = NSLock()
    private var current: FeatureFlagSnapshot?
    private var launch: FeatureFlagSnapshot?
    private let dates: any DateProviding
    private let events = EventHandler()

    init(launchSnapshot: FeatureFlagSnapshot? = nil, dates: any DateProviding) {
        self.current = launchSnapshot
        self.launch = launchSnapshot
        self.dates = dates
    }

    struct Metadata: ProviderMetadata {
        let name: String? = "country-flags-snapshot"
    }

    // MARK: Snapshots

    /// Applies a refreshed snapshot to everything but the launch-frozen keys.
    func install(_ snapshot: FeatureFlagSnapshot) {
        lock.lock()
        current = snapshot
        lock.unlock()
        events.send(.configurationChanged(nil))
    }

    /// Starts over for another account.
    ///
    /// Both snapshots are replaced, so no value evaluated for the previous
    /// account can survive the switch — not even through a `nextLaunch` key.
    func resetContext(to snapshot: FeatureFlagSnapshot?) {
        lock.lock()
        current = snapshot
        launch = snapshot
        lock.unlock()
        events.send(.contextChanged(nil))
    }

    /// The stored snapshot regardless of freshness, which is what a revalidating
    /// request needs in order to send its entity tag.
    func storedSnapshot() -> FeatureFlagSnapshot? {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    /// The snapshot answering a key, or `nil` when none is fresh enough.
    private func snapshot(for key: String) -> FeatureFlagSnapshot? {
        let policy = FeatureFlagRegistry.definition(forKey: key)?.activationPolicy
        lock.lock()
        let candidate = policy == .nextLaunch ? launch : current
        lock.unlock()
        guard let candidate, candidate.isFresh(at: dates.now()) else { return nil }
        return candidate
    }

    // MARK: FeatureProvider

    func initialize(initialContext: EvaluationContext?) async throws {}

    func onContextSet(oldContext: EvaluationContext?, newContext: EvaluationContext) async throws {}

    func observe() -> AnyPublisher<ProviderEvent?, Never> {
        events.observe()
    }

    func getBooleanEvaluation(
        key: String,
        defaultValue: Bool,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<Bool> {
        evaluate(key: key, defaultValue: defaultValue) { value in
            if case .boolean(let boolean) = value { return boolean }
            return nil
        }
    }

    func getStringEvaluation(
        key: String,
        defaultValue: String,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<String> {
        evaluate(key: key, defaultValue: defaultValue) { value in
            if case .string(let string) = value { return string }
            return nil
        }
    }

    func getIntegerEvaluation(
        key: String,
        defaultValue: Int64,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<Int64> {
        evaluate(key: key, defaultValue: defaultValue) { value in
            // The contract has a single numeric type. An integer request is
            // answered from it only when the number really is one.
            guard case .number(let number) = value,
                let integer = Int64(exactly: number)
            else { return nil }
            return integer
        }
    }

    func getDoubleEvaluation(
        key: String,
        defaultValue: Double,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<Double> {
        evaluate(key: key, defaultValue: defaultValue) { value in
            if case .number(let number) = value { return number }
            return nil
        }
    }

    func getObjectEvaluation(
        key: String,
        defaultValue: Value,
        context: EvaluationContext?
    ) throws -> ProviderEvaluation<Value> {
        // The snapshot contract carries booleans, strings and numbers only.
        ProviderEvaluation(
            value: defaultValue,
            reason: Reason.defaultReason.rawValue,
            errorCode: .typeMismatch
        )
    }

    /// The one place the resolution order lives: an applicable, unexpired
    /// snapshot answers, and everything else — no snapshot, an expired one, an
    /// absent key, a value of the wrong type — leaves the caller with its
    /// bundled default.
    private func evaluate<T>(
        key: String,
        defaultValue: T,
        transform: (FeatureFlagValue) -> T?
    ) -> ProviderEvaluation<T> {
        guard let snapshot = snapshot(for: key) else {
            return ProviderEvaluation(
                value: defaultValue,
                reason: Reason.defaultReason.rawValue,
                errorCode: .providerNotReady
            )
        }
        guard let flag = snapshot.flags[key] else {
            return ProviderEvaluation(
                value: defaultValue,
                reason: Reason.defaultReason.rawValue,
                errorCode: .flagNotFound
            )
        }
        guard let value = transform(flag.value) else {
            return ProviderEvaluation(
                value: defaultValue,
                variant: flag.variant,
                reason: Reason.defaultReason.rawValue,
                errorCode: .typeMismatch
            )
        }
        return ProviderEvaluation(
            value: value,
            variant: flag.variant,
            reason: Reason.targetingMatch.rawValue
        )
    }
}
