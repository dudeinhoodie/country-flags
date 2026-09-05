import Foundation
import SwiftData

/// Version 6 of the local store: a deck says what opens it, an entity says
/// what it belongs to, an asset says which drawing it is, and a purchase
/// survives the launch it was made in.
///
/// Everything the stage adds has a default or is a model of its own, so it is
/// lightweight: SwiftData widens the tables it already has and creates the
/// three new ones, and a device carries its unsynchronized outbox and its
/// unfinished session across the update untouched. That is the whole point of
/// the plan — an app update must never resolve a schema change by discarding
/// the store.
///
/// What it changes, and why the store had nowhere to put it:
///
/// - `StoredDeck` gains `accessModel`, `requiredEntitlementKey`, `offerCodes`,
///   `contentKinds` and the identifiers of its preview cards. Every deck that
///   already exists reads as `FREE`, which is what every deck published so far
///   is.
/// - `StoredGeoEntity` gains the parent an administrative unit names and the
///   codes that identify one, so a U.S. state can be stored as a subdivision
///   rather than as a country with a strange name.
/// - `StoredAsset` gains its variant and the name and description of the
///   drawing itself, so one entity can hold a flag and a coat of arms at once
///   and each can be labelled.
/// - `StoredEntitlement`, `StoredPurchaseDelivery` and `StoredCommerceOffer`
///   are new. The delivery queue is the reason this is a migration and not a
///   cache: a verified transaction that lived only in memory would be a
///   purchase the customer paid for and the backend never heard about.
///
/// This version lists the live entity graph and the live deck. Versions 1 to 5
/// list the frozen copies in `LocalSchemaV1` and `LocalSchemaV5`: a property
/// added to a shared type would otherwise appear in every version at once,
/// leaving them describing the same store and the migration impossible to
/// stage.
enum LocalSchemaV6: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(6, 0, 0) }

    static var models: [any PersistentModel.Type] {
        [
            StoredContentManifest.self,
            StoredContentStagingState.self,
            // The three content types this version changes, and the two frozen
            // with them because the entity owns the relationships.
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
            StoredDueSummary.self,
            StoredStudySession.self,
            StoredStudySessionCard.self,
            StoredReviewEvent.self,
            StoredOutboxOperation.self,
            StoredSyncCursor.self,
            StoredAnalyticsEvent.self,
            StoredPrivacySettings.self,
            StoredPendingDiagnosticReport.self,
            // What this version adds.
            StoredEntitlement.self,
            StoredPurchaseDelivery.self,
            StoredCommerceOffer.self,
        ]
    }
}
