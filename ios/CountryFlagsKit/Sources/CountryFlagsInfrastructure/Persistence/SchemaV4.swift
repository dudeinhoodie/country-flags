import Foundation
import SwiftData

/// Version 4 of the local store: a deck's progress keeps the backend's own
/// count of cards still settling.
///
/// One property with a default on a model that already existed — no type
/// changes, nothing renamed — so the stage is lightweight and a device carries
/// its unsynchronized outbox across the update untouched. The number is filled
/// by the next sync; until then it is zero, which reads as "nothing in flight"
/// rather than as a wrong answer.
///
/// This version lists the live `StoredDeckProgress`, the one the repositories
/// write. Versions 1 to 3 list the frozen copy in `LocalSchemaV1` instead: a
/// property added to a shared type would otherwise appear in every version at
/// once, leaving them describing the same store.
enum LocalSchemaV4: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(4, 0, 0) }

    static var models: [any PersistentModel.Type] {
        [
            StoredContentManifest.self,
            StoredContentStagingState.self,
            StoredGeoEntity.self,
            StoredGeoName.self,
            StoredAsset.self,
            StoredFact.self,
            StoredDeck.self,
            StoredLearningCard.self,
            StoredDeckCard.self,
            StoredUserSettings.self,
            StoredCardState.self,
            // The one type this version changes; everything else is version 3's.
            StoredDeckProgress.self,
            StoredAchievement.self,
            StoredDueSummary.self,
            StoredStudySession.self,
            StoredStudySessionCard.self,
            StoredReviewEvent.self,
            StoredOutboxOperation.self,
            StoredSyncCursor.self,
            StoredAnalyticsEvent.self,
            StoredPrivacySettings.self,
            StoredPendingDiagnosticReport.self,
        ]
    }
}
