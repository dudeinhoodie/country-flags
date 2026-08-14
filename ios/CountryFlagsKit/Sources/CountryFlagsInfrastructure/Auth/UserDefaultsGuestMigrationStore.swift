import Foundation

import CountryFlagsDomain

/// Keeps the migration record in `UserDefaults`.
///
/// Deliberately not the keychain: the record holds no secret — a migration
/// identifier, a scope key and an owner — and what it protects against is a
/// retry inventing a second identifier or a second account quietly inheriting
/// a first account's archive. Losing it on reinstall is acceptable; the
/// backend's own idempotency by review UUID is the deeper net.
public struct UserDefaultsGuestMigrationStore: GuestMigrationRecordStoring {
    // UserDefaults is documented thread-safe; the annotation states what the
    // type cannot.
    private nonisolated(unsafe) let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func record(forScopeKey scopeKey: String) async -> GuestMigrationRecord? {
        guard let data = defaults.data(forKey: Self.key(scopeKey)) else { return nil }
        return try? Self.decoder.decode(GuestMigrationRecord.self, from: data)
    }

    public func save(_ record: GuestMigrationRecord) async {
        guard let data = try? Self.encoder.encode(record) else { return }
        defaults.set(data, forKey: Self.key(record.sourceScopeKey))
    }

    /// Keyed by scope, not by a single slot: a device that has hosted two
    /// guests keeps the history of both, which is exactly what the ownership
    /// check needs.
    private static func key(_ scopeKey: String) -> String {
        "guest-migration.\(scopeKey)"
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

/// Describes this installation when a session is created.
///
/// The identifier is the installation identifier the guest scope already
/// lives under — generated once, kept in the keychain — so the sessions a
/// device makes before and after signing in are attributed to one device
/// rather than to a parade of them.
public struct InstallationDeviceRegistration: DeviceRegistrationProviding {
    private let tokens: any SecureTokenStoring
    private let identifiers: any IdentifierProviding
    private let appVersion: String

    public init(
        tokens: any SecureTokenStoring,
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        appVersion: String
    ) {
        self.tokens = tokens
        self.identifiers = identifiers
        self.appVersion = appVersion
    }

    public func registration() async -> DeviceRegistrationRecord {
        DeviceRegistrationRecord(
            clientGeneratedID: await installationID(),
            appVersion: appVersion,
            locale: Locale.current.identifier,
            timezone: TimeZone.current.identifier
        )
    }

    private func installationID() async -> String {
        if let stored = try? await tokens.value(for: .installationID), !stored.isEmpty {
            return stored.lowercased()
        }
        // The same first-write the guest scope performs; whichever of the two
        // runs first, the other reads what it stored.
        let identifier = identifiers.next().uuidString.lowercased()
        try? await tokens.setValue(identifier, for: .installationID)
        return identifier
    }
}
