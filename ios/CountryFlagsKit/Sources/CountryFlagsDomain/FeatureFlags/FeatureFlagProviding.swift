import CryptoKit
import Foundation

/// Who the flags are being evaluated for.
///
/// The allowlist of the feature flag spec: environment, platform, version,
/// locale, whether the person is signed in, and a stable opaque targeting key.
/// There is deliberately no field for an email, a provider subject or a token.
public struct FeatureFlagContext: Hashable, Sendable {
    public let scope: AccountScope
    public let environment: AppEnvironment
    public let platform: String
    public let appVersion: String
    public let locale: String
    /// Stable per account context and opaque: it is a hash, so nothing about
    /// the account can be read back out of a log line that contains it.
    public let targetingKey: String

    public init(
        scope: AccountScope,
        environment: AppEnvironment,
        platform: String = "ios",
        appVersion: String,
        locale: String
    ) {
        self.scope = scope
        self.environment = environment
        self.platform = platform
        self.appVersion = appVersion
        self.locale = locale
        self.targetingKey = Self.targetingKey(for: scope)
    }

    public var isAuthenticated: Bool {
        !scope.isGuest
    }

    /// A percentage rollout has to put the same person in the same bucket every
    /// time, so the key is derived rather than random, and salted so it cannot
    /// be correlated with an identifier used anywhere else.
    private static func targetingKey(for scope: AccountScope) -> String {
        let salted = Data("app.countryflags.feature-flags:\(scope.key)".utf8)
        return SHA256.hash(data: salted)
            .prefix(16)
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

/// How feature code reads a flag.
///
/// The methods are synchronous because a screen cannot wait for a network call
/// to decide what to draw; the value is whatever the resolution chain holds at
/// that moment, and the bundled default is always available.
public protocol FeatureFlagProviding: Sendable {
    func boolValue(for key: BooleanFeatureFlag) -> Bool
    func stringValue(for key: StringFeatureFlag) -> String
    func numberValue(for key: NumberFeatureFlag) -> Double
    /// Fetches a snapshot for the context. Never throws: a failed refresh keeps
    /// the previous answers rather than degrading the app.
    func refresh(context: FeatureFlagContext) async
}

/// Where a value came from.
public enum FeatureFlagSource: String, Hashable, Sendable {
    case remoteSnapshot
    case cachedSnapshot
    case bundledDefault
    case debugOverride
}

public struct FeatureFlagResolution: Hashable, Sendable {
    public let key: String
    public let value: FeatureFlagValue
    public let variant: String
    public let source: FeatureFlagSource
    public let activationPolicy: FeatureFlagActivationPolicy
    /// The snapshot the value came from, needed to tie an experiment exposure
    /// to the configuration that produced it.
    public let configVersion: String?

    public init(
        key: String,
        value: FeatureFlagValue,
        variant: String,
        source: FeatureFlagSource,
        activationPolicy: FeatureFlagActivationPolicy,
        configVersion: String?
    ) {
        self.key = key
        self.value = value
        self.variant = variant
        self.source = source
        self.activationPolicy = activationPolicy
        self.configVersion = configVersion
    }
}

/// The variant a bundled default reports.
public let bundledFeatureFlagVariant = "default"

/// Resolves one key against the chain the spec fixes: a fresh snapshot, then
/// the bundled default.
///
/// The type is pure, so the fallback chain is tested without a network, a
/// provider or a clock.
public struct FeatureFlagResolver: Sendable {
    public init() {}

    /// - Parameters:
    ///   - scopeKey: the account the caller is asking for. A snapshot evaluated
    ///     for a different scope is ignored: after a sign-in the previous
    ///     person's configuration is not an approximation, it is the wrong one.
    ///   - overrides: debug overrides, already filtered by build environment.
    public func resolve(
        key: String,
        snapshot: AppConfigSnapshot?,
        scopeKey: String,
        overrides: [String: FeatureFlagValue] = [:],
        at instant: Date
    ) -> FeatureFlagResolution? {
        guard let definition = FeatureFlagRegistry.definition(forKey: key) else {
            return nil
        }

        if let override = overrides[key], definition.accepts(override) {
            return FeatureFlagResolution(
                key: key,
                value: override,
                variant: FeatureFlagSource.debugOverride.rawValue,
                source: .debugOverride,
                activationPolicy: definition.activationPolicy,
                configVersion: snapshot?.configVersion
            )
        }

        if let snapshot,
            snapshot.scopeKey == scopeKey,
            snapshot.isFresh(at: instant),
            let evaluated = snapshot.flags[key],
            definition.accepts(evaluated.value)
        {
            return FeatureFlagResolution(
                key: key,
                value: evaluated.value,
                variant: evaluated.variant,
                source: snapshot.origin == .remote ? .remoteSnapshot : .cachedSnapshot,
                // The policy the client knows wins: it is the one this build
                // implements, and a snapshot cannot grant itself a faster one.
                activationPolicy: definition.activationPolicy,
                configVersion: snapshot.configVersion
            )
        }

        return FeatureFlagResolution(
            key: key,
            value: definition.defaultValue,
            variant: bundledFeatureFlagVariant,
            source: .bundledDefault,
            activationPolicy: definition.activationPolicy,
            configVersion: nil
        )
    }
}
