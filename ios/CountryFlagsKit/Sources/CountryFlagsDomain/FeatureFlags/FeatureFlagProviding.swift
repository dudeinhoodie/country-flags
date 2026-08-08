import Foundation

/// How feature code reads a flag.
///
/// The reading side is synchronous and total: there is always a value, because
/// every key carries a bundled default. Nothing here mentions a control plane,
/// so the vendor behind the values can change without touching a feature.
public protocol FeatureFlagProviding: Sendable {
    func boolValue(for key: BooleanFeatureFlag) -> Bool
    func stringValue(for key: StringFeatureFlag) -> String
    func numberValue(for key: NumberFeatureFlag) -> Double

    /// Points the evaluation at another account and fetches its configuration.
    /// Never blocks a screen: the caller keeps the values it already has until
    /// this returns.
    func refresh(context: FeatureFlagContext) async

    /// Freezes the session-scoped keys.
    ///
    /// A study session stores the result and reads from it, which is what keeps
    /// a refresh from rewriting a session that is already running.
    func sessionSnapshot() -> FeatureFlagSessionSnapshot
}

/// The bundled registry and nothing else.
///
/// This is the value of every flag before the first snapshot arrives, the
/// provider used by a build that never talks to a backend, and the substitute a
/// test starts from.
public struct BundledFeatureFlagProvider: FeatureFlagProviding {
    /// Values a test or a debug build overrides. Production composition leaves
    /// it empty.
    private let overrides: [String: FeatureFlagValue]

    public init(overrides: [String: FeatureFlagValue] = [:]) {
        self.overrides = overrides
    }

    public func boolValue(for key: BooleanFeatureFlag) -> Bool {
        guard case .boolean(let value)? = overrides[key.key] else { return key.defaultValue }
        return value
    }

    public func stringValue(for key: StringFeatureFlag) -> String {
        guard case .string(let value)? = overrides[key.key], key.accepts(value) else {
            return key.defaultValue
        }
        return value
    }

    public func numberValue(for key: NumberFeatureFlag) -> Double {
        guard case .number(let value)? = overrides[key.key], key.accepts(value) else {
            return key.defaultValue
        }
        return value
    }

    public func refresh(context: FeatureFlagContext) async {}

    public func sessionSnapshot() -> FeatureFlagSessionSnapshot {
        FeatureFlagSessionSnapshot(
            configVersion: nil,
            values: Dictionary(
                uniqueKeysWithValues: FeatureFlagRegistry.definitions
                    .filter { $0.activationPolicy == .nextSession }
                    .map { ($0.key, overrides[$0.key] ?? $0.defaultValue) }
            )
        )
    }
}
