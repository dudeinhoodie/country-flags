import Foundation

import CountryFlagsDomain

/// What a card's front should draw.
enum CardFace: Equatable {
    /// The store has not answered for this card yet.
    case pending
    case template(CardTemplate)
    /// A `templateCode + templateSchemaVersion` this build has no renderer
    /// for. The pair travels with the case so the screen can report exactly
    /// what it could not draw.
    case unsupported(CardTemplateKey)
}

/// Which template draws each card of a session.
///
/// The session snapshot deliberately does not carry it. The snapshot exists so
/// the card that was answered is the card that was shown, and that is about
/// the answer — the name, the prompt, the options. Which face draws it is a
/// property of the release the device is holding now, read from the store the
/// way the facts on the back are.
///
/// Read once per deck rather than per card: a sitting draws twenty cards from
/// one deck, and the store answers for the whole deck in a single call.
struct CardTemplates: Sendable {
    private let byCard: [UUID: CardTemplate]
    /// The pairs this build could not draw, kept so the screen can report
    /// each of them once rather than on every frame it redraws.
    private let unsupportedByCard: [UUID: CardTemplateKey]

    init(byCard: [UUID: CardTemplate] = [:], unsupportedByCard: [UUID: CardTemplateKey] = [:]) {
        self.byCard = byCard
        self.unsupportedByCard = unsupportedByCard
    }

    /// What to draw for a card.
    ///
    /// The three cases are distinct on purpose. "Not answered yet" is not
    /// "unsupported": the store is read after the first frame, and a card that
    /// showed the unsupported plate for that frame would accuse a perfectly
    /// ordinary flag of being a template from the future.
    func face(for learningCardID: UUID) -> CardFace {
        if let template = byCard[learningCardID] { return .template(template) }
        if let key = unsupportedByCard[learningCardID] { return .unsupported(key) }
        return .pending
    }

    /// Resolves every card of the deck, and then any card of the session the
    /// deck no longer lists.
    ///
    /// The second pass is not redundant: a running session holds cards the
    /// current release may already have retired, and a retired card still has
    /// to be drawn until the session ends.
    static func resolve(
        deckID: UUID,
        cardIDs: [UUID],
        store: ContentStore
    ) async -> CardTemplates {
        var records = await store.cards(inDeck: deckID)
        let known = Set(records.map(\.id))
        for id in cardIDs where !known.contains(id) {
            if let record = await store.card(id: id) { records.append(record) }
        }
        return CardTemplates(records: records)
    }

    init(records: [LearningCardRecord]) {
        var byCard: [UUID: CardTemplate] = [:]
        var unsupported: [UUID: CardTemplateKey] = [:]
        for record in records {
            if let template = CardTemplateRegistry.template(for: record) {
                byCard[record.id] = template
            } else {
                unsupported[record.id] = CardTemplateKey(card: record)
            }
        }
        self.init(byCard: byCard, unsupportedByCard: unsupported)
    }
}
