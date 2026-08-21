import Foundation
import SwiftData

/// Version 1 of the local store.
///
/// A versioned schema is declared from the start so the first real migration
/// is a stage added to `LocalStoreMigrationPlan` rather than a rewrite. Models
/// are split in two kinds: content, shared by everyone on the device, and
/// account-scoped records, each carrying the `scopeKey` every query filters on.
///
/// Uniqueness is enforced by the repositories, which read before they write.
/// The `#Unique` macro would state it in the schema instead, but it needs
/// iOS 18 and the deployment target is iOS 17.
enum LocalSchemaV1: VersionedSchema {
    static var versionIdentifier: Schema.Version { Schema.Version(1, 0, 0) }

    /// The card as version 1 stored it: without the facts a release prints on
    /// its back.
    ///
    /// Frozen on purpose, and the reason it exists at all. A version describes
    /// the store as it was, so a type the app keeps editing cannot stand for
    /// one: listing the current `StoredLearningCard` here left both versions
    /// describing the same store, and Core Data refuses a migration between two
    /// versions it cannot tell apart — `Duplicate version checksums detected`,
    /// thrown on the launch that has an older store to open.
    @Model
    final class StoredLearningCard {
        var id: UUID = UUID()
        var subjectEntityID: UUID = UUID()
        var templateCode: String = ""
        var templateSchemaVersion: Int = 1
        var semanticVersion: Int = 1
        var revision: Int = 1
        var answerMode: String = ""
        var promptAssetID: UUID = UUID()
        var displayName: String = ""
        var aliases: [String] = []
        var contentVersion: String = ""
        var isRetired: Bool = false

        init(
            id: UUID,
            subjectEntityID: UUID,
            templateCode: String,
            templateSchemaVersion: Int,
            semanticVersion: Int,
            revision: Int,
            answerMode: String,
            promptAssetID: UUID,
            displayName: String,
            aliases: [String],
            contentVersion: String,
            isRetired: Bool
        ) {
            self.id = id
            self.subjectEntityID = subjectEntityID
            self.templateCode = templateCode
            self.templateSchemaVersion = templateSchemaVersion
            self.semanticVersion = semanticVersion
            self.revision = revision
            self.answerMode = answerMode
            self.promptAssetID = promptAssetID
            self.displayName = displayName
            self.aliases = aliases
            self.contentVersion = contentVersion
            self.isRetired = isRetired
        }
    }

    static var models: [any PersistentModel.Type] {
        [
            StoredContentManifest.self,
            StoredContentStagingState.self,
            StoredGeoEntity.self,
            StoredGeoName.self,
            StoredAsset.self,
            StoredFact.self,
            StoredDeck.self,
            LocalSchemaV1.StoredLearningCard.self,
            StoredDeckCard.self,
            StoredUserSettings.self,
            StoredCardState.self,
            StoredDeckProgress.self,
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

// MARK: - Content

@Model
final class StoredContentManifest {
    var contentVersion: String = ""
    var defaultLocale: String = ""
    var supportedLocales: [String] = []
    var supportedTemplateSchemaVersions: [Int] = []
    var assetBaseURL: URL = URL(fileURLWithPath: "/")
    var changeCursor: String = ""
    var checksum: String = ""
    var appliedAt: Date = Date.distantPast
    /// Exactly one manifest is current. The previous release stays readable
    /// until the new one is fully applied.
    var isCurrent: Bool = false

    init(
        contentVersion: String,
        defaultLocale: String,
        supportedLocales: [String],
        supportedTemplateSchemaVersions: [Int],
        assetBaseURL: URL,
        changeCursor: String,
        checksum: String,
        appliedAt: Date,
        isCurrent: Bool
    ) {
        self.contentVersion = contentVersion
        self.defaultLocale = defaultLocale
        self.supportedLocales = supportedLocales
        self.supportedTemplateSchemaVersions = supportedTemplateSchemaVersions
        self.assetBaseURL = assetBaseURL
        self.changeCursor = changeCursor
        self.checksum = checksum
        self.appliedAt = appliedAt
        self.isCurrent = isCurrent
    }
}

/// Where an interrupted content download resumes.
///
/// It is a row rather than a defaults key because it is written in the same
/// transaction as the page it describes: a cursor that moved without its page
/// would skip content, and a page applied without its cursor would be
/// downloaded again. One row per version, so a release abandoned halfway does
/// not confuse the next one.
@Model
final class StoredContentStagingState {
    var contentVersion: String = ""
    var stage: String = ""
    var cursor: String?
    var pendingDeckIDs: [UUID] = []
    var appliedInStage: Int = 0
    var updatedAt: Date = Date.distantPast

    init(
        contentVersion: String,
        stage: String,
        cursor: String?,
        pendingDeckIDs: [UUID],
        appliedInStage: Int,
        updatedAt: Date
    ) {
        self.contentVersion = contentVersion
        self.stage = stage
        self.cursor = cursor
        self.pendingDeckIDs = pendingDeckIDs
        self.appliedInStage = appliedInStage
        self.updatedAt = updatedAt
    }
}

@Model
final class StoredGeoEntity {
    var id: UUID = UUID()
    var kind: String = ""
    var status: String = ""
    var recognitionStatus: String = ""
    var contentVersion: String = ""
    var isRetired: Bool = false
    @Relationship(deleteRule: .cascade, inverse: \StoredGeoName.entity)
    var names: [StoredGeoName]? = []
    @Relationship(deleteRule: .cascade, inverse: \StoredAsset.entity)
    var assets: [StoredAsset]? = []
    @Relationship(deleteRule: .cascade, inverse: \StoredFact.entity)
    var facts: [StoredFact]? = []

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
    var entity: StoredGeoEntity?

    init(locale: String, value: String, isPrimary: Bool) {
        self.locale = locale
        self.value = value
        self.isPrimary = isPrimary
    }
}

@Model
final class StoredAsset {
    var id: UUID = UUID()
    var type: String = ""
    var url: URL = URL(fileURLWithPath: "/")
    var mimeType: String = ""
    var sha256: String = ""
    var contentVersion: String = ""
    var entity: StoredGeoEntity?

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

@Model
final class StoredFact {
    var type: String = ""
    var displayValue: String = ""
    var sourceName: String = ""
    var entity: StoredGeoEntity?

    init(type: String, displayValue: String, sourceName: String) {
        self.type = type
        self.displayValue = displayValue
        self.sourceName = sourceName
    }
}

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

@Model
final class StoredLearningCard {
    var id: UUID = UUID()
    var subjectEntityID: UUID = UUID()
    var templateCode: String = ""
    var templateSchemaVersion: Int = 1
    var semanticVersion: Int = 1
    var revision: Int = 1
    var answerMode: String = ""
    var promptAssetID: UUID = UUID()
    var displayName: String = ""
    var aliases: [String] = []
    var contentVersion: String = ""
    var isRetired: Bool = false
    /// What the release prints on the back of this card, in the order it
    /// published them. Added in `LocalSchemaV2`; a store written by an earlier
    /// build has none until the next release is applied.
    var backSideFacts: [StoredCardFact] = []

    init(
        id: UUID,
        subjectEntityID: UUID,
        templateCode: String,
        templateSchemaVersion: Int,
        semanticVersion: Int,
        revision: Int,
        answerMode: String,
        promptAssetID: UUID,
        displayName: String,
        aliases: [String],
        contentVersion: String,
        isRetired: Bool,
        backSideFacts: [StoredCardFact] = []
    ) {
        self.id = id
        self.subjectEntityID = subjectEntityID
        self.templateCode = templateCode
        self.templateSchemaVersion = templateSchemaVersion
        self.semanticVersion = semanticVersion
        self.revision = revision
        self.answerMode = answerMode
        self.promptAssetID = promptAssetID
        self.displayName = displayName
        self.aliases = aliases
        self.contentVersion = contentVersion
        self.isRetired = isRetired
        self.backSideFacts = backSideFacts
    }
}

/// One line on the back of a card.
///
/// Stored as a value rather than as its own model: the facts of a card are read
/// with it, never queried on their own, and a relationship would buy an index
/// nothing looks anything up by.
struct StoredCardFact: Codable, Hashable {
    var type: String
    var displayValue: String
    var sourceName: String
}

@Model
final class StoredDeckCard {
    var deckID: UUID = UUID()
    var learningCardID: UUID = UUID()
    var sortOrder: Int?

    init(deckID: UUID, learningCardID: UUID, sortOrder: Int?) {
        self.deckID = deckID
        self.learningCardID = learningCardID
        self.sortOrder = sortOrder
    }
}

// MARK: - Account scoped

@Model
final class StoredUserSettings {
    var scopeKey: String = ""
    var sessionSize: Int = 10
    var contentLocale: String = ""
    var defaultAnswerMode: String = ""
    var extraFactTypes: [String] = []
    var soundEnabled: Bool = true
    var hapticsEnabled: Bool = true
    var remindersEnabled: Bool = false
    var version: Int = 1
    var updatedAt: Date = Date.distantPast

    init(
        scopeKey: String,
        sessionSize: Int,
        contentLocale: String,
        defaultAnswerMode: String,
        extraFactTypes: [String],
        soundEnabled: Bool,
        hapticsEnabled: Bool,
        remindersEnabled: Bool,
        version: Int,
        updatedAt: Date
    ) {
        self.scopeKey = scopeKey
        self.sessionSize = sessionSize
        self.contentLocale = contentLocale
        self.defaultAnswerMode = defaultAnswerMode
        self.extraFactTypes = extraFactTypes
        self.soundEnabled = soundEnabled
        self.hapticsEnabled = hapticsEnabled
        self.remindersEnabled = remindersEnabled
        self.version = version
        self.updatedAt = updatedAt
    }
}

@Model
final class StoredCardState {
    var scopeKey: String = ""
    var learningCardID: UUID = UUID()
    var state: String = ""
    var difficulty: Double = 0
    var stability: Double = 0
    var dueAt: Date = Date.distantPast
    var repetitions: Int = 0
    var lapses: Int = 0
    var schedulerVersion: String = ""
    var stateVersion: Int = 0
    var updatedAt: Date = Date.distantPast
    var isLocalProjection: Bool = false

    init(
        scopeKey: String,
        learningCardID: UUID,
        state: String,
        difficulty: Double,
        stability: Double,
        dueAt: Date,
        repetitions: Int,
        lapses: Int,
        schedulerVersion: String,
        stateVersion: Int,
        updatedAt: Date,
        isLocalProjection: Bool
    ) {
        self.scopeKey = scopeKey
        self.learningCardID = learningCardID
        self.state = state
        self.difficulty = difficulty
        self.stability = stability
        self.dueAt = dueAt
        self.repetitions = repetitions
        self.lapses = lapses
        self.schedulerVersion = schedulerVersion
        self.stateVersion = stateVersion
        self.updatedAt = updatedAt
        self.isLocalProjection = isLocalProjection
    }
}

@Model
final class StoredDeckProgress {
    var scopeKey: String = ""
    var deckID: UUID = UUID()
    var totalCards: Int = 0
    var learnedCards: Int = 0
    var dueCards: Int = 0
    /// Added in version 4: the backend's own count of cards still settling.
    /// A default is what makes the stage lightweight — a device that updates
    /// carries its unsent outbox across, and the number is filled by the next
    /// sync.
    var inProgressCards: Int = 0
    var currentMasteryTier: String = ""
    var highestAchievementTier: String = ""
    var updatedAt: Date = Date.distantPast

    init(
        scopeKey: String,
        deckID: UUID,
        totalCards: Int,
        learnedCards: Int,
        dueCards: Int,
        inProgressCards: Int = 0,
        currentMasteryTier: String,
        highestAchievementTier: String,
        updatedAt: Date
    ) {
        self.scopeKey = scopeKey
        self.deckID = deckID
        self.totalCards = totalCards
        self.learnedCards = learnedCards
        self.dueCards = dueCards
        self.inProgressCards = inProgressCards
        self.currentMasteryTier = currentMasteryTier
        self.highestAchievementTier = highestAchievementTier
        self.updatedAt = updatedAt
    }
}

@Model
final class StoredAchievement {
    var scopeKey: String = ""
    var id: UUID = UUID()
    var code: String = ""
    var category: String = ""
    var tier: String?
    var scopeType: String = ""
    var achievementScopeID: UUID?
    var earnedAt: Date?

    init(
        scopeKey: String,
        id: UUID,
        code: String,
        category: String,
        tier: String?,
        scopeType: String,
        achievementScopeID: UUID?,
        earnedAt: Date?
    ) {
        self.scopeKey = scopeKey
        self.id = id
        self.code = code
        self.category = category
        self.tier = tier
        self.scopeType = scopeType
        self.achievementScopeID = achievementScopeID
        self.earnedAt = earnedAt
    }
}

@Model
final class StoredStudySession {
    var scopeKey: String = ""
    var id: UUID = UUID()
    var deckID: UUID = UUID()
    var mode: String = ""
    var selectionOrigin: String = ""
    var requestedUniqueCount: Int = 0
    var status: String = ""
    var contentVersion: String = ""
    var startedAt: Date = Date.distantPast
    var completedAt: Date?
    @Relationship(deleteRule: .cascade, inverse: \StoredStudySessionCard.session)
    var cards: [StoredStudySessionCard]? = []

    init(
        scopeKey: String,
        id: UUID,
        deckID: UUID,
        mode: String,
        selectionOrigin: String,
        requestedUniqueCount: Int,
        status: String,
        contentVersion: String,
        startedAt: Date,
        completedAt: Date?
    ) {
        self.scopeKey = scopeKey
        self.id = id
        self.deckID = deckID
        self.mode = mode
        self.selectionOrigin = selectionOrigin
        self.requestedUniqueCount = requestedUniqueCount
        self.status = status
        self.contentVersion = contentVersion
        self.startedAt = startedAt
        self.completedAt = completedAt
    }
}

@Model
final class StoredStudySessionCard {
    var id: UUID = UUID()
    var learningCardID: UUID = UUID()
    var initialOrder: Int = 0
    var selectionReason: String = ""
    var displayName: String = ""
    var promptAssetID: UUID = UUID()
    var revision: Int = 1
    var optionIDs: [UUID] = []
    var optionNames: [String] = []
    var session: StoredStudySession?

    init(
        id: UUID,
        learningCardID: UUID,
        initialOrder: Int,
        selectionReason: String,
        displayName: String,
        promptAssetID: UUID,
        revision: Int,
        optionIDs: [UUID],
        optionNames: [String]
    ) {
        self.id = id
        self.learningCardID = learningCardID
        self.initialOrder = initialOrder
        self.selectionReason = selectionReason
        self.displayName = displayName
        self.promptAssetID = promptAssetID
        self.revision = revision
        self.optionIDs = optionIDs
        self.optionNames = optionNames
    }
}

@Model
final class StoredReviewEvent {
    var scopeKey: String = ""
    var id: UUID = UUID()
    var sessionID: UUID = UUID()
    var learningCardID: UUID = UUID()
    var rating: String = ""
    var answerMode: String = ""
    var selectedOptionID: UUID?
    var responseTimeMilliseconds: Int?
    var clientOccurredAt: Date = Date.distantPast
    var estimatedServerOccurredAt: Date?
    var clientSequence: Int = 0
    var baseStateVersion: Int?

    init(
        scopeKey: String,
        id: UUID,
        sessionID: UUID,
        learningCardID: UUID,
        rating: String,
        answerMode: String,
        selectedOptionID: UUID?,
        responseTimeMilliseconds: Int?,
        clientOccurredAt: Date,
        estimatedServerOccurredAt: Date?,
        clientSequence: Int,
        baseStateVersion: Int?
    ) {
        self.scopeKey = scopeKey
        self.id = id
        self.sessionID = sessionID
        self.learningCardID = learningCardID
        self.rating = rating
        self.answerMode = answerMode
        self.selectedOptionID = selectedOptionID
        self.responseTimeMilliseconds = responseTimeMilliseconds
        self.clientOccurredAt = clientOccurredAt
        self.estimatedServerOccurredAt = estimatedServerOccurredAt
        self.clientSequence = clientSequence
        self.baseStateVersion = baseStateVersion
    }
}

@Model
final class StoredOutboxOperation {
    var scopeKey: String = ""
    var id: UUID = UUID()
    var kind: String = ""
    var dependencyID: UUID?
    var payload: Data = Data()
    var state: String = ""
    var attemptCount: Int = 0
    var lastFailureCode: String?
    var createdAt: Date = Date.distantPast
    var updatedAt: Date = Date.distantPast

    init(
        scopeKey: String,
        id: UUID,
        kind: String,
        dependencyID: UUID?,
        payload: Data,
        state: String,
        attemptCount: Int,
        lastFailureCode: String?,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.scopeKey = scopeKey
        self.id = id
        self.kind = kind
        self.dependencyID = dependencyID
        self.payload = payload
        self.state = state
        self.attemptCount = attemptCount
        self.lastFailureCode = lastFailureCode
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

@Model
final class StoredSyncCursor {
    var scopeKey: String = ""
    var feed: String = ""
    var cursor: String = ""
    var updatedAt: Date = Date.distantPast

    init(scopeKey: String, feed: String, cursor: String, updatedAt: Date) {
        self.scopeKey = scopeKey
        self.feed = feed
        self.cursor = cursor
        self.updatedAt = updatedAt
    }
}

@Model
final class StoredAnalyticsEvent {
    var scopeKey: String = ""
    var id: UUID = UUID()
    var name: String = ""
    var schemaVersion: Int = 1
    var payload: Data = Data()
    var isOptional: Bool = true
    var occurredAt: Date = Date.distantPast

    init(
        scopeKey: String,
        id: UUID,
        name: String,
        schemaVersion: Int,
        payload: Data,
        isOptional: Bool,
        occurredAt: Date
    ) {
        self.scopeKey = scopeKey
        self.id = id
        self.name = name
        self.schemaVersion = schemaVersion
        self.payload = payload
        self.isOptional = isOptional
        self.occurredAt = occurredAt
    }
}

@Model
final class StoredPrivacySettings {
    var scopeKey: String = ""
    var productAnalyticsStatus: String = ""
    var diagnosticsStatus: String = ""
    var policyVersion: String = ""
    var version: Int = 1
    var updatedAt: Date = Date.distantPast

    init(
        scopeKey: String,
        productAnalyticsStatus: String,
        diagnosticsStatus: String,
        policyVersion: String,
        version: Int,
        updatedAt: Date
    ) {
        self.scopeKey = scopeKey
        self.productAnalyticsStatus = productAnalyticsStatus
        self.diagnosticsStatus = diagnosticsStatus
        self.policyVersion = policyVersion
        self.version = version
        self.updatedAt = updatedAt
    }
}

@Model
final class StoredPendingDiagnosticReport {
    var scopeKey: String = ""
    var id: UUID = UUID()
    var kind: String = ""
    var payload: Data = Data()
    var capturedAt: Date = Date.distantPast

    init(scopeKey: String, id: UUID, kind: String, payload: Data, capturedAt: Date) {
        self.scopeKey = scopeKey
        self.id = id
        self.kind = kind
        self.payload = payload
        self.capturedAt = capturedAt
    }
}
