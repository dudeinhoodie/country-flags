import CryptoKit
import Foundation

/// The attributes a flag may be evaluated against.
///
/// The type has no field for an email, a provider subject, a display name, a
/// token or a location, so a forbidden attribute cannot reach the evaluation
/// by accident. Targeting itself happens on the backend: the app receives an
/// already evaluated snapshot and never learns the rules.
public struct FeatureFlagContext: Hashable, Sendable {
    /// Stable and opaque. It is a service-scoped hash of the account scope, so
    /// a percentage rollout is stable for one person while the internal user
    /// identifier never leaves the device.
    public let targetingKey: String
    public let environment: AppEnvironment
    public let platform: String
    public let appVersion: String
    public let build: String
    /// BCP 47.
    public let locale: String
    public let isAuthenticated: Bool

    public init(
        scope: AccountScope,
        environment: AppEnvironment,
        platform: String = "ios",
        appVersion: String,
        build: String,
        locale: String
    ) {
        self.targetingKey = Self.targetingKey(for: scope)
        self.environment = environment
        self.platform = platform
        self.appVersion = appVersion
        self.build = build
        self.locale = locale
        self.isAuthenticated = !scope.isGuest
    }

    /// The allowlisted attributes, ready for an evaluation context.
    ///
    /// Building the dictionary here rather than at each call site is what keeps
    /// the allowlist enforceable: there is one place that decides what an
    /// evaluation is allowed to see.
    public var attributes: [String: String] {
        [
            "environment": environment.rawValue,
            "platform": platform,
            "appVersion": appVersion,
            "build": build,
            "locale": locale,
            "authenticated": isAuthenticated ? "true" : "false",
        ]
    }

    /// Separates one account's cached snapshot from another's.
    public var cacheKey: String { targetingKey }

    /// Domain separation keeps this hash unusable as a correlation key for any
    /// other subsystem that might hash the same scope later.
    private static let hashDomain = "app.countryflags.feature-flags.v1:"

    private static func targetingKey(for scope: AccountScope) -> String {
        let digest = SHA256.hash(data: Data((hashDomain + scope.key).utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
