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
/// The entity graph and the deck are frozen here because version 6 changes
/// them: the entity gains a parent and subdivision codes, the asset a variant
/// and its own name, the deck what opens it. A version describes the store as
/// it was, so the shapes version 5 last described are copied below rather than
/// borrowed from the live models. The whole graph is frozen together because
/// the entity owns the relationships to the names, the assets and the facts,
/// and a version cannot describe one half of a pair.
enum LocalSchemaV5: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(5, 0, 0) }

    /// The deck as versions 1 to 5 stored it: without what opens it.
    ///
    /// Frozen here rather than beside version 1 because this is the version
    /// that last described this shape, which is the same reason the entity
    /// below is frozen here. Versions 1 to 4 list it too — the deck did not
    /// change between them, so one copy stands for all five.
    @Model
    final class StoredDeck {
        var id: UUID = UUID()
        var code: String = ""
        var kind: String = ""
        var name: String = ""
        var deckDescription: String = ""
        var cardCount: Int = 0
        var contentVersion: String = ""
        var sortOrder: Int = 0

        init(
            id: UUID,
            code: String,
            kind: String,
            name: String,
            deckDescription: String,
            cardCount: Int,
            contentVersion: String,
            sortOrder: Int
        ) {
            self.id = id
            self.code = code
            self.kind = kind
            self.name = name
            self.deckDescription = deckDescription
            self.cardCount = cardCount
            self.contentVersion = contentVersion
            self.sortOrder = sortOrder
        }
    }

    /// The entity as version 5 stored it: without the parent an administrative
    /// unit names and without the codes that identify one.
    @Model
    final class StoredGeoEntity {
        var id: UUID = UUID()
        var kind: String = ""
        var status: String = ""
        var recognitionStatus: String = ""
        var contentVersion: String = ""
        var isRetired: Bool = false
        @Relationship(deleteRule: .cascade, inverse: \LocalSchemaV5.StoredGeoName.entity)
        var names: [LocalSchemaV5.StoredGeoName]? = []
        @Relationship(deleteRule: .cascade, inverse: \LocalSchemaV5.StoredAsset.entity)
        var assets: [LocalSchemaV5.StoredAsset]? = []
        @Relationship(deleteRule: .cascade, inverse: \LocalSchemaV5.StoredFact.entity)
        var facts: [LocalSchemaV5.StoredFact]? = []

        init(
            id: UUID,
            kind: String,
            status: String,
            recognitionStatus: String,
            contentVersion: String,
            isRetired: Bool = false
        ) {
            self.id = id
            self.kind = kind
            self.status = status
            self.recognitionStatus = recognitionStatus
            self.contentVersion = contentVersion
            self.isRetired = isRetired
        }
    }

    @Model
    final class StoredGeoName {
        var locale: String = ""
        var value: String = ""
        var isPrimary: Bool = false
        var entity: LocalSchemaV5.StoredGeoEntity?

        init(locale: String, value: String, isPrimary: Bool) {
            self.locale = locale
            self.value = value
            self.isPrimary = isPrimary
        }
    }

    /// The asset as version 5 stored it: one drawing per type, with no variant
    /// and no name of its own.
    @Model
    final class StoredAsset {
        var id: UUID = UUID()
        var type: String = ""
        var url: URL = URL(fileURLWithPath: "/")
        var mimeType: String = ""
        var sha256: String = ""
        var contentVersion: String = ""
        var entity: LocalSchemaV5.StoredGeoEntity?

        init(
            id: UUID,
            type: String,
            url: URL,
            mimeType: String,
            sha256: String,
            contentVersion: String
        ) {
            self.id = id
            self.type = type
            self.url = url
            self.mimeType = mimeType
            self.sha256 = sha256
            self.contentVersion = contentVersion
        }
    }

    /// The fact as version 5 stored it — the shape this version added, copied
    /// because it belongs to the frozen graph above.
    @Model
    final class StoredFact {
        var type: String = ""
        var displayValue: String = ""
        var sourceName: String = ""
        var detailsJSON: Data?
        var entity: LocalSchemaV5.StoredGeoEntity?

        init(
            type: String,
            displayValue: String,
            sourceName: String,
            detailsJSON: Data? = nil
        ) {
            self.type = type
            self.displayValue = displayValue
            self.sourceName = sourceName
            self.detailsJSON = detailsJSON
        }
    }

    static var models: [any PersistentModel.Type] {
        [
            StoredContentManifest.self,
            StoredContentStagingState.self,
            // The two types this version changes; everything else is version
            // four's.
            LocalSchemaV5.StoredGeoEntity.self,
            LocalSchemaV5.StoredFact.self,
            LocalSchemaV5.StoredGeoName.self,
            LocalSchemaV5.StoredAsset.self,
            LocalSchemaV5.StoredDeck.self,
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
