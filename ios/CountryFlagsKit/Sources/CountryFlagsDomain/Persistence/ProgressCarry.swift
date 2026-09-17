import Foundation

/// What moving a learner's work onto an arriving release actually moved.
///
/// Counted rather than logged as a sentence because two of these numbers are
/// answerable to a person: how much was carried, and how much could not be.
public struct CarriedProgress: Hashable, Sendable {
    public let cardStates: Int
    public let reviews: Int
    public let sessions: Int
    public let sessionCards: Int
    public let queuedOperations: Int
    /// Card states the device merged into one because the arriving release
    /// carries a card this device already had progress on. The backend's row
    /// wins over a local projection; the newer one wins between two of a kind.
    public let mergedCardStates: Int
    /// Cards the learner worked on that the arriving release does not carry.
    /// Their rows are left exactly where they are — nothing is deleted — and
    /// this is the number the learner is told.
    public let strandedCards: Int

    public init(
        cardStates: Int = 0,
        reviews: Int = 0,
        sessions: Int = 0,
        sessionCards: Int = 0,
        queuedOperations: Int = 0,
        mergedCardStates: Int = 0,
        strandedCards: Int = 0
    ) {
        self.cardStates = cardStates
        self.reviews = reviews
        self.sessions = sessions
        self.sessionCards = sessionCards
        self.queuedOperations = queuedOperations
        self.mergedCardStates = mergedCardStates
        self.strandedCards = strandedCards
    }

    public static let none = CarriedProgress()

    /// Whether anything at all happened. A device that had studied nothing
    /// before its first sync is the ordinary case, and it is silent.
    public var isEmpty: Bool {
        cardStates == 0 && reviews == 0 && sessions == 0 && sessionCards == 0
            && queuedOperations == 0 && strandedCards == 0
    }
}

/// Moves the learner's work from one release's identifiers onto another's.
///
/// Deliberately not a method on `LearningRepository`: every call there names
/// one account, and this crosses all of them on purpose. Content is shared by
/// every account on the device, so a release that renumbers it renumbers what
/// the guest owns and what a signed-in account owns alike, and the two must
/// move together or not at all.
public protocol ProgressCarrying: Sendable {
    /// Applies the mapping to everything on the device that names a card, a
    /// deck or a release.
    ///
    /// Two properties the caller depends on:
    ///
    /// - it is one transaction. A crash in the middle leaves the store exactly
    ///   as it was, never half moved;
    /// - it is idempotent. The mapping only ever names identifiers of the
    ///   release being superseded, so a second run over rows that have already
    ///   moved finds nothing of its own to change.
    @discardableResult
    func carry(_ mapping: ContentIdentityMapping) async throws -> CarriedProgress
}

/// Work the carry could not place, kept so the learner can be told about it.
///
/// The whole point of #404 is that work must not disappear without a word.
/// Almost all of it is carried; what cannot be is a card the arriving release
/// stopped publishing, and this is how that fact reaches a screen instead of
/// only a log.
public struct StrandedProgressNotice: Hashable, Sendable, Codable {
    public let cardCount: Int
    /// The release the work was done on, and the one that replaced it. Not
    /// shown to anyone — they are what makes a stored notice recognisable as
    /// belonging to a supersession that has already been reported.
    public let supersededVersion: String
    public let arrivingVersion: String
    public let noticedAt: Date

    public init(
        cardCount: Int,
        supersededVersion: String,
        arrivingVersion: String,
        noticedAt: Date
    ) {
        self.cardCount = cardCount
        self.supersededVersion = supersededVersion
        self.arrivingVersion = arrivingVersion
        self.noticedAt = noticedAt
    }
}

/// Remembers the notice until somebody has seen it.
///
/// Device bookkeeping rather than account data: it describes a catalogue
/// change, which is the same for every account on the device.
public protocol StrandedProgressNoticing: Sendable {
    func pendingNotice() -> StrandedProgressNotice?
    func store(_ notice: StrandedProgressNotice)
    /// Dropped once it has been read, so it is said once and not on every
    /// launch afterwards.
    func clearNotice()
}

/// A store for builds that have nowhere to keep one — previews and tests.
public struct NoStrandedProgressNotices: StrandedProgressNoticing {
    public init() {}
    public func pendingNotice() -> StrandedProgressNotice? { nil }
    public func store(_ notice: StrandedProgressNotice) {}
    public func clearNotice() {}
}
