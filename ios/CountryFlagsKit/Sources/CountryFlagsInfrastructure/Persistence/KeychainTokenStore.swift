import Foundation
import Security

import CountryFlagsDomain

/// Keeps session secrets in the keychain and nowhere else.
///
/// The accessibility class is `afterFirstUnlock` rather than `whenUnlocked`:
/// a background sync started by the system has to be able to present a token
/// while the device is locked. `ThisDeviceOnly` keeps the secrets out of an
/// encrypted backup restored onto another device.
///
/// The installation identifier is the one exception. It is not a secret, and
/// it is the only thing that names the guest whose progress the store holds.
/// The store moves to a new phone with the backup, so the identifier has to
/// move with it, or the guest arrives on the new phone as a stranger to their
/// own records (#446). It is still not synchronizable: a backup carries it,
/// and iCloud Keychain does not spread it to every device of the Apple ID.
public struct KeychainTokenStore: SecureTokenStoring {
    public static let defaultService = "app.countryflags.session"

    private let service: String

    public init(service: String = Self.defaultService) {
        self.service = service
    }

    /// The accessibility class each kind is stored under.
    ///
    /// `CFString` is not `Sendable`, so the constant is read where it is used
    /// rather than stored on the value.
    static func accessibility(for kind: SecureTokenKind) -> CFString {
        switch kind {
        case .installationID:
            kSecAttrAccessibleAfterFirstUnlock
        case .accessToken, .refreshToken, .accountUserID, .accountDisplayName,
            .accountAvatarURL, .accountDeviceID:
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }
    }

    public func value(for kind: SecureTokenKind) async throws -> String? {
        var query = baseQuery(for: kind)
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let attributes = item as? [String: Any],
                let data = attributes[kSecValueData as String] as? Data,
                let value = String(data: data, encoding: .utf8)
            else {
                throw SecureTokenStoreError.invalidData
            }
            upgradeAccessibility(
                of: kind,
                from: attributes[kSecAttrAccessible as String] as? String
            )
            return value
        case errSecItemNotFound:
            return nil
        default:
            throw SecureTokenStoreError.unavailable(status: status)
        }
    }

    public func setValue(_ value: String?, for kind: SecureTokenKind) async throws {
        guard let value else {
            try remove(kind)
            return
        }
        guard let data = value.data(using: .utf8) else {
            throw SecureTokenStoreError.invalidData
        }

        let query = baseQuery(for: kind)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: Self.accessibility(for: kind),
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var insert = query
            insert.merge(attributes) { _, new in new }
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
            if addStatus == errSecDuplicateItem {
                // Lost the race to a concurrent writer: between our miss and
                // our add, somebody stored the item. It exists now, so the
                // write completes as the update it would have been.
                let retryStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
                guard retryStatus == errSecSuccess else {
                    throw SecureTokenStoreError.unavailable(status: retryStatus)
                }
                return
            }
            guard addStatus == errSecSuccess else {
                throw SecureTokenStoreError.unavailable(status: addStatus)
            }
        default:
            throw SecureTokenStoreError.unavailable(status: updateStatus)
        }
    }

    /// Signing out removes every secret before the account data is erased, so
    /// a token cannot outlive the session it belonged to.
    public func removeAll() async throws {
        for kind in SecureTokenKind.allCases {
            try remove(kind)
        }
    }

    /// Moves an item written under an older class to the one its kind has
    /// now.
    ///
    /// Every installation identifier written before #446 is `ThisDeviceOnly`
    /// and would stay out of every future backup until something rewrote it.
    /// Reading is the one thing every launch does, so the move happens there.
    /// It is best effort: an item that cannot be moved today is still read,
    /// and the next launch tries again.
    private func upgradeAccessibility(of kind: SecureTokenKind, from current: String?) {
        let wanted = Self.accessibility(for: kind)
        guard current != wanted as String else { return }
        let attributes: [String: Any] = [kSecAttrAccessible as String: wanted]
        _ = SecItemUpdate(baseQuery(for: kind) as CFDictionary, attributes as CFDictionary)
    }

    private func remove(_ kind: SecureTokenKind) throws {
        let status = SecItemDelete(baseQuery(for: kind) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecureTokenStoreError.unavailable(status: status)
        }
    }

    private func baseQuery(for kind: SecureTokenKind) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: kind.rawValue,
        ]
    }
}

/// An in-memory stand-in used by tests and by previews.
///
/// It exists so a test never has to touch the real keychain, which is shared
/// state that outlives the process.
public actor InMemoryTokenStore: SecureTokenStoring {
    private var values: [SecureTokenKind: String] = [:]

    public init(values: [SecureTokenKind: String] = [:]) {
        self.values = values
    }

    public func value(for kind: SecureTokenKind) async throws -> String? {
        values[kind]
    }

    public func setValue(_ value: String?, for kind: SecureTokenKind) async throws {
        values[kind] = value
    }

    public func removeAll() async throws {
        values.removeAll()
    }
}
