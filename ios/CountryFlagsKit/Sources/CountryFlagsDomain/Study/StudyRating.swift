import Foundation

/// How well the learner said they knew the card.
///
/// The raw values are the contract's, so a review reaches the backend without a
/// translation table that could drift.
public enum StudyRating: String, Hashable, Sendable, CaseIterable {
    case again = "AGAIN"
    case hard = "HARD"
    case good = "GOOD"
    case easy = "EASY"

    /// Whether the answer counts as recalled. `again` is the only lapse, which
    /// is what both the local projection and the backend baseline agree on.
    public var isRecall: Bool { self != .again }
}

/// How many unique cards a session asks for.
///
/// The three sizes are a product decision rather than a free number: the
/// selector guarantees unique cards, and an arbitrary size would let a caller
/// ask for more cards than a deck has and call the shortfall a bug.
public enum StudySessionSize: Int, Hashable, Sendable, CaseIterable, Identifiable {
    case five = 5
    case ten = 10
    case twenty = 20

    public var id: Int { rawValue }

    /// The stored settings carry a plain integer, so an unrecognised value
    /// falls back rather than failing a launch.
    public init(storedValue: Int) {
        self = StudySessionSize(rawValue: storedValue) ?? .ten
    }
}

/// The lifecycle of a study session.
///
/// The raw values are the contract's. They are typed here because they are
/// written by the session and read by the store: a hand-written "IN_PROGRESS"
/// on one side and an "ACTIVE" query on the other is a session that is stored
/// and never resumed, which is exactly the defect this enum removes.
public enum StudySessionStatus: String, Hashable, Sendable, CaseIterable {
    case active = "ACTIVE"
    case completed = "COMPLETED"
    case abandoned = "ABANDONED"
}

/// How a card is answered.
///
/// The raw values are the contract's, and they are typed for the same reason as
/// `StudySessionStatus`: they are written by a session and read back by a
/// resume, so a string spelled differently on the two sides is a session that
/// is stored and never picked up.
public enum StudyAnswerMode: String, Hashable, Sendable, CaseIterable {
    case selfRated = "SELF_RATED"
    case multipleChoice = "MULTIPLE_CHOICE"
}
