import Foundation

/// What a card asks, as the release names it: the template code together with
/// the schema version it was authored against.
///
/// The two travel together because neither is enough on its own. A code says
/// what question is being asked — a flag, a coat of arms — and the version
/// says how the answer is shaped. `COAT_OF_ARMS_TO_COUNTRY` v1 arriving at a
/// build that only knows v1 of the flag template must not be mistaken for
/// something drawable: matching on the version alone would let a coat of arms
/// through as a flag, which is exactly the failure ADR-020 names.
public struct CardTemplateKey: Hashable, Sendable {
    public let code: String
    public let schemaVersion: Int

    public init(code: String, schemaVersion: Int) {
        self.code = code
        self.schemaVersion = schemaVersion
    }

    public init(card: LearningCardRecord) {
        self.init(code: card.templateCode, schemaVersion: card.templateSchemaVersion)
    }

    /// A machine-safe rendering of the pair, for a log line or an error
    /// report. Both halves are constants the pipeline publishes, so nothing
    /// here can carry a person's data.
    public var identifier: String { "\(code)@v\(schemaVersion)" }
}

/// What a card is about, at the grain an answer option is matched on.
///
/// There are two buckets rather than one per entity kind on purpose. A world
/// deck has always mixed countries with the territories and dependencies that
/// fly a flag beside them, and splitting those apart would narrow a pool that
/// works today. A subdivision is the new thing that must not mix: California
/// belongs to the United States, and offering "United States" as an answer to
/// California's flag asks a question with two right answers.
public enum CardSubjectKind: String, Hashable, Sendable, CaseIterable {
    /// A country and what stands beside one in a world deck — a territory, a
    /// dependency, a disputed area.
    case country
    /// An administrative unit of a country: a U.S. state.
    case subdivision

    public init(entityKind: GeoEntityKind) {
        self = entityKind == .subdivision ? .subdivision : .country
    }

    /// What a card is about when the entity behind it is not on the device.
    ///
    /// A bootstrap imports cards a page at a time and only the change feed
    /// delivers their entities, so a card can be studied before its entity
    /// row arrives. Every card published before subdivisions existed is a
    /// country, which makes that the reading that keeps existing decks whole.
    public static let unresolved = CardSubjectKind.country
}

/// A template this build knows how to draw.
///
/// A case here is a promise: the renderer switch is exhaustive, so a template
/// registered below without a face to draw it does not compile.
public enum CardTemplate: String, Hashable, Sendable, CaseIterable {
    /// The flag, and the country or subdivision that flies it.
    case flagToCountry = "FLAG_TO_COUNTRY"
    /// The coat of arms, and the country it belongs to.
    case coatOfArmsToCountry = "COAT_OF_ARMS_TO_COUNTRY"

    /// What the prompt draws. It is the template's property rather than the
    /// asset's: the template is what decides which drawing is the question,
    /// and an entity now holds several.
    public var promptAssetType: AssetType {
        switch self {
        case .flagToCountry: .flag
        case .coatOfArmsToCountry: .coatOfArms
        }
    }
}

/// Which two cards may stand in one question.
///
/// The rule is a pair, not a single value: a coat of arms is never an option
/// beside a flag, and a state's flag is never answered with a country. Both
/// halves have to match, and the template half matches on the whole key —
/// a card of a version this build does not draw is not an option for one it
/// does.
public struct CardCompatibility: Hashable, Sendable {
    public let template: CardTemplateKey
    public let subject: CardSubjectKind

    public init(template: CardTemplateKey, subject: CardSubjectKind) {
        self.template = template
        self.subject = subject
    }

    public init(card: LearningCardRecord, subject: CardSubjectKind) {
        self.init(template: CardTemplateKey(card: card), subject: subject)
    }
}

/// Every `templateCode + templateSchemaVersion` this build can draw.
///
/// This table is the single place a template is registered, and it is what
/// both halves of the app read: the selector, which keeps a card it cannot
/// draw out of a session, and the screen, which picks the face by the pair
/// and never by the deck a card came from. Two decks can hold the same
/// template and one deck can hold two, so the deck's name says nothing about
/// what to draw — which is the rule ADR-020 and `DESIGN.md` both state in as
/// many words.
public enum CardTemplateRegistry {
    /// The registered pairs. `CardTemplate` is `CaseIterable` and a parity
    /// test walks it, so a case added without a row here is caught before it
    /// is a template nothing selects.
    public static let registered: [CardTemplateKey: CardTemplate] = [
        CardTemplateKey(code: CardTemplate.flagToCountry.rawValue, schemaVersion: 1):
            .flagToCountry,
        CardTemplateKey(code: CardTemplate.coatOfArmsToCountry.rawValue, schemaVersion: 1):
            .coatOfArmsToCountry,
    ]

    /// The face to draw, or nil for a pair published after this release.
    public static func template(for key: CardTemplateKey) -> CardTemplate? {
        registered[key]
    }

    public static func template(for card: LearningCardRecord) -> CardTemplate? {
        template(for: CardTemplateKey(card: card))
    }

    public static func supports(_ card: LearningCardRecord) -> Bool {
        template(for: card) != nil
    }

    /// The pairs among these cards that this build cannot draw, each once.
    ///
    /// Deduplicated because an unknown template arrives by the deckful: a
    /// release that publishes a new template publishes fifty cards of it, and
    /// fifty identical reports say nothing the first one did not.
    public static func unsupportedKeys(in cards: [LearningCardRecord]) -> [CardTemplateKey] {
        var seen = Set<CardTemplateKey>()
        var keys: [CardTemplateKey] = []
        for card in cards {
            let key = CardTemplateKey(card: card)
            guard registered[key] == nil, seen.insert(key).inserted else { continue }
            keys.append(key)
        }
        return keys
    }
}

/// A card whose template this build has no renderer for.
///
/// It is an `Error` so it can be captured through the operational reporter the
/// rest of the app already uses; it is never thrown, because a template nobody
/// can draw is a fact about the release rather than a failure of the code
/// looking at it.
public struct UnsupportedCardTemplate: Error, Hashable, Sendable {
    public let key: CardTemplateKey

    public init(key: CardTemplateKey) {
        self.key = key
    }
}
