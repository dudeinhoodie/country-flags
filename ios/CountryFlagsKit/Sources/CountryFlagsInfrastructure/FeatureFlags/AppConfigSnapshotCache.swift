import Foundation
import os

import CountryFlagsDomain

/// Keeps the last accepted snapshot between launches.
public protocol AppConfigSnapshotCaching: Sendable {
    func snapshot(for scopeKey: String) -> AppConfigSnapshot?
    func store(_ snapshot: AppConfigSnapshot)
    /// Called when an account's data is erased, so its configuration goes with
    /// it rather than being handed to whoever signs in next.
    func removeSnapshot(for scopeKey: String)
}

/// The default cache.
///
/// `UserDefaults` is allowed here because the snapshot is not secret: the
/// backend evaluates the targeting rules and sends results, so the file holds
/// flag values, a version and two timestamps. Tokens and personal data are not
/// part of the type and could not be written even by mistake.
///
/// One entry per account scope. A shared entry would let the values evaluated
/// for one account answer questions asked by another.
///
/// The `Sendable` conformance is unchecked because `UserDefaults` predates the
/// annotation. Apple documents it as thread-safe, and the only stored property
/// here is that instance.
public struct UserDefaultsAppConfigCache: AppConfigSnapshotCaching, @unchecked Sendable {
    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func snapshot(for scopeKey: String) -> AppConfigSnapshot? {
        guard let data = defaults.data(forKey: Self.storageKey(for: scopeKey)),
            let snapshot = try? decoder.decode(AppConfigSnapshot.self, from: data)
        else {
            return nil
        }
        // A restored snapshot is never "remote": the distinction is what the
        // resolver reports as the source, and a stored copy is a cached one no
        // matter how it arrived.
        guard snapshot.scopeKey == scopeKey else { return nil }
        return snapshot.withOrigin(.cache)
    }

    public func store(_ snapshot: AppConfigSnapshot) {
        guard let data = try? encoder.encode(snapshot) else { return }
        defaults.set(data, forKey: Self.storageKey(for: snapshot.scopeKey))
    }

    public func removeSnapshot(for scopeKey: String) {
        defaults.removeObject(forKey: Self.storageKey(for: scopeKey))
    }

    static func storageKey(for scopeKey: String) -> String {
        "app.countryflags.appConfig.\(scopeKey)"
    }
}

/// The cache used when nothing should survive the process, such as in a test
/// or in a build that must start from a known state.
public final class InMemoryAppConfigCache: AppConfigSnapshotCaching {
    private let storage = OSAllocatedUnfairLock<[String: AppConfigSnapshot]>(initialState: [:])

    public init() {}

    public func snapshot(for scopeKey: String) -> AppConfigSnapshot? {
        storage.withLock { $0[scopeKey]?.withOrigin(.cache) }
    }

    public func store(_ snapshot: AppConfigSnapshot) {
        storage.withLock { $0[snapshot.scopeKey] = snapshot }
    }

    public func removeSnapshot(for scopeKey: String) {
        storage.withLock { $0[scopeKey] = nil }
    }
}
