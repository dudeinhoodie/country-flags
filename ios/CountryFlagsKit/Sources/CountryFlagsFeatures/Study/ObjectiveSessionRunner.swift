import Foundation
import Observation

import CountryFlagsDomain

public enum ObjectiveStartFailure: Hashable, Sendable {
    /// The deck cannot offer four distinctly named answers for some card. The
    /// contract calls this `DISTRACTOR_POOL_INSUFFICIENT`; the client reaches
    /// the same conclusion locally rather than showing a broken question.
    case distractorPoolInsufficient
    case noUsableCards
    case storeUnavailable

    /// Whether trying the same deck again could help. A pool that is too small
    /// stays too small until the content release changes, so the screen offers
    /// the other mode instead of a retry that cannot work.
    public var isRetryable: Bool { self == .storeUnavailable }
}

/// Drives one multiple-choice session.
///
/// The questions are composed on the device from the deck it already has, which
/// is what lets the mode work with no network — and is also why the client
/// knows the answer and can show the outcome immediately. A server-selected
/// session is graded by the backend and arrives with the sync work package;
/// until then this composes locally and keeps its reviews local.
@MainActor
@Observable
public final class ObjectiveSessionRunner {
    public private(set) var state: ObjectiveSessionState?
    public private(set) var startFailure: ObjectiveStartFailure?
    public private(set) var lastCommitFailed = false
    public private(set) var summary: ObjectiveSessionSummary?

    private let scopes: any AccountScopeResolving
    private var scope: AccountScope?
    private let content: any ContentRepository
    private let learning: any LearningRepository
    private let dates: any DateProviding
    private let identifiers: any IdentifierProviding

    public init(
        scopes: any AccountScopeResolving,
        content: any ContentRepository,
        learning: any LearningRepository,
        analytics: (any AnalyticsTracking)? = nil,
        dates: any DateProviding = SystemDateProvider(),
        identifiers: any IdentifierProviding = SystemIdentifierProvider()
    ) {
        self.scopes = scopes
        self.content = content
        self.learning = learning
        self.analytics = analytics
        self.dates = dates
        self.identifiers = identifiers
    }

    private let analytics: (any AnalyticsTracking)?
    /// When the sitting started, for the duration bucket the completed event
    /// carries.
    private var startedAt: Date?

    private var resolvedScope: AccountScope {
        guard let scope else {
            preconditionFailure("The session scope is resolved before any store access")
        }
        return scope
    }

    // MARK: - Starting and resuming

    public func startOrResume(deckID: UUID, size: StudySessionSize) async {
        if scope == nil { scope = await scopes.currentScope() }
        startedAt = dates.now()
        if await resume(deckID: deckID) {
            await reportSessionStarted(requestedCardCount: state?.questions.count ?? 0)
            return
        }
        await start(deckID: deckID, size: size)
        await reportSessionStarted(requestedCardCount: size.rawValue)
    }

    /// The session's shape and nothing else: the mode and how many questions
    /// were asked for.
    private func reportSessionStarted(requestedCardCount: Int) async {
        guard let analytics, state != nil else { return }
        await analytics.track(
            .studySessionStarted(
                mode: .multipleChoice,
                requestedCardCount: requestedCardCount,
                at: dates.now()
            )
        )
    }

    /// Reported when the learner leaves with questions still owed.
    public func reportAbandonment() async {
        guard let analytics, let session = state, summary == nil else { return }
        await analytics.track(
            .studySessionAbandoned(
                mode: .multipleChoice,
                progress: AnalyticsProgressBucket(
                    answered: session.answers.count,
                    planned: session.questions.count
                ),
                at: dates.now()
            )
        )
    }

    private func resume(deckID: UUID) async -> Bool {
        guard let session = try? await learning.activeSession(for: resolvedScope),
            session.deckID == deckID,
            session.mode == StudyAnswerMode.multipleChoice.rawValue,
            !session.cards.isEmpty
        else {
            return false
        }

        let pool = (try? await content.cards(inDeck: deckID)) ?? []
        let questions = session.cards.compactMap { Self.question(from: $0, pool: pool) }
        guard questions.count == session.cards.count else {
            // A snapshot this build can no longer rebuild is not something to
            // guess at; the session is abandoned and a new one is started.
            return false
        }

        let reviews = (try? await learning.reviews(inSession: session.id, for: resolvedScope)) ?? []
        var answers: [UUID: UUID] = [:]
        for question in questions {
            if let review = reviews.first(where: { $0.learningCardID == question.learningCardID }),
                let optionID = review.selectedOptionID
            {
                answers[question.sessionCardID] = optionID
            }
        }

        let nextIndex = questions.firstIndex { answers[$0.sessionCardID] == nil }
        state = ObjectiveSessionState(
            sessionID: session.id,
            deckID: session.deckID,
            questions: questions,
            // A relaunch lands on the question rather than on the outcome of
            // the previous one: the answer is already recorded, and re-showing
            // its feedback would invite a second reading of a fixed result.
            phase: nextIndex.map { .asking(index: $0) } ?? .finished,
            answers: answers
        )
        if nextIndex == nil { await buildSummary() }
        return true
    }

    private func start(deckID: UUID, size: StudySessionSize) async {
        let manifest = try? await content.currentManifest()
        let pool = (try? await content.cards(inDeck: deckID)) ?? []
        let states = (try? await learning.cardStates(for: resolvedScope)) ?? []

        let selected = LocalCardSelection.select(
            from: pool,
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
        var questions: [ObjectiveQuestion] = []
        var snapshot: [StudySessionCardRecord] = []

        for selection in selected {
            let sessionCardID = identifiers.next()
            // The seed is part of the stored snapshot, so the same four options
            // in the same order are rebuilt after a relaunch.
            let seed = "\(sessionID.uuidString)|\(selection.card.id.uuidString)"
            let options: [StudyOptionRecord]
            do {
                options = try LocalDistractorSelection.options(
                    for: selection.card,
                    from: pool,
                    seed: seed
                )
            } catch {
                startFailure = .distractorPoolInsufficient
                return
            }

            questions.append(
                ObjectiveQuestion(
                    sessionCardID: sessionCardID,
                    learningCardID: selection.card.id,
                    promptAssetID: selection.card.promptAssetID,
                    displayName: selection.card.displayName,
                    options: options,
                    correctOptionID: LocalDistractorSelection.correctOptionID(
                        in: options,
                        answer: selection.card.displayName
                    )
                )
            )
            snapshot.append(
                StudySessionCardRecord(
                    id: sessionCardID,
                    learningCardID: selection.card.id,
                    initialOrder: selection.order,
                    selectionReason: selection.reason.rawValue,
                    displayName: selection.card.displayName,
                    promptAssetID: selection.card.promptAssetID,
                    revision: selection.card.revision,
                    optionIDs: options.map(\.id),
                    optionNames: options.map(\.displayName)
                )
            )
        }

        let session = StudySessionRecord(
            id: sessionID,
            deckID: deckID,
            mode: StudyAnswerMode.multipleChoice.rawValue,
            selectionOrigin: "CLIENT_OFFLINE",
            requestedUniqueCount: size.rawValue,
            status: StudySessionStatus.active.rawValue,
            contentVersion: manifest?.contentVersion ?? "",
            startedAt: dates.now(),
            completedAt: nil,
            cards: snapshot
        )

        // Same rule as the self-rated runner: what was active and is not
        // being resumed is closed, not orphaned. Read before the save, after
        // which the active session is the new one.
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
        state = ObjectiveSessionState(
            sessionID: sessionID,
            deckID: deckID,
            questions: questions,
            phase: .asking(index: 0)
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

    /// Records a choice. The identifier is created before the transition, so a
    /// second tap arriving mid-write is dropped by the reducer rather than
    /// producing a second review.
    public func choose(optionID: UUID) async {
        guard var current = state else { return }
        let reviewID = identifiers.next()
        guard let effect = ObjectiveSessionReducer.reduce(
            &current,
            .choose(optionID: optionID, reviewID: reviewID)
        ) else {
            state = current
            return
        }
        state = current
        lastCommitFailed = false

        guard case .commit(let id, let question, let chosen) = effect else { return }
        let succeeded = await commit(reviewID: id, question: question, optionID: chosen)

        guard var next = state else { return }
        ObjectiveSessionReducer.reduce(&next, succeeded ? .commitSucceeded : .commitFailed)
        state = next
        lastCommitFailed = !succeeded
    }

    /// Moves on after the outcome has been seen.
    public func advance() async {
        guard var current = state else { return }
        let effect = ObjectiveSessionReducer.reduce(&current, .advance)
        state = current
        if effect == .complete { await complete() }
    }

    private func commit(reviewID: UUID, question: ObjectiveQuestion, optionID: UUID) async -> Bool {
        guard let session = state else { return false }
        let now = dates.now()
        let states = (try? await learning.cardStates(for: resolvedScope)) ?? []
        let base = states.first { $0.learningCardID == question.learningCardID }

        // The rating is derived from the outcome, not from the learner: an
        // objective answer is right or wrong, and the scheduler needs one of
        // its own values.
        let isCorrect = question.isCorrect(optionID)
        let rating: StudyRating = isCorrect ? .good : .again

        let review = ReviewEventRecord(
            id: reviewID,
            sessionID: session.sessionID,
            learningCardID: question.learningCardID,
            rating: rating.rawValue,
            answerMode: StudyAnswerMode.multipleChoice.rawValue,
            // The opaque identifier is what the backend grades; correctness is
            // never derived from the displayed text.
            selectedOptionID: optionID,
            responseTimeMilliseconds: nil,
            clientOccurredAt: now,
            estimatedServerOccurredAt: nil,
            clientSequence: Int64(session.answers.count + 1),
            baseStateVersion: base?.stateVersion
        )
        let projected = LocalSchedulerProjection.project(
            base: base,
            cardID: question.learningCardID,
            rating: rating,
            now: now
        )

        let payload = PendingReviewPayload(
            reviewID: reviewID,
            sessionID: session.sessionID,
            learningCardID: question.learningCardID,
            rating: rating.rawValue,
            answerMode: StudyAnswerMode.multipleChoice.rawValue,
            clientOccurredAt: now,
            clientSequence: review.clientSequence,
            baseStateVersion: base?.stateVersion,
            selectedOptionID: optionID
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let encoded = try? encoder.encode(payload) else { return false }

        let outbox = OutboxOperationRecord(
            id: identifiers.next(),
            kind: .reviewBatch,
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
        if let stored = try? await learning.activeSession(for: resolvedScope),
            stored.id == session.sessionID
        {
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
        await reportSessionCompleted()
    }

    /// The completed quiz as a shape: how many questions, how long, how well —
    /// the last two as buckets, for the same reason the self-rated session
    /// reports them that way.
    private func reportSessionCompleted() async {
        guard let analytics, let summary else { return }
        await analytics.track(
            .studySessionCompleted(
                mode: .multipleChoice,
                deckType: .system,
                requestedCardCount: summary.plannedQuestions,
                uniqueCardCount: summary.answeredQuestions,
                reviewCount: summary.answeredQuestions,
                duration: AnalyticsSessionDurationBucket(
                    seconds: dates.now().timeIntervalSince(startedAt ?? dates.now())
                ),
                correctRate: AnalyticsCorrectRateBucket(
                    correct: summary.correctAnswers,
                    total: summary.answeredQuestions
                ),
                at: dates.now()
            )
        )
    }

    /// Counted from the stored reviews, so the result reports the answers that
    /// were actually committed rather than the taps the screen saw.
    private func buildSummary() async {
        guard let session = state else { return }
        let reviews = (try? await learning.reviews(inSession: session.sessionID, for: resolvedScope)) ?? []
        var correct = 0
        for review in reviews {
            guard let optionID = review.selectedOptionID,
                let question = session.questions.first(where: {
                    $0.learningCardID == review.learningCardID
                })
            else { continue }
            if question.isCorrect(optionID) { correct += 1 }
        }
        summary = ObjectiveSessionSummary(
            sessionID: session.sessionID,
            deckID: session.deckID,
            plannedQuestions: session.questions.count,
            answeredQuestions: reviews.filter { $0.selectedOptionID != nil }.count,
            correctAnswers: correct
        )
    }

    // MARK: - Snapshot

    /// Rebuilds a question from the stored snapshot rather than from the deck,
    /// so the four options a learner is looking at survive a content release
    /// that changed the pool underneath them.
    private static func question(
        from card: StudySessionCardRecord,
        pool: [LearningCardRecord]
    ) -> ObjectiveQuestion? {
        guard card.optionIDs.count == card.optionNames.count, card.optionIDs.count == 4 else {
            return nil
        }
        let options = zip(card.optionIDs, card.optionNames).enumerated().map { position, pair in
            StudyOptionRecord(id: pair.0, position: position, displayName: pair.1)
        }
        return ObjectiveQuestion(
            sessionCardID: card.id,
            learningCardID: card.learningCardID,
            promptAssetID: card.promptAssetID,
            displayName: card.displayName,
            options: options,
            correctOptionID: options.first { $0.displayName == card.displayName }?.id
        )
    }
}

public struct ObjectiveSessionSummary: Hashable, Sendable {
    public let sessionID: UUID
    public let deckID: UUID
    public let plannedQuestions: Int
    public let answeredQuestions: Int
    public let correctAnswers: Int

    public init(
        sessionID: UUID,
        deckID: UUID,
        plannedQuestions: Int,
        answeredQuestions: Int,
        correctAnswers: Int
    ) {
        self.sessionID = sessionID
        self.deckID = deckID
        self.plannedQuestions = plannedQuestions
        self.answeredQuestions = answeredQuestions
        self.correctAnswers = correctAnswers
    }
}
