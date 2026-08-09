import Foundation

/// One answer option as the contract defines it.
///
/// There is deliberately no "is correct" field. The contract omits it so a
/// client cannot leak the answer by rendering a payload, and this type keeps
/// that property rather than adding a convenience the screen would eventually
/// read.
public struct StudyOptionRecord: Hashable, Sendable, Identifiable {
    public let id: UUID
    /// 0...3, the order the session fixed. It travels with the option so a
    /// re-render cannot reshuffle the answers under the learner.
    public let position: Int
    public let displayName: String

    public init(id: UUID, position: Int, displayName: String) {
        self.id = id
        self.position = position
        self.displayName = displayName
    }
}

/// A question in an objective session.
///
/// `correctOptionID` is `internal`: an offline session generated its own
/// options and therefore knows the answer, but nothing outside this module can
/// read it, and the presentation type below is what a view is given.
public struct ObjectiveQuestion: Hashable, Sendable {
    public let sessionCardID: UUID
    public let learningCardID: UUID
    public let promptAssetID: UUID
    public let displayName: String
    /// Exactly four, ordered by position.
    public let options: [StudyOptionRecord]
    /// Known only for a session this device composed. A server-selected session
    /// is graded by the backend and carries nothing here.
    let correctOptionID: UUID?

    public init(
        sessionCardID: UUID,
        learningCardID: UUID,
        promptAssetID: UUID,
        displayName: String,
        options: [StudyOptionRecord],
        correctOptionID: UUID?
    ) {
        self.sessionCardID = sessionCardID
        self.learningCardID = learningCardID
        self.promptAssetID = promptAssetID
        self.displayName = displayName
        self.options = options
        self.correctOptionID = correctOptionID
    }
}

/// What a view is allowed to know about a question.
///
/// Before an answer it carries the options and nothing else: there is no field
/// a view could read, or a snapshot test could dump, that names the correct
/// option. After an answer the outcome is filled in, which is the only moment
/// the correct option becomes part of the presentation at all.
public struct ObjectiveQuestionPresentation: Hashable, Sendable {
    public let options: [StudyOptionRecord]
    public let selectedOptionID: UUID?
    /// Non-nil only once the answer has been given and graded.
    public let correctOptionID: UUID?

    public var isAnswered: Bool { selectedOptionID != nil }

    public func outcome(for option: StudyOptionRecord) -> OptionOutcome {
        guard isAnswered, let correctOptionID else { return .undecided }
        if option.id == correctOptionID { return .correct }
        return option.id == selectedOptionID ? .incorrect : .undecided
    }

    public init(options: [StudyOptionRecord], selectedOptionID: UUID?, correctOptionID: UUID?) {
        self.options = options
        self.selectedOptionID = selectedOptionID
        self.correctOptionID = correctOptionID
    }
}

/// How an option is drawn after the answer.
///
/// Colour alone never carries this: the screen pairs it with an icon and a
/// label, because a learner who cannot distinguish the two colours still has to
/// know what happened.
public enum OptionOutcome: String, Hashable, Sendable {
    case undecided
    case correct
    case incorrect
}
