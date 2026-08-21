import Foundation
import SwiftData

/// Version 2 of the local store: a learning card carries the facts printed on
/// its back.
///
/// The change is additive — one property with a default on
/// `StoredLearningCard` — so the stage is lightweight. It is also why this
/// version lists its models itself rather than borrowing version 1's: the two
/// lists differ by exactly that card, and a version that borrowed the other's
/// would describe the same store under two numbers, which Core Data rejects
/// as a migration between versions it cannot tell apart.
///
/// A version that changes the shape of an existing property, or moves data
/// between models, cannot be expressed as a lightweight stage and will need
/// its own frozen copies and a custom one.
enum LocalSchemaV2: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(2, 0, 0) }

    static var models: [any PersistentModel.Type] {
        [
            StoredContentManifest.self,
            StoredContentStagingState.self,
            StoredGeoEntity.self,
            StoredGeoName.self,
            StoredAsset.self,
            StoredFact.self,
            StoredDeck.self,
            // The one type this version changes; everything else is shared with
            // version 1, which is what makes the difference between them legible.
            StoredLearningCard.self,
            StoredDeckCard.self,
            StoredUserSettings.self,
            StoredCardState.self,
            LocalSchemaV1.StoredDeckProgress.self,
            StoredAchievement.self,
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
