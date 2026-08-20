import Foundation

/// What a deck looks like from the device's own records.
public struct LocalDeckProgress: Hashable, Sendable {
    public let deckID: UUID
    public let totalCards: Int
    /// Cards the learner has answered at least once. A card nobody has seen is
    /// not progress, however it was scheduled.
    public let startedCards: Int
    /// Cards that graduated to the REVIEW state: the learning steps are behind
    /// them and their interval is measured in days. This is the honest
    /// "learned" — started merely means touched.
    public let learnedCards: Int
    /// Cards that have been started and are scheduled at or before now.
    public let dueCards: Int

    public init(
        deckID: UUID,
        totalCards: Int,
        startedCards: Int,
        learnedCards: Int,
        dueCards: Int
    ) {
        self.deckID = deckID
        self.totalCards = totalCards
        self.startedCards = startedCards
        self.learnedCards = learnedCards
        self.dueCards = dueCards
    }

    public var isUntouched: Bool { startedCards == 0 }
}

/// Counts a learner's progress from what the device already knows.
///
/// The counts are facts the device can see for itself — which cards exist in a
/// deck, which have been answered, which are scheduled — so they are computed
/// here rather than waited for. Mastery is deliberately absent: the tiers and
/// their thresholds are the server's decision, this client only displays the
/// one it is told, and a locally invented tier would contradict the server the
/// moment one arrived.
///
/// This is what makes the progress screen work for a guest, whose work is
/// durable on the device but is never uploaded until there is an account to
/// attribute it to.
public enum LocalProgressProjection {
    /// How long a card in the learning steps is left out of the day's queue.
    ///
    /// The scheduler brings a card being learned back after a minute, then ten
    /// — `learning_steps: ["1m", "10m"]` on the backend, and the same orders in
    /// `LocalSchedulerProjection`. Those returns are part of the sitting the
    /// learner is already in: counting them made the queue refill a minute
    /// after every session and read as work that had appeared out of nowhere.
    ///
    /// An hour is comfortably past every step, so nothing that is merely
    /// mid-sitting is hidden by it, and a card still unanswered an hour later
    /// is genuinely left behind rather than in flight.
    static let learningSettlingWindow: TimeInterval = 3600

    /// - Parameters:
    ///   - cardsByDeck: the cards each deck contains.
    ///   - states: the scheduler state of every card the learner has answered.
    ///   - now: the instant "due" is measured against.
    public static func progress(
        cardsByDeck: [UUID: [UUID]],
        states: [CardStateRecord],
        now: Date
    ) -> [LocalDeckProgress] {
        let statesByCard = Dictionary(
            states.map { ($0.learningCardID, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        return cardsByDeck
            .map { deckID, cardIDs in
                let known = cardIDs.compactMap { statesByCard[$0] }
                return LocalDeckProgress(
                    deckID: deckID,
                    totalCards: cardIDs.count,
                    startedCards: known.count { $0.state != "NEW" },
                    learnedCards: known.count { $0.state == "REVIEW" },
                    dueCards: known.count { isOwed($0, at: now) }
                )
            }
            .sorted { $0.deckID.uuidString < $1.deckID.uuidString }
    }

    /// Whether a card is work the day actually owes.
    ///
    /// A repetition is: its interval is measured in days, and the moment it
    /// comes round is the moment it is due. A card in the learning steps is
    /// not, while it is still settling — it returns inside the session on its
    /// own, and the session is what brings it back. Once it has been waiting
    /// longer than that, nobody is coming back for it within the sitting and it
    /// belongs in the queue like anything else.
    ///
    /// `LocalCardSelection` asks the same question when it decides which cards
    /// a session is owed, so the number a screen advertises and the cards a
    /// session deals cannot disagree about what "due" means.
    static func isOwed(_ card: CardStateRecord, at now: Date) -> Bool {
        guard card.state != "NEW", card.dueAt <= now else { return false }
        guard card.state == "LEARNING" || card.state == "RELEARNING" else { return true }
        return now.timeIntervalSince(card.dueAt) > learningSettlingWindow
    }
}
