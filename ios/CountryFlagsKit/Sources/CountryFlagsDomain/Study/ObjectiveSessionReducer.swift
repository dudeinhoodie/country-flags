import Foundation

/// What an objective question is showing.
public enum ObjectivePhase: Hashable, Sendable {
    /// The four options are up and none is chosen.
    case asking(index: Int)
    /// A choice is being written. No further input is accepted, which is what
    /// makes a double tap one review.
    case committing(index: Int, optionID: UUID, reviewID: UUID)
    /// The choice is fixed and the outcome is shown. It cannot be changed.
    case answered(index: Int, optionID: UUID)
    case finished
}

public struct ObjectiveSessionState: Hashable, Sendable {
    public let sessionID: UUID
    public let deckID: UUID
    public let questions: [ObjectiveQuestion]
    public internal(set) var phase: ObjectivePhase
    /// Which option was committed for each question, keyed by session card.
    public internal(set) var answers: [UUID: UUID]

    public init(
        sessionID: UUID,
        deckID: UUID,
        questions: [ObjectiveQuestion],
        phase: ObjectivePhase,
        answers: [UUID: UUID] = [:]
    ) {
        self.sessionID = sessionID
        self.deckID = deckID
        self.questions = questions
        self.phase = phase
        self.answers = answers
    }

    public var currentIndex: Int? {
        switch phase {
        case .asking(let index): index
        case .committing(let index, _, _): index
        case .answered(let index, _): index
        case .finished: nil
        }
    }

    public var currentQuestion: ObjectiveQuestion? {
        currentIndex.flatMap { $0 < questions.count ? questions[$0] : nil }
    }

    public var position: Int { (currentIndex ?? questions.count) + 1 }

    public var isCommitting: Bool {
        if case .committing = phase { return true }
        return false
    }

    /// What the screen is allowed to draw.
    ///
    /// Before an answer this carries no correct option at all, so the secrecy
    /// invariant is a property of the type the view receives rather than a rule
    /// the view is asked to follow.
    public var presentation: ObjectiveQuestionPresentation? {
        guard let question = currentQuestion else { return nil }
        switch phase {
        case .asking, .committing:
            return ObjectiveQuestionPresentation(
                options: question.options,
                selectedOptionID: nil,
                correctOptionID: nil
            )
        case .answered(_, let optionID):
            return ObjectiveQuestionPresentation(
                options: question.options,
                selectedOptionID: optionID,
                correctOptionID: question.correctOptionID
            )
        case .finished:
            return nil
        }
    }
}

public enum ObjectiveSessionEvent: Hashable, Sendable {
    /// - Parameter reviewID: created before the transition, so the identity of
    ///   the review is fixed before anything can retry it.
    case choose(optionID: UUID, reviewID: UUID)
    case commitSucceeded
    case commitFailed
    /// The learner moves on after seeing the outcome.
    case advance
}

public enum ObjectiveSessionEffect: Hashable, Sendable {
    case commit(reviewID: UUID, question: ObjectiveQuestion, optionID: UUID)
    case complete
}

/// The rules of an objective session.
public enum ObjectiveSessionReducer {
    @discardableResult
    public static func reduce(
        _ state: inout ObjectiveSessionState,
        _ event: ObjectiveSessionEvent
    ) -> ObjectiveSessionEffect? {
        switch (state.phase, event) {
        case (.asking(let index), .choose(let optionID, let reviewID)):
            guard index < state.questions.count,
                state.questions[index].options.contains(where: { $0.id == optionID })
            else {
                // An option that is not on this question cannot be chosen, so a
                // stale tap from a previous card cannot answer this one.
                return nil
            }
            state.phase = .committing(index: index, optionID: optionID, reviewID: reviewID)
            return .commit(
                reviewID: reviewID,
                question: state.questions[index],
                optionID: optionID
            )

        case (.committing(let index, let optionID, _), .commitSucceeded):
            state.answers[state.questions[index].sessionCardID] = optionID
            state.phase = .answered(index: index, optionID: optionID)
            return nil

        case (.committing(let index, _, _), .commitFailed):
            // Nothing was written, so the question is askable again.
            state.phase = .asking(index: index)
            return nil

        case (.answered(let index, _), .advance):
            let next = index + 1
            if next < state.questions.count {
                state.phase = .asking(index: next)
                return nil
            }
            state.phase = .finished
            return .complete

        // Everything else is input a state cannot use: a second tap during a
        // write, a tap on an answered question, or anything after the end. The
        // answer is immutable once given.
        default:
            return nil
        }
    }
}
