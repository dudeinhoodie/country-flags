import Foundation

/// A session secret.
public enum SecureTokenKind: String, Hashable, Sendable, CaseIterable {
    case accessToken
    case refreshToken
    /// Identifies the installation for a guest scope. It is not a credential,
    /// but it outlives an app reinstall only if it is kept next to them.
    case installationID
    /// The account the stored refresh token belongs to. Also not a credential:
    /// it is kept so a relaunch knows whose data to read before it has spoken
    /// to the backend, rather than asking the network who it is.
    /// What the account calls itself, for the screen alone. Not a credential
    /// either; it lives here because it belongs to the same session the
    /// tokens do and must leave with them.
    case accountUserID
    case accountDisplayName
    /// Where the account's picture lives, when a provider shared one. A URL,
    /// not an image; fetched fresh so a changed picture changes here too.
    case accountAvatarURL
    /// The backend's identifier for this device within the account, which
    /// every review event is attributed to. Learned from the device list
    /// after sign-in and discarded with the session.
    case accountDeviceID
}

/// Where session secrets live.
///
/// Tokens never enter SwiftData, UserDefaults, logs or analytics, so the store
/// is a separate boundary from the repositories rather than another table.
/// The protocol lets a test drive the session without touching the real
/// keychain.
public protocol SecureTokenStoring: Sendable {
    func value(for kind: SecureTokenKind) async throws -> String?
    func setValue(_ value: String?, for kind: SecureTokenKind) async throws
    /// Signing out removes the secrets before the account data is erased.
    func removeAll() async throws
}

public enum SecureTokenStoreError: Error, Equatable, Sendable {
    case unavailable(status: Int32)
    case invalidData
}
