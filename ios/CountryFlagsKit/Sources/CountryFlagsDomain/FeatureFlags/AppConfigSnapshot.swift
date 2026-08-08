import Foundation

/// One flag as the backend evaluated it.
public struct EvaluatedFeatureFlag: Hashable, Sendable, Codable {
    public let value: FeatureFlagValue
    /// The name of the chosen variation. An experiment reports it with the
    /// exposure event; a boolean flag usually reports `enabled`/`disabled`.
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

/// Whether a client build may still talk to the backend.
public struct ClientVersionPolicy: Hashable, Sendable, Codable {
    public enum UpdateMode: String, Hashable, Sendable, Codable {
        case none = "NONE"
        case soft = "SOFT"
        case forced = "FORCED"
    }

    public let minimumSupported: String
    public let latest: String
    public let updateMode: UpdateMode

    public init(minimumSupported: String, latest: String, updateMode: UpdateMode) {
        self.minimumSupported = minimumSupported
        self.latest = latest
        self.updateMode = updateMode
    }
}

/// The evaluated configuration of one account context.
///
/// The snapshot is cached between launches, so it is a plain `Codable` value
/// with no reference to the response it was decoded from. Nothing here is
/// secret: the backend evaluates the rules and sends results only, which is why
/// the cache may live in `UserDefaults`.
public struct AppConfigSnapshot: Hashable, Sendable, Codable {
    /// Where this copy came from, which is all that separates a snapshot
    /// received during this run from the one restored at launch.
    public enum Origin: String, Hashable, Sendable, Codable {
        case remote
        case cache
    }

    public let configVersion: String
    public let generatedAt: Date
    public let expiresAt: Date
    public let fetchedAt: Date
    /// The account the snapshot was evaluated for. A snapshot is never read
    /// under another scope: two accounts on one device can be targeted
    /// differently, and showing one person the other's configuration would be a
    /// leak of their targeting.
    public let scopeKey: String
    /// The entity tag the response carried, replayed as `If-None-Match`.
    public let entityTag: String?
    public let contentVersion: String
    public let supportedTemplateSchemaVersions: [Int]
    public let clientVersionPolicy: ClientVersionPolicy
    /// Only keys this build knows, already checked against the registry.
    public let flags: [String: EvaluatedFeatureFlag]
    public let advertising: AdvertisingPolicy
    public let origin: Origin

    public init(
        configVersion: String,
        generatedAt: Date,
        expiresAt: Date,
        fetchedAt: Date,
        scopeKey: String,
        entityTag: String?,
        contentVersion: String,
        supportedTemplateSchemaVersions: [Int],
        clientVersionPolicy: ClientVersionPolicy,
        flags: [String: EvaluatedFeatureFlag],
        advertising: AdvertisingPolicy,
        origin: Origin
    ) {
        self.configVersion = configVersion
        self.generatedAt = generatedAt
        self.expiresAt = expiresAt
        self.fetchedAt = fetchedAt
        self.scopeKey = scopeKey
        self.entityTag = entityTag
        self.contentVersion = contentVersion
        self.supportedTemplateSchemaVersions = supportedTemplateSchemaVersions
        self.clientVersionPolicy = clientVersionPolicy
        self.flags = flags
        self.advertising = advertising
        self.origin = origin
    }

    /// A snapshot past its expiry is not served.
    ///
    /// The alternative — keeping stale values until a refresh succeeds — would
    /// let a device that stays offline run a killed feature indefinitely. The
    /// bundled defaults are chosen to be safe on their own, so falling back to
    /// them is the cheaper failure.
    public func isFresh(at instant: Date) -> Bool {
        instant < expiresAt
    }

    /// Starts the lifetime again after the server confirmed the copy is
    /// current. The new expiry keeps the lifetime the snapshot was issued with,
    /// so a `304` cannot extend a short-lived configuration indefinitely.
    public func renewed(at instant: Date) -> AppConfigSnapshot {
        let lifetime = max(0, expiresAt.timeIntervalSince(generatedAt))
        return AppConfigSnapshot(
            configVersion: configVersion,
            generatedAt: generatedAt,
            expiresAt: instant.addingTimeInterval(lifetime),
            fetchedAt: instant,
            scopeKey: scopeKey,
            entityTag: entityTag,
            contentVersion: contentVersion,
            supportedTemplateSchemaVersions: supportedTemplateSchemaVersions,
            clientVersionPolicy: clientVersionPolicy,
            flags: flags,
            advertising: advertising,
            origin: origin
        )
    }

    public func withOrigin(_ origin: Origin) -> AppConfigSnapshot {
        AppConfigSnapshot(
            configVersion: configVersion,
            generatedAt: generatedAt,
            expiresAt: expiresAt,
            fetchedAt: fetchedAt,
            scopeKey: scopeKey,
            entityTag: entityTag,
            contentVersion: contentVersion,
            supportedTemplateSchemaVersions: supportedTemplateSchemaVersions,
            clientVersionPolicy: clientVersionPolicy,
            flags: flags,
            advertising: advertising,
            origin: origin
        )
    }
}

extension FeatureFlagValue: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case value
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(FeatureFlagValueType.self, forKey: .type)
        switch type {
        case .boolean: self = .boolean(try container.decode(Bool.self, forKey: .value))
        case .string: self = .string(try container.decode(String.self, forKey: .value))
        case .number: self = .number(try container.decode(Double.self, forKey: .value))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        switch self {
        case .boolean(let value): try container.encode(value, forKey: .value)
        case .string(let value): try container.encode(value, forKey: .value)
        case .number(let value): try container.encode(value, forKey: .value)
        }
    }
}

extension FeatureFlagValueType: Codable {}
extension FeatureFlagActivationPolicy: Codable {}
