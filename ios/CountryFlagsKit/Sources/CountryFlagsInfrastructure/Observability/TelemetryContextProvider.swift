import Foundation

import CountryFlagsDomain

/// Where the anonymous analytics identifier lives between launches.
///
/// `UserDefaults` rather than the keychain: it identifies nobody on its own,
/// and it must be erasable — signing out has to end the trail that was being
/// attributed to whoever left, which a keychain entry surviving a reinstall
/// would quietly defeat.
public struct UserDefaultsTelemetryIdentityStore: TelemetryIdentityStoring, @unchecked Sendable {
    private static let key = "telemetry.anonymousId"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func anonymousID() -> String? {
        guard let value = defaults.string(forKey: Self.key), !value.isEmpty else { return nil }
        return value
    }

    public func store(anonymousID: String) {
        defaults.set(anonymousID, forKey: Self.key)
    }

    public func clearAnonymousID() {
        defaults.removeObject(forKey: Self.key)
    }
}

/// Assembles the context every event carries.
///
/// The session identifier is drawn once per app run and never persisted: it
/// groups the events of one sitting without being a second, longer-lived
/// identifier. The anonymous identifier is the opposite — it survives launches
/// so a funnel is not cut in half — and both are rotated together when the
/// identified context is cleared.
public actor TelemetryContextProvider {
    private let identityStore: any TelemetryIdentityStoring
    private let identifiers: any IdentifierProviding
    private let appVersion: String
    private let build: String
    private let locale: String

    private var sessionID: String
    private var featureConfigVersion: String?

    public init(
        identityStore: any TelemetryIdentityStoring,
        identifiers: any IdentifierProviding,
        appVersion: String,
        build: String,
        locale: String
    ) {
        self.identityStore = identityStore
        self.identifiers = identifiers
        self.appVersion = appVersion
        self.build = build
        self.locale = locale
        // The schema asks for at least eight characters; a UUID's hex is
        // comfortably inside that and carries nothing about the device.
        sessionID = identifiers.next().uuidString
    }

    /// The configuration the flags were resolved from, so an exposure can be
    /// read against the snapshot that produced it.
    public func adopt(featureConfigVersion version: String?) {
        featureConfigVersion = version
    }

    public func context() -> TelemetryContext {
        TelemetryContext(
            anonymousID: currentAnonymousID(),
            sessionID: sessionID,
            appVersion: appVersion,
            build: build,
            locale: locale,
            featureConfigVersion: featureConfigVersion
        )
    }

    /// Ends the identified context: the identifier a signed-out person's events
    /// were attributed to is discarded, and the next event starts a new one.
    /// Called on sign-out and on account deletion.
    public func rotateIdentity() {
        identityStore.clearAnonymousID()
        sessionID = identifiers.next().uuidString
    }

    private func currentAnonymousID() -> String {
        if let stored = identityStore.anonymousID() { return stored }
        // Two UUIDs' worth of hex: the schema's floor is sixteen characters,
        // and one identifier that outlives launches deserves the room.
        let minted = identifiers.next().uuidString + identifiers.next().uuidString
        identityStore.store(anonymousID: minted)
        return minted
    }
}
