import Foundation
import SwiftData

/// Version 3 of the local store: an account keeps the last due summary the
/// backend answered with.
///
/// The change is a new model and nothing else — no existing property moves or
/// changes shape — so the stage is lightweight and a device carries its
/// unsynchronized outbox across the update untouched. Like version 2, this
/// version lists its own models rather than borrowing the previous list, so
/// the difference between the two versions is legible in one place.
enum LocalSchemaV3: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(3, 0, 0) }

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
            StoredDeckProgress.self,
            StoredAchievement.self,
            // The one type this version adds; everything else is version 2's.
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

/// The backend's count of what is waiting, as it was when it answered.
///
/// One row per account: the summary describes the whole queue, and a second
/// row would be a second answer to the same question. `serverTime` is stored
/// with it because the row goes stale by the clock — a reader compares the two
/// rather than trusting the number to still be today's.
@Model
final class StoredDueSummary {
    var scopeKey: String = ""
    var overdue: Int = 0
    var learning: Int = 0
    var relearning: Int = 0
    var review: Int = 0
    var newCards: Int = 0
    var totalDue: Int = 0
    var serverTime: Date = Date.distantPast

    init(
        scopeKey: String,
        overdue: Int,
        learning: Int,
        relearning: Int,
        review: Int,
        newCards: Int,
        totalDue: Int,
        serverTime: Date
    ) {
        self.scopeKey = scopeKey
        self.overdue = overdue
        self.learning = learning
        self.relearning = relearning
        self.review = review
        self.newCards = newCards
        self.totalDue = totalDue
        self.serverTime = serverTime
    }
}
