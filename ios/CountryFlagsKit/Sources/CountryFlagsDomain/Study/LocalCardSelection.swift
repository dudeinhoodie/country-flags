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

        let ranked = usable.sorted { left, right in
            let leftRank = rank(of: left, state: stateByCard[left.id], now: now)
            let rightRank = rank(of: right, state: stateByCard[right.id], now: now)
            if leftRank != rightRank { return leftRank < rightRank }
            // A stable tiebreak, so the same deck and the same clock produce
            // the same session and a test can assert on it.
            return left.id.uuidString < right.id.uuidString
        }

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
    private static func rank(of card: LearningCardRecord, state: CardStateRecord?, now: Date) -> Int {
        guard let state else { return 1 }
        return state.dueAt <= now ? 0 : 2
    }

    private static func reason(
        for card: LearningCardRecord,
        state: CardStateRecord?,
        now: Date
    ) -> SelectionReason {
        guard let state else { return .new }
        return state.dueAt <= now ? .due : .filler
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
