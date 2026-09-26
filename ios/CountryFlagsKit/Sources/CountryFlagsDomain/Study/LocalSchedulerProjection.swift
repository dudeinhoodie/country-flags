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
        let step = step(base: base, rating: rating)
        // `repetitions` here counts recalls in a row, which is what the ladder
        // reads: two `GOOD` in a row graduate a learning card. A lapse is only
        // a lapse from `REVIEW`, as on the server; a new card answered
        // `AGAIN` has nothing to lapse from.
        let repetitions = rating.isRecall ? (base?.repetitions ?? 0) + 1 : 0
        let lapses = (base?.lapses ?? 0) + (rating == .again && base?.state == "REVIEW" ? 1 : 0)

        return CardStateRecord(
            learningCardID: cardID,
            state: step.state,
            // Difficulty and stability are the backend's model. Carrying the
            // last canonical values forward, rather than inventing new ones,
            // keeps this projection from looking like a second scheduler.
            difficulty: base?.difficulty ?? 0,
            stability: base?.stability ?? 0,
            dueAt: now.addingTimeInterval(step.interval),
            repetitions: repetitions,
            lapses: lapses,
            schedulerVersion: version,
            stateVersion: (base?.stateVersion ?? 0) + 1,
            updatedAt: now,
            isLocalProjection: true
        )
    }

    /// How long until the card comes back.
    static func interval(base: CardStateRecord?, rating: StudyRating) -> TimeInterval {
        step(base: base, rating: rating).interval
    }

    /// The server's ladder, without its arithmetic (ADR-026).
    ///
    /// `fsrs-6-default-21-v4` walks a new card through `3h`, `3h`, `1d`: the
    /// first `GOOD` asks for three hours in `LEARNING`, the second graduates it
    /// to `REVIEW` a day out. `AGAIN` on a card that never graduated keeps it in
    /// `LEARNING` three hours out; `AGAIN` on a graduated card sends it to
    /// `RELEARNING` three hours out, and the next `GOOD` returns it to `REVIEW`
    /// a day out. Played from a new card on this device, that agrees with the
    /// server on every state and every date up to a day
    /// (`contracts/fixtures/scheduler/fsrs-6-default-v4*.json`).
    ///
    /// Past graduation it stays conservative and never promises more than a
    /// day: showing a card sooner than the backend would costs the learner a
    /// little repetition, while showing it later would silently drop it out of
    /// their queue until the next sync, and the server's state replaces this
    /// one wholesale anyway. Two cases cannot be known here and take the
    /// sooner answer: a canonical `LEARNING` state, whose rung the server did
    /// not send, asks for three hours; and an `AGAIN` on a graduated card
    /// whose stability keeps it in `REVIEW` on the server is `RELEARNING`
    /// three hours out here.
    private static func step(
        base: CardStateRecord?,
        rating: StudyRating
    ) -> (state: String, interval: TimeInterval) {
        let hour: TimeInterval = 60 * 60
        let day: TimeInterval = 24 * hour
        let graduated = base?.state == "REVIEW" || base?.state == "RELEARNING"

        switch rating {
        case .again:
            return (graduated ? "RELEARNING" : "LEARNING", 3 * hour)
        case .good:
            if graduated { return ("REVIEW", day) }
            guard let base, base.state == "LEARNING" else {
                // Never answered, or a state this build does not recognise:
                // the first rung.
                return ("LEARNING", 3 * hour)
            }
            // The rung is only known for a chain this device projected
            // itself: one recall in a row means the first rung is behind.
            if base.isLocalProjection, base.repetitions >= 1 {
                return ("REVIEW", day)
            }
            return ("LEARNING", 3 * hour)
        }
    }
}
