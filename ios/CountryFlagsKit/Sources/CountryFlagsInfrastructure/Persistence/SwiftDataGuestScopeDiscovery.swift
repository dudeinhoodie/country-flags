import Foundation
import SwiftData

import CountryFlagsDomain

/// Reads which guests own a learner's records in the store.
///
/// A learner's records are what they studied and how they set the app up:
/// card states, reviews, sessions, the upload queue, deck progress and
/// settings. Telemetry and commerce rows do not count. A consent answer or a
/// queued event is not progress, and a guest owns no purchases.
///
/// It reads every row of those tables. That is affordable because it runs
/// only when the keychain holds no installation identifier, which is a first
/// launch with an empty store or a phone restored from a backup.
@ModelActor
actor SwiftDataGuestScopeDiscovery: GuestScopeDiscovering {
    func guestScopesWithWork() async throws -> Set<AccountScope> {
        var keys = Set<String>()
        keys.formUnion(try scopeKeys(of: StoredCardState.self))
        keys.formUnion(try scopeKeys(of: StoredReviewEvent.self))
        keys.formUnion(try scopeKeys(of: StoredStudySession.self))
        keys.formUnion(try scopeKeys(of: StoredOutboxOperation.self))
        keys.formUnion(try scopeKeys(of: StoredDeckProgress.self))
        keys.formUnion(try scopeKeys(of: StoredUserSettings.self))
        return Set(keys.compactMap(AccountScope.init(key:)).filter(\.isGuest))
    }

    private func scopeKeys<Model: PersistentModel & ScopedModel>(
        of type: Model.Type
    ) throws -> Set<String> {
        Set(try modelContext.fetch(FetchDescriptor<Model>()).map(\.scopeKey))
    }
}
