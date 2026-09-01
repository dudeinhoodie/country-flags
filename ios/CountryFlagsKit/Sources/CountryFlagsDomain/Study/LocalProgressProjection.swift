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

    /// The learned cards by identity rather than by count, for the one screen
    /// that joins them with something else: the result ring unions them with
    /// the cards remembered in the sitting, so a correct answer always shows
    /// even when it moved nothing in the scheduler.
    public static func learnedCardIDs(
        among cardIDs: Set<UUID>,
        states: [CardStateRecord]
    ) -> Set<UUID> {
        Set(
            states
                .filter { $0.state == "REVIEW" && cardIDs.contains($0.learningCardID) }
                .map(\.learningCardID)
        )
    }

    /// Whether a card is work the day actually owes: it has been answered at
    /// least once, and the moment it comes round has passed.
    ///
    /// There used to be a settling window here — a card in the learning steps
    /// was not counted until an hour after it came due. It existed because the
    /// scheduler brought a card back a minute after "again", so counting those
    /// returns made the queue refill inside the sitting the learner was already
    /// in. The steps are an hour, three hours and a day now
    /// (`fsrs-6-default-21-v2`), so a card that has come round is genuinely
    /// waiting, and hiding it for another hour would hide real work.
    ///
    /// `LocalCardSelection` asks the same question when it decides which cards
    /// a session is owed, so the number a screen advertises and the cards a
    /// session deals cannot disagree about what "due" means.
    static func isOwed(_ card: CardStateRecord, at now: Date) -> Bool {
        card.state != "NEW" && card.dueAt <= now
    }
}
