import Foundation

/// Builds a session's composition from what the device already has.
///
/// The backend selects a session when there is a network. This is the offline
/// half, and it has to obey the same rules the shared golden fixtures state:
/// due cards first, unique cards only, and never a retired one.
public enum LocalCardSelection {
    /// - Parameter size: how many *unique* cards the session asks for. A deck
    ///   with fewer usable cards yields fewer; it never repeats one to reach
    ///   the number, because the chosen number means unique cards and not
    ///   showings.
    public static func select(
        from cards: [LearningCardRecord],
        states: [CardStateRecord],
        size: StudySessionSize,
        supportedTemplateSchemaVersions: [Int],
        now: Date
    ) -> [SelectedStudyCard] {
        var generator = SystemRandomNumberGenerator()
        return select(
            from: cards,
            states: states,
            size: size,
            supportedTemplateSchemaVersions: supportedTemplateSchemaVersions,
            now: now,
            using: &generator
        )
    }

    /// The full form, with the randomness handed in.
    ///
    /// The order of the bands — due, then new, then filler — is the product
    /// rule and is never random. Inside a band the cards are shuffled: ranked
    /// by identifier, a fresh install dealt the same deck in the same order on
    /// every device, and the "random" selection was a fixed sequence anybody
    /// could memorise. A test or a replay passes a seeded generator and gets
    /// the same session back; the app passes the system one.
    public static func select(
        from cards: [LearningCardRecord],
        states: [CardStateRecord],
        size: StudySessionSize,
        supportedTemplateSchemaVersions: [Int],
        now: Date,
        using generator: inout some RandomNumberGenerator
    ) -> [SelectedStudyCard] {
        let supported = Set(supportedTemplateSchemaVersions)
        let stateByCard = Dictionary(
            states.map { ($0.learningCardID, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        var seen = Set<UUID>()
        let usable = cards.filter { card in
            // A retired card stays readable for a session already using it and
            // is never selected into a new one.
            guard !card.isRetired else { return false }
            // A card this build cannot render is skipped here rather than at
            // the screen, so a session never contains a card it cannot show.
            guard supported.contains(card.templateSchemaVersion) else { return false }
            // A deck can list the same card twice; the session may not.
            return seen.insert(card.id).inserted
        }

        // Sorted into bands first — the sort is only by band, and sorting
        // before shuffling would throw the shuffle away — then shuffled within
        // each. A stable pre-shuffle order (by identifier) makes the result a
        // pure function of the deck and the seed, whatever order the store
        // returned the cards in.
        var bands: [Int: [LearningCardRecord]] = [:]
        for card in usable.sorted(by: { $0.id.uuidString < $1.id.uuidString }) {
            bands[rank(of: card, state: stateByCard[card.id], now: now), default: []].append(card)
        }
        let ranked = bands.keys.sorted().flatMap { bands[$0]!.shuffled(using: &generator) }

        return ranked.prefix(size.rawValue).enumerated().map { index, card in
            SelectedStudyCard(
                card: card,
                order: index,
                reason: reason(for: card, state: stateByCard[card.id], now: now)
            )
        }
    }

    /// Due first, then never-seen, then everything else. The order is the
    /// product rule: a learner who opens a session expects the cards they owe
    /// before the ones they have never met.
    ///
    /// "Due" is the rule the progress projection counts by, asked through the
    /// same function — so the number a screen advertises and the cards a
    /// session deals can never disagree about what is owed. A card still
    /// working through its learning steps is therefore filler here rather than
    /// a debt: it comes back inside the session on its own, and a session
    /// composed of nothing else would be one that deals a learner the cards
    /// they answered a minute ago.
    private static func rank(of card: LearningCardRecord, state: CardStateRecord?, now: Date) -> Int {
        guard let state, state.state != "NEW" else { return 1 }
        return LocalProgressProjection.isOwed(state, at: now) ? 0 : 2
    }

    private static func reason(
        for card: LearningCardRecord,
        state: CardStateRecord?,
        now: Date
    ) -> SelectionReason {
        guard let state, state.state != "NEW" else { return .new }
        return LocalProgressProjection.isOwed(state, at: now) ? .due : .filler
    }
}

public enum SelectionReason: String, Hashable, Sendable {
    case due = "DUE"
    case new = "NEW"
    /// Chosen to fill the requested size once the due and new cards ran out.
    case filler = "FILLER"
}

public struct SelectedStudyCard: Hashable, Sendable {
    public let card: LearningCardRecord
    public let order: Int
    public let reason: SelectionReason

    public init(card: LearningCardRecord, order: Int, reason: SelectionReason) {
        self.card = card
        self.order = order
        self.reason = reason
    }
}
