import Foundation

/// The optimistic card state the app shows until the backend answers.
///
/// It is deliberately conservative and deliberately labelled. The backend
/// baseline is FSRS-6 and it is the source of truth for `dueAt`; anything
/// computed here exists so a learner can finish several sessions without a
/// network and still see their progress move. Every state it produces carries
/// `isLocalProjection`, and the backend's state replaces it wholesale after a
/// sync rather than being merged with it.
public enum LocalSchedulerProjection {
    /// The name written into `schedulerVersion`, so a state that came from here
    /// is identifiable in the store and in a diagnostic without inspecting a
    /// flag.
    public static let version = "local-conservative-1"

    /// - Parameter base: the canonical state if the device has one. A card
    ///   answered for the first time has none.
    public static func project(
        base: CardStateRecord?,
        cardID: UUID,
        rating: StudyRating,
        now: Date
    ) -> CardStateRecord {
        let repetitions = rating.isRecall ? (base?.repetitions ?? 0) + 1 : 0
        let lapses = (base?.lapses ?? 0) + (rating.isRecall ? 0 : 1)
        let interval = interval(base: base, rating: rating)

        return CardStateRecord(
            learningCardID: cardID,
            state: state(for: rating, repetitions: repetitions),
            // Difficulty and stability are the backend's model. Carrying the
            // last canonical values forward, rather than inventing new ones,
            // keeps this projection from looking like a second scheduler.
            difficulty: base?.difficulty ?? 0,
            stability: base?.stability ?? 0,
            dueAt: now.addingTimeInterval(interval),
            repetitions: repetitions,
            lapses: lapses,
            schedulerVersion: version,
            stateVersion: (base?.stateVersion ?? 0) + 1,
            updatedAt: now,
            isLocalProjection: true
        )
    }

    /// Short, growing intervals that never promise more than a day or so.
    ///
    /// Being conservative is the point: showing a card sooner than the backend
    /// would costs the learner a little repetition, while showing it later
    /// would silently drop it out of their queue until the next sync.
    static func interval(base: CardStateRecord?, rating: StudyRating) -> TimeInterval {
        switch rating {
        case .again: 60
        case .hard: 10 * 60
        case .good: base.map { _ in 24 * 60 * 60 } ?? 60 * 60
        case .easy: base.map { _ in 3 * 24 * 60 * 60 } ?? 24 * 60 * 60
        }
    }

    private static func state(for rating: StudyRating, repetitions: Int) -> String {
        switch rating {
        case .again: "RELEARNING"
        case .hard, .good: repetitions >= 2 ? "REVIEW" : "LEARNING"
        case .easy: "REVIEW"
        }
    }
}
