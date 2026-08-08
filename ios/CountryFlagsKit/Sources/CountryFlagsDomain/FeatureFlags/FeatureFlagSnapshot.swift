import Foundation

/// One flag as the backend evaluated it.
public struct EvaluatedFeatureFlag: Hashable, Sendable, Codable {
    public let value: FeatureFlagValue
    /// Names the branch that was chosen. An experiment exposure reports it, so
    /// an outcome can be attributed without any personal data.
    public let variant: String
    public let activationPolicy: FeatureFlagActivationPolicy

    public init(
        value: FeatureFlagValue,
        variant: String,
        activationPolicy: FeatureFlagActivationPolicy
    ) {
        self.value = value
        self.variant = variant
        self.activationPolicy = activationPolicy
    }
}

/// The evaluated configuration of one account context at one moment.
///
/// Nothing here is secret: it holds evaluated values, not targeting rules, and
/// no identifier beyond the opaque context key. That is what makes it safe to
/// keep in `UserDefaults` for the next cold launch.
public struct FeatureFlagSnapshot: Hashable, Sendable, Codable {
    public let configVersion: String
    /// The context this was evaluated for. A snapshot is never applied to a
    /// different account: signing in must not keep answering with the guest's
    /// configuration.
    public let contextKey: String
    public let fetchedAt: Date
    public let expiresAt: Date
    public let flags: [String: EvaluatedFeatureFlag]
    /// The validator replayed as `If-None-Match`, so a refresh that changed
    /// nothing costs one `304` instead of a full snapshot.
    public let entityTag: String?

    public init(
        configVersion: String,
        contextKey: String,
        fetchedAt: Date,
        expiresAt: Date,
        flags: [String: EvaluatedFeatureFlag],
        entityTag: String? = nil
    ) {
        self.configVersion = configVersion
        self.contextKey = contextKey
        self.fetchedAt = fetchedAt
        self.expiresAt = expiresAt
        self.flags = flags
        self.entityTag = entityTag
    }

    public func isFresh(at instant: Date) -> Bool {
        instant < expiresAt
    }

    public func belongs(to context: FeatureFlagContext) -> Bool {
        contextKey == context.cacheKey
    }

    /// Applies a `304`: the backend confirmed the values are still current, so
    /// only the freshness window moves.
    public func revalidated(at instant: Date, expiresAt newExpiry: Date) -> FeatureFlagSnapshot {
        FeatureFlagSnapshot(
            configVersion: configVersion,
            contextKey: contextKey,
            fetchedAt: instant,
            expiresAt: newExpiry,
            flags: flags,
            entityTag: entityTag
        )
    }

    /// The value for a key, or `nil` when the snapshot does not carry it or
    /// carries it with another type. Both cases mean the caller keeps its
    /// bundled default.
    public func value<Key: FeatureFlagKey>(for key: Key) -> FeatureFlagValue? {
        flags[key.key]?.value
    }
}

/// The flags a study session started with.
///
/// A session-scoped flag is read from here for as long as the session lasts, so
/// a refresh in the middle cannot change its mode, its card set or its
/// interface. The values are stored by key because the session outlives the
/// process that created it.
public struct FeatureFlagSessionSnapshot: Hashable, Sendable, Codable {
    /// Which configuration the session was created under. An exposure reports
    /// it so an outcome can be tied to the values that were actually in force.
    public let configVersion: String?
    public let values: [String: FeatureFlagValue]

    public init(configVersion: String?, values: [String: FeatureFlagValue]) {
        self.configVersion = configVersion
        self.values = values
    }

    public func boolValue(for key: BooleanFeatureFlag) -> Bool {
        guard case .boolean(let value)? = values[key.key] else { return key.defaultValue }
        return value
    }

    public func stringValue(for key: StringFeatureFlag) -> String {
        guard case .string(let value)? = values[key.key], key.accepts(value) else {
            return key.defaultValue
        }
        return value
    }

    public func numberValue(for key: NumberFeatureFlag) -> Double {
        guard case .number(let value)? = values[key.key], key.accepts(value) else {
            return key.defaultValue
        }
        return value
    }
}
