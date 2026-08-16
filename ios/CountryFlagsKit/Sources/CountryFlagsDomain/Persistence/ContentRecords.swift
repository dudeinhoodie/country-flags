import Foundation

/// The value types repositories exchange with the rest of the app.
///
/// They are plain `Sendable` structs on purpose: a persistence model must not
/// travel into a view or across an actor boundary, and the network layer must
/// not hand a stored object to a caller either. Everything here is content,
/// which is shared by every account on the device.

public struct ContentManifestRecord: Hashable, Sendable {
    public let contentVersion: String
    public let defaultLocale: String
    /// The locale the stored release's text was imported in. A device whose
    /// language changed compares this against what it would ask for now: the
    /// version being current says nothing about the words being in the right
    /// language.
    public let importedLocale: String
    public let supportedLocales: [String]
    public let supportedTemplateSchemaVersions: [Int]
    public let assetBaseURL: URL
    public let changeCursor: String
    public let checksum: String
    public let appliedAt: Date

    public init(
        contentVersion: String,
        defaultLocale: String,
        importedLocale: String = "",
        supportedLocales: [String],
        supportedTemplateSchemaVersions: [Int],
        assetBaseURL: URL,
        changeCursor: String,
        checksum: String,
        appliedAt: Date
    ) {
        self.contentVersion = contentVersion
        self.defaultLocale = defaultLocale
        self.importedLocale = importedLocale
        self.supportedLocales = supportedLocales
        self.supportedTemplateSchemaVersions = supportedTemplateSchemaVersions
        self.assetBaseURL = assetBaseURL
        self.changeCursor = changeCursor
        self.checksum = checksum
        self.appliedAt = appliedAt
    }
}

public struct GeoEntityRecord: Hashable, Sendable {
    public let id: UUID
    /// Taxonomy values the content pipeline owns arrive as strings; see
    /// ADR-009.
    public let kind: String
    public let status: String
    public let recognitionStatus: String
    public let contentVersion: String
    public let names: [GeoNameRecord]
    public let assets: [AssetRecord]
    public let facts: [FactRecord]

    public init(
        id: UUID,
        kind: String,
        status: String,
        recognitionStatus: String,
        contentVersion: String,
        names: [GeoNameRecord],
        assets: [AssetRecord],
        facts: [FactRecord]
    ) {
        self.id = id
        self.kind = kind
        self.status = status
        self.recognitionStatus = recognitionStatus
        self.contentVersion = contentVersion
        self.names = names
        self.assets = assets
        self.facts = facts
    }
}

public struct GeoNameRecord: Hashable, Sendable {
    public let locale: String
    public let value: String
    public let isPrimary: Bool

    public init(locale: String, value: String, isPrimary: Bool) {
        self.locale = locale
        self.value = value
        self.isPrimary = isPrimary
    }
}

public struct AssetRecord: Hashable, Sendable {
    public let id: UUID
    public let type: String
    public let url: URL
    public let mimeType: String
    /// Checked before an asset is used, so a truncated download cannot be
    /// rendered as a flag.
    public let sha256: String
    public let contentVersion: String

    public init(
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

public struct FactRecord: Hashable, Sendable {
    public let type: String
    public let displayValue: String
    public let sourceName: String

    public init(type: String, displayValue: String, sourceName: String) {
        self.type = type
        self.displayValue = displayValue
        self.sourceName = sourceName
    }
}

public struct DeckRecord: Hashable, Sendable {
    public let id: UUID
    public let code: String
    public let kind: String
    public let name: String
    public let deckDescription: String
    public let cardCount: Int
    public let contentVersion: String
    public let sortOrder: Int

    public init(
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

public struct LearningCardRecord: Hashable, Sendable {
    public let id: UUID
    public let subjectEntityID: UUID
    public let templateCode: String
    public let templateSchemaVersion: Int
    public let semanticVersion: Int
    /// The exact revision the snapshot was taken from, so a card shown in a
    /// session stays the card that was answered.
    public let revision: Int
    public let answerMode: String
    public let promptAssetID: UUID
    public let displayName: String
    public let aliases: [String]
    public let contentVersion: String
    /// A retired card stays readable for an unfinished session but is never
    /// selected again.
    public let isRetired: Bool
    /// What the release prints on the back of the card, in the order it
    /// published them. Empty for a release that publishes none, which is a
    /// card with nothing more to say rather than an error.
    public let backSideFacts: [FactRecord]

    public init(
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
        isRetired: Bool = false,
        backSideFacts: [FactRecord] = []
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

/// Membership of a card in a deck. A card belongs to several decks, and
/// progress is tracked per card rather than per membership.
public struct DeckCardRecord: Hashable, Sendable {
    public let deckID: UUID
    public let learningCardID: UUID
    public let sortOrder: Int?

    public init(deckID: UUID, learningCardID: UUID, sortOrder: Int?) {
        self.deckID = deckID
        self.learningCardID = learningCardID
        self.sortOrder = sortOrder
    }
}
