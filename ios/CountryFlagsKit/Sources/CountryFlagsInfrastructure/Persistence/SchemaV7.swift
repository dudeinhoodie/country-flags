import Foundation
import SwiftData

/// Version 7 of the local store: the due summary says when the next portion
/// opens.
///
/// ADR-022 made three hours the rhythm of the scheduler, and the backend now
/// reports the instant that rhythm comes round again. Home reads it from the
/// store rather than from the last response, because the store is what a cold
/// launch has — so the instant has to live here or the screen would only ever
/// know about it while the network happened to be answering.
///
/// One added property with a default on a model versions 3 to 6 froze, so this
/// is lightweight: SwiftData widens the table it already has, and a device
/// carries its unsynchronized outbox and its unfinished session across the
/// update untouched. A summary stored before this reads as nil, which is the
/// same thing the backend says when a portion is open now.
enum LocalSchemaV7: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(7, 0, 0) }

    static var models: [any PersistentModel.Type] {
        [
            StoredContentManifest.self,
            StoredContentStagingState.self,
            StoredGeoEntity.self,
            StoredAsset.self,
            StoredDeck.self,
            StoredFact.self,
            StoredGeoName.self,
            StoredLearningCard.self,
            StoredDeckCard.self,
            StoredUserSettings.self,
            StoredCardState.self,
            StoredDeckProgress.self,
            StoredAchievement.self,
            // The one type this version changes.
            StoredDueSummary.self,
            StoredStudySession.self,
            StoredStudySessionCard.self,
            StoredReviewEvent.self,
            StoredOutboxOperation.self,
            StoredSyncCursor.self,
            StoredAnalyticsEvent.self,
            StoredPrivacySettings.self,
            StoredPendingDiagnosticReport.self,
            StoredEntitlement.self,
            StoredPurchaseDelivery.self,
            StoredCommerceOffer.self,
        ]
    }
}
