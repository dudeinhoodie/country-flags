import Foundation
import Security

import CountryFlagsDomain

/// Keeps session secrets in the keychain and nowhere else.
///
/// The accessibility class is `afterFirstUnlock` rather than `whenUnlocked`:
/// a background sync started by the system has to be able to present a token
/// while the device is locked. `ThisDeviceOnly` keeps the secrets out of an
/// encrypted backup restored onto another device.
public struct KeychainTokenStore: SecureTokenStoring {
    private let service: String

    public init(service: String = "app.countryflags.session") {
        self.service = service
    }

    /// `CFString` is not `Sendable`, so the constant is read where it is used
    /// rather than stored on the value.
    private var accessible: CFString {
        kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    }

    public func value(for kind: SecureTokenKind) async throws -> String? {
        var query = baseQuery(for: kind)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
                throw SecureTokenStoreError.invalidData
            }
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
            kSecAttrAccessible as String: accessible,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var insert = query
            insert.merge(attributes) { _, new in new }
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
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
