import Foundation
import Observation

import CountryFlagsDomain

/// What the review carries to the backend once there is a network.
///
/// It is encoded when the review is recorded and stored as bytes, so a later
/// build cannot change what an earlier one promised to send.
struct PendingReviewPayload: Codable, Hashable, Sendable {
    let reviewID: UUID
    let sessionID: UUID
    let learningCardID: UUID
    let rating: String
    let answerMode: String
    let clientOccurredAt: Date
    let clientSequence: Int64
    let baseStateVersion: Int?
    /// Objective answers only. The uploader needs it to build the event the
    /// contract expects, and it is stored rather than rebuilt so a later build
    /// cannot change what an earlier one promised to send.
    let selectedOptionID: UUID?
}

public enum StudySessionStartFailure: Hashable, Sendable {
    /// The deck has no card this build can study.
    case noUsableCards
    /// A due-only session found the repeat queue empty. Honest and happy:
    /// there is nothing to review right now, which is not an error.
    case nothingDue
    /// The store refused, so nothing was started.
    case storeUnavailable
}

/// Drives one study session: selects the cards, keeps the state machine, and
/// makes every rating durable before the next card appears.
///
/// The rules live in `StudySessionReducer`; this object owns the clock, the
/// identifiers and the store, which is the part a unit test injects.
@MainActor
@Observable
public final class StudySessionRunner {
    public private(set) var state: StudySessionState?
    public private(set) var startFailure: StudySessionStartFailure?
    /// Set when a write was rolled back, so the screen can say the answer was
    /// not saved instead of moving on.
    public private(set) var lastCommitFailed = false
    public private(set) var summary: StudySessionSummary?

    private let scopes: any AccountScopeResolving
    /// Resolved once, when the session starts. A session belongs to the account
    /// that began it and must not change identity halfway through.
    private var scope: AccountScope?
    private let content: any ContentRepository
    private let learning: any LearningRepository
    /// What has not reached the backend yet. Read for one question only:
    /// whether the backend's view is complete enough to be believed when it
    /// says nothing is due.
    private let outbox: (any OutboxRepository)?
    /// The backend as composer, when the build carries one. The local
    /// selection below remains the offline half and the fallback.
    private let selection: (any StudySessionSelecting)?
    private let dates: any DateProviding
    private let identifiers: any IdentifierProviding
    private let analytics: (any AnalyticsTracking)?
    /// When the session on screen started, for the duration bucket the
    /// completed event carries. Held here rather than read from the record so a
    /// resumed session reports the sitting rather than the calendar time since
    /// it was first opened.
    private var startedAt: Date?

    public init(
        scopes: any AccountScopeResolving,
        content: any ContentRepository,
        learning: any LearningRepository,
        selection: (any StudySessionSelecting)? = nil,
        outbox: (any OutboxRepository)? = nil,
        analytics: (any AnalyticsTracking)? = nil,
        dates: any DateProviding = SystemDateProvider(),
        identifiers: any IdentifierProviding = SystemIdentifierProvider()
    ) {
        self.scopes = scopes
        self.content = content
        self.learning = learning
        self.outbox = outbox
        self.selection = selection
        self.analytics = analytics
        self.dates = dates
        self.identifiers = identifiers
    }

    /// The scope of the session in progress. Reading it before a session has
    /// started is a programming error rather than a runtime case: every caller
    /// goes through `startOrResume` first.
    private var resolvedScope: AccountScope {
        guard let scope else {
            preconditionFailure("The session scope is resolved before any store access")
        }
        return scope
    }

    // MARK: - Starting and resuming

    /// Picks up an unfinished session for the deck, or starts a new one.
    ///
    /// Resuming comes first: a learner who closed the app mid-session expects
    /// the card they were on, not a fresh selection that discards their
    /// answers.
    public func startOrResume(
        deckID: UUID,
        size: StudySessionSize,
        composition: StudySessionComposition = .standard
    ) async {
        if scope == nil { scope = await scopes.currentScope() }
        startedAt = dates.now()
        if await resume(deckID: deckID, composition: composition) {
            await reportSessionStarted(requestedCardCount: state?.cards.count ?? 0)
            return
        }
        await start(deckID: deckID, size: size, composition: composition)
        await reportSessionStarted(requestedCardCount: size.rawValue)
    }

    /// The session's shape, never its contents: the mode and how many cards
    /// were asked for. Which countries they were is not a product question.
    private func reportSessionStarted(requestedCardCount: Int) async {
        guard let analytics, state != nil else { return }
        await analytics.track(
            .studySessionStarted(
                mode: .selfRated,
                requestedCardCount: requestedCardCount,
                at: dates.now()
            )
        )
    }

    /// Reported when the learner leaves a session with cards still owed. The
    /// bucket says how far they got; the answers themselves stay where they
    /// are, in the store and in the outbox.
    public func reportAbandonment() async {
        guard let analytics, let session = state, summary == nil else { return }
        // What was actually committed, which is also what the outbox holds:
        // a card revealed but not rated is not an answer.
        let answered = session.committed.count
        await analytics.track(
            .studySessionAbandoned(
                mode: .selfRated,
                progress: AnalyticsProgressBucket(
                    answered: answered,
                    planned: session.cards.count
                ),
                at: dates.now()
            )
        )
    }

    /// - Returns: whether an unfinished session was picked up.
    private func resume(deckID: UUID, composition: StudySessionComposition) async -> Bool {
        guard let session = try? await learning.activeSession(for: resolvedScope),
            session.deckID == deckID,
            // A session belongs to the mode that started it. Without this
            // check an unfinished quiz was picked up as a deck of cards, and
            // its reviews were recorded as self-rated answers inside a
            // multiple-choice session — a contract violation waiting for the
            // first upload.
            session.mode == StudyAnswerMode.selfRated.rawValue,
            !session.cards.isEmpty,
            // A due-only launch promises the repeat queue and nothing else.
            // The record does not store its composition, but the snapshot
            // wears it: a session holding a new or padding card is not the
            // repeat queue, and picking it up would break the promise the
            // button just made — it is abandoned by the fresh start instead.
            // A standard launch resumes anything: a learner who closed the
            // app mid-session expects their cards back, whatever they are.
            composition == .standard || session.cards.allSatisfy(Self.belongsToRepeatQueue)
        else {
            return false
        }

        // The store, not the screen, decides how far the session got: a review
        // that committed is answered, and one that did not is still owed. That
        // is what makes a kill before the commit reshow the same card and a
        // kill after it move on.
        let reviews = (try? await learning.reviews(inSession: session.id, for: resolvedScope)) ?? []
        let answered = Set(reviews.map(\.learningCardID))
        let nextIndex = session.cards.firstIndex { !answered.contains($0.learningCardID) }

        var committed: [UUID: StudyRating] = [:]
        for card in session.cards {
            if let review = reviews.first(where: { $0.learningCardID == card.learningCardID }),
                let rating = StudyRating(rawValue: review.rating)
            {
                committed[card.id] = rating
            }
        }

        state = StudySessionState(
            sessionID: session.id,
            deckID: session.deckID,
            cards: session.cards,
            phase: nextIndex.map { .front(index: $0) } ?? .finished,
            committed: committed
        )
        if nextIndex == nil { await buildSummary() }
        return true
    }

    /// What this device is still holding for the backend.
    private func unsentAnswers() async -> [OutboxOperationRecord] {
        guard let outbox else { return [] }
        return (try? await outbox.pendingOperations(for: resolvedScope)) ?? []
    }

    /// Whether a card snapshot belongs to the repeat queue. The reasons come
    /// from two vocabularies — the backend's and the local selector's — and
    /// the padding bands are what a due-only session must not contain.
    private static func belongsToRepeatQueue(_ card: StudySessionCardRecord) -> Bool {
        !["NEW", "MAINTENANCE", "FILLER"].contains(card.selectionReason)
    }

    private func start(
        deckID: UUID,
        size: StudySessionSize,
        composition: StudySessionComposition
    ) async {
        // The backend composes when it can: it has seen every device's
        // answers, so its selection is the canonical one. Every failure —
        // offline, a refusal, an empty answer — falls through to the local
        // composition, which is the whole reason the local half exists.
        if let selection, case .authenticated = resolvedScope {
            do {
                let record = try await selection.serverSession(
                    id: identifiers.next(),
                    deckID: deckID,
                    size: size,
                    mode: .selfRated,
                    composition: composition
                )
                if !record.cards.isEmpty {
                    try await learning.saveSession(record, for: resolvedScope)
                    startFailure = nil
                    state = StudySessionState(
                        sessionID: record.id,
                        deckID: record.deckID,
                        cards: record.cards,
                        phase: .front(index: 0)
                    )
                    return
                }
                if composition == .dueOnly {
                    // The zero-card session is closed out, best effort, so it
                    // does not linger ACTIVE on the backend.
                    await selection.completeSession(id: record.id)

                    // Whose answer counts is decided by one question: is this
                    // device holding answers the backend has not received?
                    //
                    // If it is not, the backend has seen everything from every
                    // device and its "nothing is due" is the truth — the first
                    // screen shows the same number from the same place, so the
                    // two cannot contradict each other. If it is, the backend
                    // is counting an older world, and the device composes
                    // below. That is the disagreement that used to open an
                    // empty session under a pane advertising twelve cards.
                    // No outbox to ask means nothing is known to be waiting,
                    // and the backend's answer stands.
                    let unsent = await unsentAnswers()
                    if unsent.isEmpty {
                        startFailure = .nothingDue
                        return
                    }
                }
            } catch {
                // Fall through: the device composes, the way it always could.
            }
        }

        let manifest = try? await content.currentManifest()
        let cards = (try? await content.cards(inDeck: deckID)) ?? []
        let states = (try? await learning.cardStates(for: resolvedScope)) ?? []

        let selected = LocalCardSelection.select(
            from: cards,
            states: states,
            size: size,
            supportedTemplateSchemaVersions: manifest?.supportedTemplateSchemaVersions ?? [],
            now: dates.now()
        )
        // Offline, the due-only promise still holds: the local bands mark
        // every card with its reason, and the queue is the due band alone.
        let composed = composition == .dueOnly
            ? selected.filter { $0.reason == .due }
            : selected
        guard !composed.isEmpty else {
            // An empty repeat queue is good news, not a broken deck.
            startFailure = composition == .dueOnly ? .nothingDue : .noUsableCards
            return
        }

        let sessionID = identifiers.next()
        let snapshot = composed.map { selection in
            StudySessionCardRecord(
                id: identifiers.next(),
                learningCardID: selection.card.id,
                initialOrder: selection.order,
                selectionReason: selection.reason.rawValue,
                // The snapshot is what makes the answered card identical to the
                // shown one, whatever a later content release does.
                displayName: selection.card.displayName,
                promptAssetID: selection.card.promptAssetID,
                revision: selection.card.revision,
                optionIDs: [],
                optionNames: []
            )
        }

        let session = StudySessionRecord(
            id: sessionID,
            deckID: deckID,
            mode: StudyAnswerMode.selfRated.rawValue,
            // The composition was assembled on the device, which is what the
            // backend needs to know when the session is imported later.
            selectionOrigin: "CLIENT_OFFLINE",
            requestedUniqueCount: size.rawValue,
            status: StudySessionStatus.active.rawValue,
            contentVersion: manifest?.contentVersion ?? "",
            startedAt: dates.now(),
            completedAt: nil,
            cards: snapshot
        )

        // Whatever was active is not being resumed — a different deck, or a
        // different mode — so it is closed rather than left active forever:
        // an orphaned active session would be the one `activeSession` answers
        // with on some later launch. Read before the new session is saved,
        // because afterwards the active session is the new one.
        let stale = try? await learning.activeSession(for: resolvedScope)

        do {
            try await learning.saveSession(session, for: resolvedScope)
        } catch {
            startFailure = .storeUnavailable
            return
        }

        if let stale, stale.id != sessionID {
            await abandon(stale)
        }

        startFailure = nil
        state = StudySessionState(
            sessionID: sessionID,
            deckID: deckID,
            cards: snapshot,
            phase: .front(index: 0)
        )
    }

    /// The answers already committed stay committed; only the lifecycle moves.
    private func abandon(_ session: StudySessionRecord) async {
        try? await learning.saveSession(
            StudySessionRecord(
                id: session.id,
                deckID: session.deckID,
                mode: session.mode,
                selectionOrigin: session.selectionOrigin,
                requestedUniqueCount: session.requestedUniqueCount,
                status: StudySessionStatus.abandoned.rawValue,
                contentVersion: session.contentVersion,
                startedAt: session.startedAt,
                completedAt: dates.now(),
                cards: session.cards
            ),
            for: resolvedScope
        )
    }

    // MARK: - Answering

    public func revealAnswer() {
        guard var current = state else { return }
        StudySessionReducer.reduce(&current, .revealAnswer)
        state = current
    }

    /// Records a rating.
    ///
    /// The review identifier is created before the transition, so the review
    /// being written is fixed before anything can retry it, and a second tap
    /// arriving mid-write is dropped by the reducer rather than queued.
    public func rate(_ rating: StudyRating) async {
        guard var current = state else { return }
        let reviewID = identifiers.next()
        guard let effect = StudySessionReducer.reduce(&current, .rate(rating, reviewID: reviewID))
        else {
            state = current
            return
        }
        state = current
        lastCommitFailed = false

        guard case .commit(let id, let card, let committedRating) = effect else { return }
        let succeeded = await commit(reviewID: id, card: card, rating: committedRating)

        guard var next = state else { return }
        let followUp = StudySessionReducer.reduce(
            &next,
            succeeded ? .commitSucceeded : .commitFailed
        )
        state = next
        lastCommitFailed = !succeeded
        if followUp == .complete { await complete() }
    }

    /// Writes the review, its projected card state and its outbox entry in one
    /// transaction. The session may not advance until this commits: a review
    /// that reached the screen but not the store is work the learner did and
    /// the device lost.
    private func commit(reviewID: UUID, card: StudySessionCardRecord, rating: StudyRating) async
        -> Bool
    {
        guard let session = state else { return false }
        let now = dates.now()
        let states = (try? await learning.cardStates(for: resolvedScope)) ?? []
        let base = states.first { $0.learningCardID == card.learningCardID }

        let review = ReviewEventRecord(
            id: reviewID,
            sessionID: session.sessionID,
            learningCardID: card.learningCardID,
            rating: rating.rawValue,
            answerMode: StudyAnswerMode.selfRated.rawValue,
            selectedOptionID: nil,
            responseTimeMilliseconds: nil,
            clientOccurredAt: now,
            estimatedServerOccurredAt: nil,
            // The backend requires the sequence to be unique per device, not
            // per session: numbering each session from one collided on the
            // second session ever run, and only the first twenty answers of a
            // device were ever accepted. Wall-clock milliseconds are unique at
            // the speed a human answers and monotonic across sessions,
            // reinstalls and cleared stores alike.
            clientSequence: Int64(now.timeIntervalSince1970 * 1000),
            baseStateVersion: base?.stateVersion
        )
        let projected = LocalSchedulerProjection.project(
            base: base,
            cardID: card.learningCardID,
            rating: rating,
            now: now
        )

        let payload = PendingReviewPayload(
            reviewID: reviewID,
            sessionID: session.sessionID,
            learningCardID: card.learningCardID,
            rating: rating.rawValue,
            answerMode: StudyAnswerMode.selfRated.rawValue,
            clientOccurredAt: now,
            clientSequence: review.clientSequence,
            baseStateVersion: base?.stateVersion,
            selectedOptionID: nil
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let encoded = try? encoder.encode(payload) else { return false }

        let outbox = OutboxOperationRecord(
            id: identifiers.next(),
            kind: .reviewBatch,
            // The session has to reach the backend before the reviews that
            // refer to it.
            dependencyID: session.sessionID,
            payload: encoded,
            state: .pending,
            attemptCount: 0,
            lastFailureCode: nil,
            createdAt: now,
            updatedAt: now
        )

        do {
            try await learning.recordReview(
                review,
                projectedState: projected,
                outbox: outbox,
                for: resolvedScope
            )
            return true
        } catch {
            return false
        }
    }

    private func complete() async {
        guard let session = state else { return }
        var finishedServerSession = false
        if let stored = try? await learning.activeSession(for: resolvedScope), stored.id == session.sessionID {
            finishedServerSession = stored.selectionOrigin == "SERVER"
            try? await learning.saveSession(
                StudySessionRecord(
                    id: stored.id,
                    deckID: stored.deckID,
                    mode: stored.mode,
                    selectionOrigin: stored.selectionOrigin,
                    requestedUniqueCount: stored.requestedUniqueCount,
                    status: StudySessionStatus.completed.rawValue,
                    contentVersion: stored.contentVersion,
                    startedAt: stored.startedAt,
                    completedAt: dates.now(),
                    cards: stored.cards
                ),
                for: resolvedScope
            )
        }
        // A session the backend composed is reported finished to it, best
        // effort: the reviews already carry the learning either way.
        if finishedServerSession {
            await selection?.completeSession(id: session.sessionID)
        }
        await buildSummary()
        await reportSessionCompleted()
    }

    /// The completed session as a shape: how many cards, how long, how well —
    /// the last two as buckets, because the product question is "quick or
    /// slow" and "well or badly", and a precise figure is one more thing that
    /// can identify somebody.
    private func reportSessionCompleted() async {
        guard let analytics, let summary else { return }
        let remembered = summary.ratings
            .filter { $0.key != .again }
            .reduce(0) { $0 + $1.value }
        let answered = summary.ratings.values.reduce(0, +)
        await analytics.track(
            .studySessionCompleted(
                mode: .selfRated,
                // Every deck this build has comes from the published catalog;
                // dynamic and custom decks are not a thing yet, and reporting
                // one would be reporting something that does not exist.
                deckType: .system,
                requestedCardCount: summary.plannedCards,
                uniqueCardCount: summary.answered.count,
                reviewCount: answered,
                duration: AnalyticsSessionDurationBucket(
                    seconds: dates.now().timeIntervalSince(startedAt ?? dates.now())
                ),
                correctRate: AnalyticsCorrectRateBucket(correct: remembered, total: answered),
                at: dates.now()
            )
        )
    }

    /// The result screen is built from what was actually saved, not from what
    /// the screen thinks it showed, so it survives being reopened.
    private func buildSummary() async {
        guard let session = state else { return }
        let reviews = (try? await learning.reviews(inSession: session.sessionID, for: resolvedScope)) ?? []
        var counts: [StudyRating: Int] = [:]
        for review in reviews {
            guard let rating = StudyRating(rawValue: review.rating) else { continue }
            counts[rating, default: 0] += 1
        }
        // The flags return in the session's own order, each wearing what was
        // said about it.
        let ratingByCard = Dictionary(
            reviews.compactMap { review in
                StudyRating(rawValue: review.rating).map { (review.learningCardID, $0) }
            },
            uniquingKeysWith: { first, _ in first }
        )
        let answered = session.cards.compactMap { card in
            ratingByCard[card.learningCardID].map {
                StudySessionSummary.AnsweredCard(promptAssetID: card.promptAssetID, rating: $0)
            }
        }
        summary = StudySessionSummary(
            sessionID: session.sessionID,
            deckID: session.deckID,
            plannedCards: session.cards.count,
            ratings: counts,
            answered: answered
        )
    }
}

public struct StudySessionSummary: Hashable, Sendable {
    /// One answered card, in the order it was answered: enough to show the
    /// flag again and the colour of what the learner said about it.
    public struct AnsweredCard: Hashable, Sendable {
        public let promptAssetID: UUID
        public let rating: StudyRating

        public init(promptAssetID: UUID, rating: StudyRating) {
            self.promptAssetID = promptAssetID
            self.rating = rating
        }
    }

    public let sessionID: UUID
    public let deckID: UUID
    public let plannedCards: Int
    public let ratings: [StudyRating: Int]
    public let answered: [AnsweredCard]

    public init(
        sessionID: UUID,
        deckID: UUID,
        plannedCards: Int,
        ratings: [StudyRating: Int],
        answered: [AnsweredCard] = []
    ) {
        self.sessionID = sessionID
        self.deckID = deckID
        self.plannedCards = plannedCards
        self.ratings = ratings
        self.answered = answered
    }

    /// How many answers reached the store. It is counted from the reviews
    /// rather than from the plan, because a session can be left unfinished.
    public var answeredCards: Int { ratings.values.reduce(0, +) }

    /// The binary reading the finish screen speaks: good and easy answers
    /// count as remembered.
    public var rememberedCards: Int { (ratings[.good] ?? 0) + (ratings[.easy] ?? 0) }
    public var recalledCards: Int {
        ratings.filter(\.key.isRecall).values.reduce(0, +)
    }
}
