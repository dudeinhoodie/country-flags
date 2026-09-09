import Foundation

import CountryFlagsDomain

/// A relaunch-safe token store for the unsigned Mock app.
///
/// UI tests build without signing, so the simulator does not give that build
/// a reliable keychain identity. Persisting the fixture session in the Mock
/// app's defaults lets CI exercise session restoration without weakening the
/// shipping app, which does not link this module and continues to use the
/// keychain exclusively.
public struct MockPersistentTokenStore: SecureTokenStoring, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func value(for kind: SecureTokenKind) async throws -> String? {
        defaults.string(forKey: Self.key(kind))
    }

    public func setValue(_ value: String?, for kind: SecureTokenKind) async throws {
        if let value {
            defaults.set(value, forKey: Self.key(kind))
        } else {
            defaults.removeObject(forKey: Self.key(kind))
        }
    }

    public func removeAll() async throws {
        for kind in SecureTokenKind.allCases {
            defaults.removeObject(forKey: Self.key(kind))
        }
    }

    private static func key(_ kind: SecureTokenKind) -> String {
        "countryflags.mock.session.\(kind.rawValue)"
    }
}
