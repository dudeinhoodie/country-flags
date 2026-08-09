import Foundation

/// The kind of a deck, as the catalog groups it.
///
/// `kind` is an extensible enum in the contract, and there is a contract
/// fixture for a deck whose kind this build has never heard of. An unknown kind
/// therefore keeps its raw value and still reaches the screen: a deck the user
/// can open is worth more than a tidy section list, and hiding content because
/// a label is new is the failure this models against.
public enum DeckKind: Hashable, Sendable {
    case curated
    case taxonomy
    case custom
    case dynamicUser
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "CURATED": self = .curated
        case "TAXONOMY": self = .taxonomy
        case "CUSTOM": self = .custom
        case "DYNAMIC_USER": self = .dynamicUser
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .curated: "CURATED"
        case .taxonomy: "TAXONOMY"
        case .custom: "CUSTOM"
        case .dynamicUser: "DYNAMIC_USER"
        case .unknown(let value): value
        }
    }

    /// Sections appear in this order. Unknown kinds sort after every known one
    /// so a new kind cannot push the curated collections off the first screen.
    var displayRank: Int {
        switch self {
        case .curated: 0
        case .taxonomy: 1
        case .custom: 2
        case .dynamicUser: 3
        case .unknown: 4
        }
    }
}

/// One group of decks in the catalog.
public struct CatalogSection: Identifiable, Hashable, Sendable {
    public var id: String { kind.rawValue }
    public let kind: DeckKind
    public let decks: [DeckRecord]

    public init(kind: DeckKind, decks: [DeckRecord]) {
        self.kind = kind
        self.decks = decks
    }
}

/// Turns the stored decks into the catalog the user sees.
///
/// It is a pure function of the records so the same grouping can be asserted in
/// a unit test and rendered by a view without either owning the rule.
public enum CatalogGrouping {
    public static func sections(for decks: [DeckRecord]) -> [CatalogSection] {
        let grouped = Dictionary(grouping: decks) { DeckKind(rawValue: $0.kind) }
        return grouped
            .map { kind, decks in
                CatalogSection(kind: kind, decks: decks.sorted(by: Self.ordered))
            }
            .sorted { left, right in
                (left.kind.displayRank, left.kind.rawValue) < (right.kind.displayRank, right.kind.rawValue)
            }
    }

    /// The backend states the order it wants through `sortOrder`; `code` only
    /// breaks a tie so the list cannot reshuffle between launches.
    private static func ordered(_ left: DeckRecord, _ right: DeckRecord) -> Bool {
        (left.sortOrder, left.code) < (right.sortOrder, right.code)
    }
}

/// Filters the catalog by what the user typed.
///
/// Decks are searched by the text they display, which the backend has already
/// localized for the requested locale. Country names and their aliases are not
/// searched here: they belong to the cards inside a deck, and loading every
/// deck's cards to answer a catalog query would trade the whole point of the
/// cursor-paged catalog for a substring match.
public enum CatalogSearch {
    public static func decks(_ decks: [DeckRecord], matching query: String) -> [DeckRecord] {
        let needle = normalized(query)
        guard !needle.isEmpty else { return decks }
        return decks.filter { deck in
            normalized(deck.name).contains(needle) || normalized(deck.deckDescription).contains(needle)
        }
    }

    /// Cards are searched by their localized name and by the aliases the
    /// content pipeline publishes, which is what makes "Kosovo" find "Косово"
    /// while the app is in Russian.
    public static func cards(_ cards: [LearningCardRecord], matching query: String) -> [LearningCardRecord] {
        let needle = normalized(query)
        guard !needle.isEmpty else { return cards }
        return cards.filter { card in
            normalized(card.displayName).contains(needle)
                || card.aliases.contains { normalized($0).contains(needle) }
        }
    }

    /// Diacritics and case are folded so "Cote" finds "Côte" and the user does
    /// not have to reproduce an accent to reach a country.
    static func normalized(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
