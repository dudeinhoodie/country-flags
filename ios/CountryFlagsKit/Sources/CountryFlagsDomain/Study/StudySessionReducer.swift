import Foundation

/// What the session screen is showing.
///
/// The state machine is pure and lives outside SwiftUI so the rules that decide
/// whether an answer can be given — and whether it can be given twice — are
/// asserted directly instead of through a view.
public enum StudySessionPhase: Hashable, Sendable {
    /// The prompt is up and the answer is not revealed.
    case front(index: Int)
    /// The answer is revealed and a rating is expected.
    case back(index: Int)
    /// A rating is being written. No further input is accepted until the store
    /// answers, which is what makes a double tap one review.
    case committing(index: Int, rating: StudyRating, reviewID: UUID)
    /// Every card has been answered.
    case finished
}

public struct StudySessionState: Hashable, Sendable {
    public let sessionID: UUID
    public let deckID: UUID
    /// The composition, fixed when the session started. Nothing re-selects
    /// cards mid-session, so a content refresh cannot change what is being
    /// studied.
    public let cards: [StudySessionCardRecord]
    public internal(set) var phase: StudySessionPhase
    /// Ratings already committed, keyed by the session card they answered.
    public internal(set) var committed: [UUID: StudyRating]

    public init(
        sessionID: UUID,
        deckID: UUID,
        cards: [StudySessionCardRecord],
        phase: StudySessionPhase,
        committed: [UUID: StudyRating] = [:]
    ) {
        self.sessionID = sessionID
        self.deckID = deckID
        self.cards = cards
        self.phase = phase
        self.committed = committed
    }

    public var currentIndex: Int? {
        switch phase {
        case .front(let index), .back(let index): index
        case .committing(let index, _, _): index
        case .finished: nil
        }
    }

    public var currentCard: StudySessionCardRecord? {
        currentIndex.flatMap { $0 < cards.count ? cards[$0] : nil }
    }

    /// What the progress line shows: the card being answered out of the total.
    public var position: Int { (currentIndex ?? cards.count) + 1 }

    public var isAnswerRevealed: Bool {
        switch phase {
        case .front: false
        case .back, .committing: true
        case .finished: false
        }
    }

    /// True while a rating is being written, which the view uses to disable the
    /// buttons rather than to hide them.
    public var isCommitting: Bool {
        if case .committing = phase { return true }
        return false
    }
}

/// What the outside world tells the session.
public enum StudySessionEvent: Hashable, Sendable {
    case revealAnswer
    /// - Parameter reviewID: created by the caller *before* the transition, so
    ///   the identifier of the review is fixed before anything can retry it.
    case rate(StudyRating, reviewID: UUID)
    case commitSucceeded
    /// The write was rolled back, so the card is shown again with its answer
    /// still revealed and no review recorded.
    case commitFailed
}

/// What the caller must do because of a transition.
public enum StudySessionEffect: Hashable, Sendable {
    /// Write this review and its outbox entry in one transaction, then report
    /// back with `commitSucceeded` or `commitFailed`.
    case commit(reviewID: UUID, card: StudySessionCardRecord, rating: StudyRating)
    /// Every card is answered; the result screen can be built from the store.
    case complete
}

/// The rules of a self-rated session.
///
/// It is a free function over a value, so a test states a state and an event
/// and reads the next state — no clock, no store, no view.
public enum StudySessionReducer {
    @discardableResult
    public static func reduce(
        _ state: inout StudySessionState,
        _ event: StudySessionEvent
    ) -> StudySessionEffect? {
        switch (state.phase, event) {
        case (.front(let index), .revealAnswer):
            state.phase = .back(index: index)
            return nil

        case (.back(let index), .rate(let rating, let reviewID)):
            guard index < state.cards.count else { return nil }
            state.phase = .committing(index: index, rating: rating, reviewID: reviewID)
            return .commit(reviewID: reviewID, card: state.cards[index], rating: rating)

        case (.committing(let index, let rating, _), .commitSucceeded):
            state.committed[state.cards[index].id] = rating
            let next = index + 1
            if next < state.cards.count {
                state.phase = .front(index: next)
                return nil
            }
            state.phase = .finished
            return .complete

        case (.committing(let index, _, _), .commitFailed):
            // The answer stays revealed: the learner already saw it, and
            // sending them back to the prompt would ask them to answer a card
            // they have effectively been shown.
            state.phase = .back(index: index)
            return nil

        // Everything else is input that arrived in a state that cannot use it.
        // A second tap during a commit is the case this exists for: it is
        // dropped rather than queued, so one gesture is one review.
        default:
            return nil
        }
    }
}
