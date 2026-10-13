import Foundation
import SwiftData

/// Version 8 of the local store: the due summary says how many of the due
/// cards one more correct answer makes learned.
///
/// Home's review pane says what a repeat will do (#503) — "four will become
/// learned if you remember them" — and, like the instant version 7 added, it
/// reads that from the store rather than from the last response: the store is
/// what a cold launch has, and the line would otherwise appear only while the
/// network happened to be answering.
///
/// One added optional property on a model version 7 froze, so this is
/// lightweight: SwiftData widens the table it already has, and a device
/// carries its unsynchronized outbox and its unfinished session across the
/// update untouched. A summary stored before this reads as nil, which is what
/// a backend that does not send the count says too, and the line is simply
/// absent until the next download.
enum LocalSchemaV8: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(8, 0, 0) }

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
