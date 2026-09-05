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
    public let supportedLocales: [String]
    public let supportedTemplateSchemaVersions: [Int]
    public let assetBaseURL: URL
    public let changeCursor: String
    public let checksum: String
    public let appliedAt: Date

    public init(
        contentVersion: String,
        defaultLocale: String,
        supportedLocales: [String],
        supportedTemplateSchemaVersions: [Int],
        assetBaseURL: URL,
        changeCursor: String,
        checksum: String,
        appliedAt: Date
    ) {
        self.contentVersion = contentVersion
        self.defaultLocale = defaultLocale
        self.supportedLocales = supportedLocales
        self.supportedTemplateSchemaVersions = supportedTemplateSchemaVersions
        self.assetBaseURL = assetBaseURL
        self.changeCursor = changeCursor
        self.checksum = checksum
        self.appliedAt = appliedAt
    }
}

/// What an entity is, as a value this build can switch on.
///
/// The pipeline owns the list, so a kind published after this release is
/// carried as `unknown` rather than rejected — see ADR-009. It exists as a
/// type because `SUBDIVISION` now has to be told apart from a country by
/// something other than the absence of a parent: a country has no parent
/// either.
public enum GeoEntityKind: Hashable, Sendable {
    case country
    case territory
    case dependency
    case disputedArea
    /// An administrative unit of a country — a U.S. state.
    case subdivision
    case region
    case subregion
    case other
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "COUNTRY": self = .country
        case "TERRITORY": self = .territory
        case "DEPENDENCY": self = .dependency
        case "DISPUTED_AREA": self = .disputedArea
        case "SUBDIVISION": self = .subdivision
        case "REGION": self = .region
        case "SUBREGION": self = .subregion
        case "OTHER": self = .other
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .country: return "COUNTRY"
        case .territory: return "TERRITORY"
        case .dependency: return "DEPENDENCY"
        case .disputedArea: return "DISPUTED_AREA"
        case .subdivision: return "SUBDIVISION"
        case .region: return "REGION"
        case .subregion: return "SUBREGION"
        case .other: return "OTHER"
        case .unknown(let value): return value
        }
    }
}

/// The country or territory an administrative unit belongs to, as much of it
/// as a screen needs to name it.
///
/// A summary rather than a reference: showing "California, United States"
/// must not depend on the parent's own record having been downloaded, and a
/// relationship between two entities would make it.
public struct GeoEntityParentRecord: Hashable, Sendable {
    public let id: UUID
    public let kind: String
    public let name: String

    public init(id: UUID, kind: String, name: String) {
        self.id = id
        self.kind = kind
        self.name = name
    }
}

/// Codes that identify an entity outside this catalog.
///
/// A subdivision code has a field of its own: `US-CA` written into an ISO
/// country code would put a state everywhere a reader expects a country.
public struct GeoEntityIdentifiersRecord: Hashable, Sendable, Codable {
    /// ISO 3166-2, such as `US-CA`.
    public let isoSubdivision: String?
    /// The official code the parent country uses for the unit.
    public let localCode: String?
    /// Present only where the source publishes one; never derived.
    public let fipsCode: String?

    public init(
        isoSubdivision: String? = nil,
        localCode: String? = nil,
        fipsCode: String? = nil
    ) {
        self.isoSubdivision = isoSubdivision
        self.localCode = localCode
        self.fipsCode = fipsCode
    }

    public static let none = GeoEntityIdentifiersRecord()

    public var isEmpty: Bool {
        isoSubdivision == nil && localCode == nil && fipsCode == nil
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
    /// Set for an administrative unit and nil for everything else, a country
    /// included — so it is a detail to show rather than a test to filter by.
    public let parent: GeoEntityParentRecord?
    public let identifiers: GeoEntityIdentifiersRecord

    /// The kind as a value this build can switch on, unknown ones included.
    public var entityKind: GeoEntityKind { GeoEntityKind(rawValue: kind) }

    public init(
        id: UUID,
        kind: String,
        status: String,
        recognitionStatus: String,
        contentVersion: String,
        names: [GeoNameRecord],
        assets: [AssetRecord],
        facts: [FactRecord],
        parent: GeoEntityParentRecord? = nil,
        identifiers: GeoEntityIdentifiersRecord = .none
    ) {
        self.id = id
        self.kind = kind
        self.status = status
        self.recognitionStatus = recognitionStatus
        self.contentVersion = contentVersion
        self.names = names
        self.assets = assets
        self.facts = facts
        self.parent = parent
        self.identifiers = identifiers
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

/// What an asset draws. The pipeline owns the values, so an unknown one is
/// carried rather than rejected — see ADR-009.
///
/// An entity has several of these at once now, and the type is what tells them
/// apart: a coat of arms and a flag are two drawings of one country, not two
/// versions of one drawing.
public enum AssetType: Hashable, Sendable {
    case flag
    case coatOfArms
    case map
    case other
    /// A type published after this release. Kept whole so the value survives
    /// a round trip through the store.
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "FLAG": self = .flag
        case "COAT_OF_ARMS": self = .coatOfArms
        case "MAP": self = .map
        case "OTHER": self = .other
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .flag: return "FLAG"
        case .coatOfArms: return "COAT_OF_ARMS"
        case .map: return "MAP"
        case .other: return "OTHER"
        case .unknown(let value): return value
        }
    }
}

public struct AssetRecord: Hashable, Sendable {
    public let id: UUID
    public let type: String
    /// Which drawing of this type it is. `current` is the baseline; a
    /// historical symbol publishes another. Part of what makes an asset
    /// unique alongside the entity and the type.
    public let variant: String
    public let url: URL
    public let mimeType: String
    /// Checked before an asset is used, so a truncated download cannot be
    /// rendered as a flag.
    public let sha256: String
    public let contentVersion: String
    /// What this drawing is called in the reader's locale — "Federal Eagle"
    /// rather than "Germany". It belongs to the asset because the story of a
    /// symbol is the story of that drawing, and an entity now has several.
    /// Nil when the symbol has no name of its own.
    public let displayName: String?
    /// What the symbol means, in the reader's locale.
    public let assetDescription: String?

    /// The type as a value this build can switch on, unknown ones included.
    public var assetType: AssetType { AssetType(rawValue: type) }

    public init(
        id: UUID,
        type: String,
        url: URL,
        mimeType: String,
        sha256: String,
        contentVersion: String,
        variant: String = AssetRecord.baselineVariant,
        displayName: String? = nil,
        assetDescription: String? = nil
    ) {
        self.id = id
        self.type = type
        self.variant = variant
        self.url = url
        self.mimeType = mimeType
        self.sha256 = sha256
        self.contentVersion = contentVersion
        self.displayName = displayName
        self.assetDescription = assetDescription
    }

    /// The variant every asset published so far carries.
    public static let baselineVariant = "current"
}

/// A fact with its parts still apart, names already in the reader's locale.
///
/// The backend also composes a line — `displayValue` — and that line bakes in
/// decisions the screen should be making: which separator, whether a currency
/// shows the code printed on the note. With the parts in hand the client
/// stops taking the line apart again with regular expressions to undo them.
///
/// Absent when the release stores a shape the backend does not model, in
/// which case the composed line is all there is and is shown as it arrived.
public enum FactDetails: Hashable, Sendable, Codable {
    case capital(seats: [Seat])
    case currency(tenders: [Tender])
    case language(languages: [Language])
    /// The count unformatted, and the year the source counted — not the day
    /// it published, which is what `observedAt` would be.
    case population(value: Int, year: Int?)

    public struct Seat: Hashable, Sendable, Codable {
        public let name: String
        /// What kind of seat this is when the source says so — an official
        /// capital, a legislative one. Nil when it does not.
        public let role: String?

        public init(name: String, role: String?) {
            self.name = name
            self.role = role
        }
    }

    public struct Tender: Hashable, Sendable, Codable {
        /// The ISO 4217 code, which is what is printed on the note.
        public let code: String
        public let name: String
        public let role: String?

        public init(code: String, name: String, role: String?) {
            self.code = code
            self.name = name
            self.role = role
        }
    }

    public struct Language: Hashable, Sendable, Codable {
        /// The BCP 47 tag, when the release carries one.
        public let code: String?
        public let name: String

        public init(code: String?, name: String) {
            self.code = code
            self.name = name
        }
    }
}

public struct FactRecord: Hashable, Sendable {
    public let type: String
    public let displayValue: String
    public let sourceName: String
    public let details: FactDetails?

    public init(
        type: String,
        displayValue: String,
        sourceName: String,
        details: FactDetails? = nil
    ) {
        self.type = type
        self.displayValue = displayValue
        self.sourceName = sourceName
        self.details = details
    }
}

/// What opens a deck.
///
/// Monetization lives here and nowhere else: no card, asset or template is
/// paid. No price appears either — the store owns what a thing costs, and the
/// client reads it from the store.
public enum DeckAccessModel: Hashable, Sendable {
    case free
    case entitlement
    /// A model published after this release. A deck this build cannot reason
    /// about stays locked rather than being opened by a value it does not
    /// understand.
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "FREE": self = .free
        case "ENTITLEMENT": self = .entitlement
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .free: return "FREE"
        case .entitlement: return "ENTITLEMENT"
        case .unknown(let value): return value
        }
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
    /// What opens the deck, as the release published it. Every deck published
    /// so far is `FREE`, which is also what a deck stored before this field
    /// existed reads as.
    public let accessModel: String
    /// The right that opens it. Set exactly when the model is `ENTITLEMENT`.
    public let requiredEntitlementKey: String?
    /// The offers that grant that right, in the order they should be shown. A
    /// client turns a code into a store product through the commerce
    /// endpoint; it never derives one.
    public let offerCodes: [String]
    /// What the deck teaches, derived from the cards it holds: a deck of coats
    /// of arms carries `COAT_OF_ARMS`, a mixed one carries both. Published
    /// rather than authored, and never a filter on the cards themselves.
    public let contentKinds: [String]
    /// The cards a locked deck may show before it is bought — at most three,
    /// published as public on purpose. Held as identifiers because the deck
    /// only needs to know which of its cards are open, not what is on them.
    public let previewCardIDs: [UUID]

    /// The access model as a value this build can switch on.
    public var access: DeckAccessModel { DeckAccessModel(rawValue: accessModel) }

    /// True only for a model this build knows to be open. An unknown model is
    /// not free: the safe reading of a value published after this release is
    /// that it needs something the release cannot check.
    public var isFree: Bool { access == .free }

    public init(
        id: UUID,
        code: String,
        kind: String,
        name: String,
        deckDescription: String,
        cardCount: Int,
        contentVersion: String,
        sortOrder: Int,
        accessModel: String = DeckAccessModel.free.rawValue,
        requiredEntitlementKey: String? = nil,
        offerCodes: [String] = [],
        contentKinds: [String] = [],
        previewCardIDs: [UUID] = []
    ) {
        self.id = id
        self.code = code
        self.kind = kind
        self.name = name
        self.deckDescription = deckDescription
        self.cardCount = cardCount
        self.contentVersion = contentVersion
        self.sortOrder = sortOrder
        self.accessModel = accessModel
        self.requiredEntitlementKey = requiredEntitlementKey
        self.offerCodes = offerCodes
        self.contentKinds = contentKinds
        self.previewCardIDs = previewCardIDs
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
