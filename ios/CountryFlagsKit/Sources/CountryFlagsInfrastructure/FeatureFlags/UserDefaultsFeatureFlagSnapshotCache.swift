import Foundation

import CountryFlagsDomain

/// Keeps the last snapshot of each account context in `UserDefaults`.
///
/// A snapshot holds evaluated values, timestamps and an opaque context key —
/// no token, no identifier and no targeting rule — which is what makes this
/// store acceptable. Secrets live in the keychain and progress lives in
/// SwiftData; neither belongs here.
///
/// One entry per context key keeps a guest and an account from reading each
/// other's configuration on a shared device.
///
/// `@unchecked Sendable` covers `UserDefaults`, which is documented as thread
/// safe but predates the annotation.
public struct UserDefaultsFeatureFlagSnapshotCache: FeatureFlagSnapshotCaching, @unchecked Sendable {
    private let defaults: UserDefaults
    private let keyPrefix: String

    public init(defaults: UserDefaults = .standard, keyPrefix: String = "featureFlags.snapshot.") {
        self.defaults = defaults
        self.keyPrefix = keyPrefix
    }

    public func snapshot(forContextKey contextKey: String) -> FeatureFlagSnapshot? {
        guard let data = defaults.data(forKey: storageKey(contextKey)) else { return nil }
        // A snapshot written by an older build may no longer decode. Dropping
        // it is safe: the bundled defaults answer until the next refresh.
        guard let snapshot = try? Self.decoder.decode(FeatureFlagSnapshot.self, from: data) else {
            defaults.removeObject(forKey: storageKey(contextKey))
            return nil
        }
        // A snapshot filed under another context is not evidence about this
        // one, whatever it says inside.
        guard snapshot.contextKey == contextKey else { return nil }
        return snapshot
    }

    public func store(_ snapshot: FeatureFlagSnapshot) {
        guard let data = try? Self.encoder.encode(snapshot) else { return }
        defaults.set(data, forKey: storageKey(snapshot.contextKey))
    }

    public func removeSnapshot(forContextKey contextKey: String) {
        defaults.removeObject(forKey: storageKey(contextKey))
    }

    private func storageKey(_ contextKey: String) -> String {
        keyPrefix + contextKey
    }

    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()
}
