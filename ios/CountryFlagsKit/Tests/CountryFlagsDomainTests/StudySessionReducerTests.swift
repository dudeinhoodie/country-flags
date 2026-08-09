import XCTest

@testable import CountryFlagsDomain

/// The session rules, stated without a view, a clock or a store.
final class StudySessionReducerTests: XCTestCase {
    private let reviewID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!

    func testRevealingTheAnswerMovesToTheBack() {
        var state = Self.state(cardCount: 2)

        let effect = StudySessionReducer.reduce(&state, .revealAnswer)

        XCTAssertNil(effect)
        XCTAssertEqual(state.phase, .back(index: 0))
        XCTAssertTrue(state.isAnswerRevealed)
    }

    /// The front must not give the answer away, which is what the flip is for.
    func testTheAnswerIsNotRevealedOnTheFront() {
        let state = Self.state(cardCount: 2)

        XCTAssertFalse(state.isAnswerRevealed)
        XCTAssertEqual(state.position, 1)
    }

    /// A rating cannot be given before the answer was seen, so a stray tap on
    /// the prompt cannot record a review.
    func testRatingIsIgnoredWhileTheAnswerIsHidden() {
        var state = Self.state(cardCount: 2)

        let effect = StudySessionReducer.reduce(&state, .rate(.good, reviewID: reviewID))

        XCTAssertNil(effect)
        XCTAssertEqual(state.phase, .front(index: 0))
        XCTAssertTrue(state.committed.isEmpty)
    }

    func testRatingAsksForACommitAndBlocksFurtherInput() {
        var state = Self.state(cardCount: 2)
        StudySessionReducer.reduce(&state, .revealAnswer)

        let effect = StudySessionReducer.reduce(&state, .rate(.good, reviewID: reviewID))

        XCTAssertEqual(effect, .commit(reviewID: reviewID, card: state.cards[0], rating: .good))
        XCTAssertTrue(state.isCommitting)
    }

    /// The acceptance criterion for a double tap: the second gesture arrives
    /// while the first is being written, and it is dropped rather than queued.
    func testASecondRatingDuringACommitIsDropped() {
        var state = Self.state(cardCount: 2)
        StudySessionReducer.reduce(&state, .revealAnswer)
        StudySessionReducer.reduce(&state, .rate(.good, reviewID: reviewID))

        let second = StudySessionReducer.reduce(&state, .rate(.easy, reviewID: UUID()))

        XCTAssertNil(second)
        XCTAssertEqual(state.phase, .committing(index: 0, rating: .good, reviewID: reviewID))

        // And the one commit that did happen advances exactly one card.
        StudySessionReducer.reduce(&state, .commitSucceeded)
        XCTAssertEqual(state.phase, .front(index: 1))
        XCTAssertEqual(state.committed.count, 1)
    }

    func testACommittedRatingAdvancesToTheNextCard() {
        var state = Self.state(cardCount: 2)
        StudySessionReducer.reduce(&state, .revealAnswer)
        StudySessionReducer.reduce(&state, .rate(.hard, reviewID: reviewID))

        let effect = StudySessionReducer.reduce(&state, .commitSucceeded)

        XCTAssertNil(effect)
        XCTAssertEqual(state.phase, .front(index: 1))
        XCTAssertEqual(state.committed[state.cards[0].id], .hard)
        XCTAssertEqual(state.position, 2)
    }

    func testTheLastCardFinishesTheSession() {
        var state = Self.state(cardCount: 1)
        StudySessionReducer.reduce(&state, .revealAnswer)
        StudySessionReducer.reduce(&state, .rate(.easy, reviewID: reviewID))

        let effect = StudySessionReducer.reduce(&state, .commitSucceeded)

        XCTAssertEqual(effect, .complete)
        XCTAssertEqual(state.phase, .finished)
        XCTAssertNil(state.currentCard)
    }

    /// A rolled-back write leaves no review and shows the same card again, with
    /// the answer still revealed: the learner has already seen it, so asking
    /// them to answer it fresh would be a lie about what happened.
    func testAFailedCommitRecordsNothingAndKeepsTheCard() {
        var state = Self.state(cardCount: 2)
        StudySessionReducer.reduce(&state, .revealAnswer)
        StudySessionReducer.reduce(&state, .rate(.good, reviewID: reviewID))

        let effect = StudySessionReducer.reduce(&state, .commitFailed)

        XCTAssertNil(effect)
        XCTAssertEqual(state.phase, .back(index: 0))
        XCTAssertTrue(state.committed.isEmpty)
        XCTAssertFalse(state.isCommitting)
    }

    /// After a failure the learner can rate again, and that attempt is a new
    /// review rather than a retry of an identifier that may have landed.
    func testRatingAgainAfterAFailureIsAcceptedWithItsOwnIdentifier() {
        var state = Self.state(cardCount: 2)
        StudySessionReducer.reduce(&state, .revealAnswer)
        StudySessionReducer.reduce(&state, .rate(.good, reviewID: reviewID))
        StudySessionReducer.reduce(&state, .commitFailed)

        let retryID = UUID()
        let effect = StudySessionReducer.reduce(&state, .rate(.again, reviewID: retryID))

        XCTAssertEqual(effect, .commit(reviewID: retryID, card: state.cards[0], rating: .again))
    }

    func testEventsArrivingAfterTheSessionEndedAreIgnored() {
        var state = Self.state(cardCount: 1)
        StudySessionReducer.reduce(&state, .revealAnswer)
        StudySessionReducer.reduce(&state, .rate(.good, reviewID: reviewID))
        StudySessionReducer.reduce(&state, .commitSucceeded)

        XCTAssertNil(StudySessionReducer.reduce(&state, .revealAnswer))
        XCTAssertNil(StudySessionReducer.reduce(&state, .rate(.easy, reviewID: UUID())))
        XCTAssertEqual(state.phase, .finished)
    }

    /// Resuming puts the learner on the card after the last one that committed,
    /// which is the state a relaunch has to reconstruct.
    func testASessionCanBeResumedAtAGivenCard() {
        let state = Self.state(cardCount: 3, phase: .front(index: 2))

        XCTAssertEqual(state.position, 3)
        XCTAssertEqual(state.currentCard, state.cards[2])
        XCTAssertFalse(state.isAnswerRevealed)
    }

    // MARK: - Fixtures

    static func state(
        cardCount: Int,
        phase: StudySessionPhase = .front(index: 0)
    ) -> StudySessionState {
        StudySessionState(
            sessionID: UUID(uuidString: "20000000-0000-4000-8000-000000000001")!,
            deckID: UUID(uuidString: "30000000-0000-4000-8000-000000000001")!,
            cards: (0..<cardCount).map { index in
                StudySessionCardRecord(
                    id: UUID(uuidString: "40000000-0000-4000-8000-00000000000\(index)")!,
                    learningCardID: UUID(uuidString: "50000000-0000-4000-8000-00000000000\(index)")!,
                    initialOrder: index,
                    selectionReason: "NEW",
                    displayName: "Country \(index)",
                    promptAssetID: UUID(uuidString: "60000000-0000-4000-8000-00000000000\(index)")!,
                    revision: 1,
                    optionIDs: [],
                    optionNames: []
                )
            },
            phase: phase
        )
    }
}
