import Foundation

/// Account-scoped records. Every one of them belongs to exactly one
/// `AccountScope`; the scope is supplied by the repository call rather than
/// stored in the value, so a caller cannot read one account's data by passing
/// another account's record around.

public struct UserSettingsRecord: Hashable, Sendable {
    public let sessionSize: Int
    public let contentLocale: String
    public let defaultAnswerMode: String
    public let extraFactTypes: [String]
    public let soundEnabled: Bool
    public let hapticsEnabled: Bool
    public let remindersEnabled: Bool
    /// The version the next PATCH sends as its base, which is how a settings
    /// conflict is detected instead of silently overwritten.
    public let version: Int
    public let updatedAt: Date

    public init(
        sessionSize: Int,
        contentLocale: String,
        defaultAnswerMode: String,
        extraFactTypes: [String],
        soundEnabled: Bool,
        hapticsEnabled: Bool,
        remindersEnabled: Bool,
        version: Int,
        updatedAt: Date
    ) {
        self.sessionSize = sessionSize
        self.contentLocale = contentLocale
        self.defaultAnswerMode = defaultAnswerMode
        self.extraFactTypes = extraFactTypes
        self.soundEnabled = soundEnabled
        self.hapticsEnabled = hapticsEnabled
        self.remindersEnabled = remindersEnabled
        self.version = version
        self.updatedAt = updatedAt
    }
}

/// The scheduler state of one card.
///
/// The canonical values come from the backend; a local projection may run
/// ahead of them offline and is replaced once the server answers.
public struct CardStateRecord: Hashable, Sendable {
    public let learningCardID: UUID
    public let state: String
    public let difficulty: Double
    public let stability: Double
    public let dueAt: Date
    public let repetitions: Int
    public let lapses: Int
    public let schedulerVersion: String
    /// Sent as `baseStateVersion` with the next review so the backend can order
    /// events that were produced offline.
    public let stateVersion: Int
    public let updatedAt: Date
    /// True while this row is an optimistic local projection that the backend
    /// has not confirmed.
    public let isLocalProjection: Bool

    public init(
        learningCardID: UUID,
        state: String,
        difficulty: Double,
        stability: Double,
        dueAt: Date,
        repetitions: Int,
        lapses: Int,
        schedulerVersion: String,
        stateVersion: Int,
        updatedAt: Date,
        isLocalProjection: Bool
    ) {
        self.learningCardID = learningCardID
        self.state = state
        self.difficulty = difficulty
        self.stability = stability
        self.dueAt = dueAt
        self.repetitions = repetitions
        self.lapses = lapses
        self.schedulerVersion = schedulerVersion
        self.stateVersion = stateVersion
        self.updatedAt = updatedAt
        self.isLocalProjection = isLocalProjection
    }
}

/// What the backend says is waiting, counted its way.
///
/// The device can see for itself which of the cards it holds are scheduled,
/// and it does — the queue on the first screen is a local projection, so it
/// stays right for a guest and stays right without a network. This is the
/// other half: the breakdown the device cannot compute, because a card nobody
/// on this device has ever answered has no local state to be counted in. It is
/// read rather than derived, and it goes stale by the clock rather than by an
/// edit, which is why it carries the instant the server counted at.
public struct DueSummaryRecord: Hashable, Sendable {
    public let overdue: Int
    public let learning: Int
    public let relearning: Int
    /// Cards in the REVIEW state that are due. Optional in the contract, so a
    /// release that stops sending it leaves this at zero rather than failing.
    public let review: Int
    public let newCards: Int
    public let totalDue: Int
    /// When the server counted. A reader compares it with the device's own
    /// clock and says nothing rather than showing yesterday's queue as today's.
    public let serverTime: Date

    public init(
        overdue: Int,
        learning: Int,
        relearning: Int,
        review: Int,
        newCards: Int,
        totalDue: Int,
        serverTime: Date
    ) {
        self.overdue = overdue
        self.learning = learning
        self.relearning = relearning
        self.review = review
        self.newCards = newCards
        self.totalDue = totalDue
        self.serverTime = serverTime
    }

    /// Whether the count is recent enough to put in front of someone.
    ///
    /// The queue moves with the clock — a card falls due at its own instant,
    /// not at midnight — so the summary ages out rather than expiring on a
    /// calendar boundary. Skew is treated the same in both directions: a
    /// device whose clock runs ahead of the server's has no better claim to
    /// the number than one that runs behind.
    public func isFresh(at now: Date, within window: TimeInterval = 12 * 3600) -> Bool {
        abs(now.timeIntervalSince(serverTime)) < window
    }
}

public struct DeckProgressRecord: Hashable, Sendable {
    public let deckID: UUID
    public let totalCards: Int
    public let learnedCards: Int
    public let dueCards: Int
    public let currentMasteryTier: String
    public let highestAchievementTier: String
    public let updatedAt: Date

    public init(
        deckID: UUID,
        totalCards: Int,
        learnedCards: Int,
        dueCards: Int,
        currentMasteryTier: String,
        highestAchievementTier: String,
        updatedAt: Date
    ) {
        self.deckID = deckID
        self.totalCards = totalCards
        self.learnedCards = learnedCards
        self.dueCards = dueCards
        self.currentMasteryTier = currentMasteryTier
        self.highestAchievementTier = highestAchievementTier
        self.updatedAt = updatedAt
    }
}

public struct AchievementRecord: Hashable, Sendable {
    public let id: UUID
    public let code: String
    public let category: String
    public let tier: String?
    public let scopeType: String
    public let scopeID: UUID?
    public let earnedAt: Date?

    public init(
        id: UUID,
        code: String,
        category: String,
        tier: String?,
        scopeType: String,
        scopeID: UUID?,
        earnedAt: Date?
    ) {
        self.id = id
        self.code = code
        self.category = category
        self.tier = tier
        self.scopeType = scopeType
        self.scopeID = scopeID
        self.earnedAt = earnedAt
    }
}

public struct StudySessionRecord: Hashable, Sendable {
    public let id: UUID
    public let deckID: UUID
    public let mode: String
    public let selectionOrigin: String
    public let requestedUniqueCount: Int
    public let status: String
    public let contentVersion: String
    public let startedAt: Date
    public let completedAt: Date?
    public let cards: [StudySessionCardRecord]

    public init(
        id: UUID,
        deckID: UUID,
        mode: String,
        selectionOrigin: String,
        requestedUniqueCount: Int,
        status: String,
        contentVersion: String,
        startedAt: Date,
        completedAt: Date?,
        cards: [StudySessionCardRecord]
    ) {
        self.id = id
        self.deckID = deckID
        self.mode = mode
        self.selectionOrigin = selectionOrigin
        self.requestedUniqueCount = requestedUniqueCount
        self.status = status
        self.contentVersion = contentVersion
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.cards = cards
    }
}

/// An immutable snapshot of a card as it was shown.
///
/// Content can change between the moment a session starts and the moment it is
/// answered; the snapshot keeps the answered card identical to the shown one.
public struct StudySessionCardRecord: Hashable, Sendable {
    public let id: UUID
    public let learningCardID: UUID
    public let initialOrder: Int
    public let selectionReason: String
    public let displayName: String
    public let promptAssetID: UUID
    public let revision: Int
    public let optionIDs: [UUID]
    public let optionNames: [String]

    public init(
        id: UUID,
        learningCardID: UUID,
        initialOrder: Int,
        selectionReason: String,
        displayName: String,
        promptAssetID: UUID,
        revision: Int,
        optionIDs: [UUID] = [],
        optionNames: [String] = []
    ) {
        self.id = id
        self.learningCardID = learningCardID
        self.initialOrder = initialOrder
        self.selectionReason = selectionReason
        self.displayName = displayName
        self.promptAssetID = promptAssetID
        self.revision = revision
        self.optionIDs = optionIDs
        self.optionNames = optionNames
    }
}

/// One answer, immutable once written.
///
/// The identifier is generated before the next card appears and never changes,
/// which is what makes a repeated upload a duplicate the backend can drop
/// rather than a second review.
public struct ReviewEventRecord: Hashable, Sendable {
    public let id: UUID
    public let sessionID: UUID
    public let learningCardID: UUID
    public let rating: String
    public let answerMode: String
    public let selectedOptionID: UUID?
    public let responseTimeMilliseconds: Int?
    public let clientOccurredAt: Date
    public let estimatedServerOccurredAt: Date?
    public let clientSequence: Int64
    public let baseStateVersion: Int?

    public init(
        id: UUID,
        sessionID: UUID,
        learningCardID: UUID,
        rating: String,
        answerMode: String,
        selectedOptionID: UUID?,
        responseTimeMilliseconds: Int?,
        clientOccurredAt: Date,
        estimatedServerOccurredAt: Date?,
        clientSequence: Int64,
        baseStateVersion: Int?
    ) {
        self.id = id
        self.sessionID = sessionID
        self.learningCardID = learningCardID
        self.rating = rating
        self.answerMode = answerMode
        self.selectedOptionID = selectedOptionID
        self.responseTimeMilliseconds = responseTimeMilliseconds
        self.clientOccurredAt = clientOccurredAt
        self.estimatedServerOccurredAt = estimatedServerOccurredAt
        self.clientSequence = clientSequence
        self.baseStateVersion = baseStateVersion
    }
}
