import Foundation

/// One page of a content release on its way into the store.
///
/// A release arrives over many cursor-paged requests, so it is applied a page
/// at a time rather than held in memory until the last one lands. Every field
/// is optional in practice: a page of decks carries no cards, and a page of
/// cards carries no decks.
public struct ContentPage: Hashable, Sendable {
    public let entities: [GeoEntityRecord]
    public let decks: [DeckRecord]
    public let cards: [LearningCardRecord]
    public let deckCards: [DeckCardRecord]
    /// Assets referenced by the records in this page.
    ///
    /// They are carried separately because a card names its prompt by
    /// identifier while the payload that delivers the card embeds the whole
    /// asset. Storing them as their own records is what lets a card page be
    /// applied without also fetching the entity behind it.
    public let assets: [AssetRecord]

    public init(
        entities: [GeoEntityRecord] = [],
        decks: [DeckRecord] = [],
        cards: [LearningCardRecord] = [],
        deckCards: [DeckCardRecord] = [],
        assets: [AssetRecord] = []
    ) {
        self.entities = entities
        self.decks = decks
        self.cards = cards
        self.deckCards = deckCards
        self.assets = assets
    }

    public var isEmpty: Bool {
        entities.isEmpty && decks.isEmpty && cards.isEmpty && deckCards.isEmpty && assets.isEmpty
    }
}

/// A release a build carries inside itself, ready to be stored.
///
/// The catalogue the app opens on before any network answers: one manifest and
/// the records it names, produced from the same content release the bundled
/// flags come from. It is a baseline and never the truth — the first
/// successful synchronisation replaces it whole — so it is a value handed to
/// the coordinator rather than anything the store distinguishes.
public struct BundledContentSeed: Hashable, Sendable {
    public let manifest: ContentManifestRecord
    public let page: ContentPage

    public init(manifest: ContentManifestRecord, page: ContentPage) {
        self.manifest = manifest
        self.page = page
    }

    /// What a seeded release's version starts with.
    ///
    /// `ios/Scripts/sync-bundled-catalog.mjs` writes `bundled:<release>`, and
    /// the marker is what tells a release nobody published from one a server
    /// did. Named here because two decisions turn on it: the seed is never
    /// mistaken for the truth, and the work done on it is carried onto the
    /// release that supersedes it (#404).
    public static let versionPrefix = "bundled:"

    /// Whether a stored release is one a build seeded itself with.
    public static func isSeeded(version: String) -> Bool {
        version.hasPrefix(versionPrefix)
    }
}

/// Where an interrupted download resumes.
///
/// It is written in the same transaction as the page it describes, which is
/// what makes "the cursor moves only after the page is applied" true rather
/// than merely intended: a crash between the two is not representable.
public struct ContentStagingState: Hashable, Sendable {
    public enum Stage: String, Hashable, Sendable, CaseIterable {
        /// Still paging the deck list.
        case decks
        /// Still paging the cards of `pendingDeckIDs.first`.
        case cards
        /// Every page is in the store; the release is waiting to be committed.
        case ready
    }

    public let contentVersion: String
    public let stage: Stage
    /// The cursor for the next page of `stage`. Nil means "start this stage
    /// from the beginning", which is also what a fresh state carries.
    public let cursor: String?
    /// Decks whose cards have not been downloaded yet, in the order they will
    /// be. The head is the deck `cursor` belongs to while the stage is `cards`.
    public let pendingDeckIDs: [UUID]
    /// How many records have been applied for the thing being paged right now:
    /// the deck list, or the cards of `pendingDeckIDs.first`.
    ///
    /// It is the sort offset of the next page. It cannot be counted from the
    /// store instead, because a listing answers from the release that is
    /// current and the release being downloaded is by definition not.
    public let appliedInStage: Int
    public let updatedAt: Date

    public init(
        contentVersion: String,
        stage: Stage,
        cursor: String?,
        pendingDeckIDs: [UUID],
        appliedInStage: Int = 0,
        updatedAt: Date
    ) {
        self.contentVersion = contentVersion
        self.stage = stage
        self.cursor = cursor
        self.pendingDeckIDs = pendingDeckIDs
        self.appliedInStage = appliedInStage
        self.updatedAt = updatedAt
    }

    /// The state a bootstrap of a version starts from.
    public static func initial(contentVersion: String, at date: Date) -> ContentStagingState {
        ContentStagingState(
            contentVersion: contentVersion,
            stage: .decks,
            cursor: nil,
            pendingDeckIDs: [],
            appliedInStage: 0,
            updatedAt: date
        )
    }
}
