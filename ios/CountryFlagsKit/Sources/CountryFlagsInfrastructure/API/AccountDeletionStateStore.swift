import Foundation

import CountryFlagsDomain

/// Remembers that a deletion is under way, across the sign-out it causes and
/// across the launch after it.
///
/// `UserDefaults` rather than the keychain or the store: what is kept is two
/// dates and nothing else — no identifier, no token, nothing that says whose
/// account it was — and both of the other places are cleared by the very
/// deletion this has to outlive.
public struct UserDefaultsAccountDeletionStateStore: AccountDeletionStateStoring, @unchecked Sendable
{
    private static let requestedKey = "account.deletion.requestedAt"
    private static let expectedKey = "account.deletion.expectedCompletionAt"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func pendingDeletion() -> AccountDeletionRecord? {
        guard let requestedAt = defaults.object(forKey: Self.requestedKey) as? Date,
            let expectedCompletionAt = defaults.object(forKey: Self.expectedKey) as? Date
        else {
            return nil
        }
        return AccountDeletionRecord(
            requestedAt: requestedAt,
            expectedCompletionAt: expectedCompletionAt
        )
    }

    public func store(pendingDeletion: AccountDeletionRecord?) {
        guard let pendingDeletion else {
            defaults.removeObject(forKey: Self.requestedKey)
            defaults.removeObject(forKey: Self.expectedKey)
            return
        }
        defaults.set(pendingDeletion.requestedAt, forKey: Self.requestedKey)
        defaults.set(pendingDeletion.expectedCompletionAt, forKey: Self.expectedKey)
    }
}
