import Foundation

/// What two releases of one catalogue call the same card.
///
/// The backend allocates content identifiers in its database, so nothing the
/// client holds can predict them — which is why the catalogue this build ships
/// is stored under identifiers of its own and superseded whole by the first
/// release that arrives (ADR-021). The identifiers differ; the content does
/// not. This is the part that does not: the question the card asks, which
/// version of that question it is, and the drawing it asks it with.
///
/// The drawing is what carries the content key. A release publishes every
/// asset at a path named after the entity it belongs to — `png/germany@2x.png`
/// — so the file two releases point at is the same file, whatever row either
/// of them keeps it in. The last two components are taken rather than the
/// whole URL because the rest of it is the release's own address: a host, and
/// a folder named after the version.
public struct ContentCardIdentity: Hashable, Sendable {
    public let templateCode: String
    public let semanticVersion: Int
    public let assetType: String
    public let assetVariant: String
    /// Where the release publishes the drawing, with its address removed.
    public let assetPath: String

    public init(
        templateCode: String,
        semanticVersion: Int,
        assetType: String,
        assetVariant: String,
        assetPath: String
    ) {
        self.templateCode = templateCode
        self.semanticVersion = semanticVersion
        self.assetType = assetType
        self.assetVariant = assetVariant
        self.assetPath = assetPath
    }

    /// The tail of a published asset URL, which is the part two releases of
    /// one catalogue agree on.
    public static func path(of url: URL) -> String {
        let components = url.pathComponents.filter { $0 != "/" }
        return components.suffix(2).joined(separator: "/")
    }
}

/// One release, reduced to what identifies its decks and cards in another.
///
/// Read twice at the moment one release supersedes another, and never
/// otherwise: it materialises identifiers and five small fields per card
/// rather than the catalogue itself.
public struct ReleaseContents: Hashable, Sendable {
    public struct Card: Hashable, Sendable {
        public let id: UUID
        public let templateCode: String
        public let semanticVersion: Int
        /// The revision this release publishes. An import declares it, so a
        /// card carried across releases has to declare the arriving one.
        public let revision: Int
        public let promptAssetID: UUID
        public let promptAssetType: String
        public let promptAssetVariant: String
        public let promptAssetURL: URL

        public init(
            id: UUID,
            templateCode: String,
            semanticVersion: Int,
            revision: Int,
            promptAssetID: UUID,
            promptAssetType: String,
            promptAssetVariant: String,
            promptAssetURL: URL
        ) {
            self.id = id
            self.templateCode = templateCode
            self.semanticVersion = semanticVersion
            self.revision = revision
            self.promptAssetID = promptAssetID
            self.promptAssetType = promptAssetType
            self.promptAssetVariant = promptAssetVariant
            self.promptAssetURL = promptAssetURL
        }

        public var identity: ContentCardIdentity {
            ContentCardIdentity(
                templateCode: templateCode,
                semanticVersion: semanticVersion,
                assetType: promptAssetType,
                assetVariant: promptAssetVariant,
                assetPath: ContentCardIdentity.path(of: promptAssetURL)
            )
        }
    }

    public let contentVersion: String
    /// A deck is the same deck across releases by what it is called, which is
    /// the rule the catalogue already resolves a deck screen by.
    public let deckIDsByCode: [String: UUID]
    public let cards: [Card]

    public init(contentVersion: String, deckIDsByCode: [String: UUID], cards: [Card]) {
        self.contentVersion = contentVersion
        self.deckIDsByCode = deckIDsByCode
        self.cards = cards
    }

    public static let none = ReleaseContents(contentVersion: "", deckIDsByCode: [:], cards: [])

    public var isEmpty: Bool { deckIDsByCode.isEmpty && cards.isEmpty }
}

/// What one release's identifiers become in the release that supersedes it.
///
/// Built once, at the moment both sides are known and before either has
/// stopped being readable, and applied to everything the learner owns.
public struct ContentIdentityMapping: Hashable, Sendable {
    /// Where one card of the superseded release lands.
    public struct Card: Hashable, Sendable {
        public let id: UUID
        public let promptAssetID: UUID
        public let revision: Int

        public init(id: UUID, promptAssetID: UUID, revision: Int) {
            self.id = id
            self.promptAssetID = promptAssetID
            self.revision = revision
        }
    }

    public let supersededVersion: String
    public let arrivingVersion: String
    public let cards: [UUID: Card]
    public let decks: [UUID: UUID]
    /// Cards of the superseded release the arriving one does not carry. Work
    /// done on one of these cannot be moved anywhere, and is what the learner
    /// is told about rather than losing quietly.
    public let strandedCardIDs: Set<UUID>

    public init(
        supersededVersion: String,
        arrivingVersion: String,
        cards: [UUID: Card],
        decks: [UUID: UUID],
        strandedCardIDs: Set<UUID>
    ) {
        self.supersededVersion = supersededVersion
        self.arrivingVersion = arrivingVersion
        self.cards = cards
        self.decks = decks
        self.strandedCardIDs = strandedCardIDs
    }

    /// Whether there is anything to move at all.
    public var isEmpty: Bool { cards.isEmpty && decks.isEmpty }

    /// Matches one release's cards and decks against another's.
    ///
    /// Two rules the result has to obey, because a rewrite is applied to a
    /// store that may already have been rewritten:
    ///
    /// - a card only ever maps to a *different* identifier, so replaying the
    ///   mapping over rows it has already moved finds nothing to do;
    /// - an identity the arriving release publishes twice maps to nothing.
    ///   Guessing which of two cards a learner's work belongs to would be
    ///   worse than saying it could not be placed.
    public static func between(
        superseded: ReleaseContents,
        arriving: ReleaseContents
    ) -> ContentIdentityMapping {
        var arrivingByIdentity: [ContentCardIdentity: ReleaseContents.Card] = [:]
        var ambiguous: Set<ContentCardIdentity> = []
        for card in arriving.cards {
            let identity = card.identity
            if arrivingByIdentity.updateValue(card, forKey: identity) != nil {
                ambiguous.insert(identity)
            }
        }
        for identity in ambiguous { arrivingByIdentity.removeValue(forKey: identity) }

        var cards: [UUID: Card] = [:]
        var stranded: Set<UUID> = []
        for card in superseded.cards {
            guard let match = arrivingByIdentity[card.identity] else {
                stranded.insert(card.id)
                continue
            }
            // An identifier the arriving release kept has not moved, and a
            // mapping that named it would be a rewrite with nothing to write.
            guard match.id != card.id else { continue }
            cards[card.id] = Card(
                id: match.id,
                promptAssetID: match.promptAssetID,
                revision: match.revision
            )
        }

        var decks: [UUID: UUID] = [:]
        for (code, id) in superseded.deckIDsByCode {
            guard let arrivingID = arriving.deckIDsByCode[code], arrivingID != id else { continue }
            decks[id] = arrivingID
        }

        return ContentIdentityMapping(
            supersededVersion: superseded.contentVersion,
            arrivingVersion: arriving.contentVersion,
            cards: cards,
            decks: decks,
            strandedCardIDs: stranded
        )
    }
}
