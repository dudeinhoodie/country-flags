import Foundation
import SwiftData

/// Version 5 of the local store: a fact keeps its parts beside the line the
/// backend composed.
///
/// One property with a default on a model that already existed — a blob, so
/// no type changes and nothing renamed — which makes the stage lightweight
/// and carries a device's unsynchronized outbox across the update. A store
/// written before this holds nil there, and a fact with no parts is shown as
/// the line it arrived as, which is what every release did until now.
///
/// This version lists the live `StoredGeoEntity` and `StoredFact`, the pair
/// the repositories write. Versions 1 to 4 list the frozen copies in
/// `LocalSchemaV1`: a property added to a shared type would otherwise appear
/// in every version at once, leaving them describing the same store. The
/// entity is frozen alongside the fact because it owns the relationship to
/// it, and a version cannot describe one half of a pair.
enum LocalSchemaV5: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(5, 0, 0) }

    static var models: [any PersistentModel.Type] {
        [
            StoredContentManifest.self,
            StoredContentStagingState.self,
            // The two types this version changes; everything else is version
            // four's.
            StoredGeoEntity.self,
            StoredFact.self,
            StoredGeoName.self,
            StoredAsset.self,
            StoredDeck.self,
            StoredLearningCard.self,
            StoredDeckCard.self,
            StoredUserSettings.self,
            StoredCardState.self,
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
