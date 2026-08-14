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
    private let dates: any DateProviding
    private let identifiers: any IdentifierProviding

    public init(
        scopes: any AccountScopeResolving,
        content: any ContentRepository,
        learning: any LearningRepository,
        dates: any DateProviding = SystemDateProvider(),
        identifiers: any IdentifierProviding = SystemIdentifierProvider()
    ) {
        self.scopes = scopes
        self.content = content
        self.learning = learning
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
    public func startOrResume(deckID: UUID, size: StudySessionSize) async {
        if scope == nil { scope = await scopes.currentScope() }
        if await resume(deckID: deckID) { return }
        await start(deckID: deckID, size: size)
    }

    /// - Returns: whether an unfinished session was picked up.
    private func resume(deckID: UUID) async -> Bool {
        guard let session = try? await learning.activeSession(for: resolvedScope),
            session.deckID == deckID,
            // A session belongs to the mode that started it. Without this
            // check an unfinished quiz was picked up as a deck of cards, and
            // its reviews were recorded as self-rated answers inside a
            // multiple-choice session — a contract violation waiting for the
            // first upload.
            session.mode == StudyAnswerMode.selfRated.rawValue,
            !session.cards.isEmpty
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

    private func start(deckID: UUID, size: StudySessionSize) async {
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
        guard !selected.isEmpty else {
            startFailure = .noUsableCards
            return
        }

        let sessionID = identifiers.next()
        let snapshot = selected.map { selection in
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
            clientSequence: Int64(session.committed.count + 1),
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
        if let stored = try? await learning.activeSession(for: resolvedScope), stored.id == session.sessionID {
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
        await buildSummary()
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
        summary = StudySessionSummary(
            sessionID: session.sessionID,
            deckID: session.deckID,
            plannedCards: session.cards.count,
            ratings: counts
        )
    }
}

public struct StudySessionSummary: Hashable, Sendable {
    public let sessionID: UUID
    public let deckID: UUID
    public let plannedCards: Int
    public let ratings: [StudyRating: Int]

    public init(sessionID: UUID, deckID: UUID, plannedCards: Int, ratings: [StudyRating: Int]) {
        self.sessionID = sessionID
        self.deckID = deckID
        self.plannedCards = plannedCards
        self.ratings = ratings
    }

    /// How many answers reached the store. It is counted from the reviews
    /// rather than from the plan, because a session can be left unfinished.
    public var answeredCards: Int { ratings.values.reduce(0, +) }
    public var recalledCards: Int {
        ratings.filter(\.key.isRecall).values.reduce(0, +)
    }
}
