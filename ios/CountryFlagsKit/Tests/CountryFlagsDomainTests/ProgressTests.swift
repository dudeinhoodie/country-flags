import XCTest

@testable import CountryFlagsDomain

/// The tiers are the server's product decision and this client only displays
/// them, so the rule under test is that an unfamiliar one survives.
final class MasteryTierTests: XCTestCase {
    func testTheKnownLadderRoundTrips() {
        for tier in MasteryTier.ladder {
            XCTAssertEqual(MasteryTier(rawValue: tier.rawValue), tier)
            XCTAssertTrue(tier.isKnown)
            XCTAssertTrue(tier.isEarned)
        }
    }

    /// A release that adds a tier must not blank the screen of a build that
    /// predates it, which is why this is a value rather than a decoding error.
    func testAnUnknownTierIsCarriedRatherThanRejected() {
        let tier = MasteryTier(rawValue: "DIAMOND")

        XCTAssertEqual(tier, .unknown("DIAMOND"))
        XCTAssertFalse(tier.isKnown)
        // It is shown: the server only reports a tier the learner reached, and
        // hiding it would take an achievement away for being too new.
        XCTAssertTrue(tier.isEarned)
        XCTAssertEqual(tier.rawValue, "DIAMOND")
        XCTAssertFalse(MasteryTier.ladder.contains(tier))
    }

    func testNoTierIsNotAnAchievement() {
        XCTAssertFalse(MasteryTier(rawValue: "NONE").isEarned)
        XCTAssertTrue(MasteryTier(rawValue: "NONE").isKnown)
    }

    func testTheTierNameIsReadCaseInsensitively() {
        XCTAssertEqual(MasteryTier(rawValue: "gold"), .gold)
    }
}

final class LocalProgressProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let deck = UUID()

    /// A guest is never synchronised, so the counts a learner sees have to come
    /// from what the device itself recorded.
    func testStartedAndDueCardsAreCountedFromTheDeviceRecords() {
        let cards = [UUID(), UUID(), UUID(), UUID()]
        let states = [
            state(cards[0], state: "REVIEW", dueAt: now.addingTimeInterval(-60)),
            state(cards[1], state: "LEARNING", dueAt: now.addingTimeInterval(3600)),
            state(cards[2], state: "NEW", dueAt: now.addingTimeInterval(-3600)),
        ]

        let progress = LocalProgressProjection.progress(
            cardsByDeck: [deck: cards],
            states: states,
            now: now
        )

        XCTAssertEqual(progress.count, 1)
        XCTAssertEqual(progress[0].totalCards, 4)
        // The fourth card has no state at all and the third was never answered.
        XCTAssertEqual(progress[0].startedCards, 2)
        // Only the graduate: LEARNING is touched, not learned.
        XCTAssertEqual(progress[0].learnedCards, 1)
        // Only the one whose schedule has come round.
        XCTAssertEqual(progress[0].dueCards, 1)
    }

    /// A card that has come round is owed, whatever step it is on.
    ///
    /// This used to be the opposite: a learning card was hidden for an hour
    /// after it came due, because the scheduler brought it back a minute after
    /// "again" and the day's queue refilled inside the sitting the learner was
    /// already in. The steps are an hour, three hours and a day now, so the
    /// churn is gone at its source — and hiding a card that has genuinely come
    /// round would now be hiding work.
    func testACardWhoseTimeHasComeIsOwedWhateverStepItIsOn() {
        let cards = [UUID(), UUID()]
        let states = [
            state(cards[0], state: "LEARNING", dueAt: now.addingTimeInterval(-60)),
            state(cards[1], state: "RELEARNING", dueAt: now.addingTimeInterval(-300)),
        ]

        let progress = LocalProgressProjection.progress(
            cardsByDeck: [deck: cards],
            states: states,
            now: now
        )

        XCTAssertEqual(progress[0].dueCards, 2)
        XCTAssertEqual(progress[0].startedCards, 2)
    }

    /// A card that has not come round yet is nobody's work, whatever step it
    /// is on — which is what keeps a finished sitting finished.
    func testACardStillWaitingForItsStepIsNotOwed() {
        let cards = [UUID(), UUID()]
        let states = [
            state(cards[0], state: "LEARNING", dueAt: now.addingTimeInterval(60 * 60)),
            state(cards[1], state: "RELEARNING", dueAt: now.addingTimeInterval(30 * 60)),
        ]

        let progress = LocalProgressProjection.progress(
            cardsByDeck: [deck: cards],
            states: states,
            now: now
        )

        XCTAssertEqual(progress[0].dueCards, 0)
        XCTAssertEqual(progress[0].startedCards, 2)
    }

    /// A card left behind by a session somebody walked away from is genuinely
    /// owed, and hiding it forever would be worse than the churn.
    func testALearningCardAbandonedLongAgoIsOwedAgain() {
        let card = UUID()
        let states = [
            state(card, state: "LEARNING", dueAt: now.addingTimeInterval(-2 * 3600))
        ]

        let progress = LocalProgressProjection.progress(
            cardsByDeck: [deck: [card]],
            states: states,
            now: now
        )

        XCTAssertEqual(progress[0].dueCards, 1)
    }

    /// A repetition is due the moment it comes round: its interval is measured
    /// in days, so there is nothing to settle.
    func testARepetitionIsDueAsSoonAsItComesRound() {
        let card = UUID()
        let states = [state(card, state: "REVIEW", dueAt: now.addingTimeInterval(-1))]

        let progress = LocalProgressProjection.progress(
            cardsByDeck: [deck: [card]],
            states: states,
            now: now
        )

        XCTAssertEqual(progress[0].dueCards, 1)
    }

    func testADeckNobodyHasStartedReportsItself() {
        let progress = LocalProgressProjection.progress(
            cardsByDeck: [deck: [UUID(), UUID()]],
            states: [],
            now: now
        )

        XCTAssertEqual(progress[0].totalCards, 2)
        XCTAssertEqual(progress[0].startedCards, 0)
        XCTAssertTrue(progress[0].isUntouched)
    }

    /// A card the learner answered in another deck still counts here: the state
    /// belongs to the card, and decks overlap by design.
    func testACardSharedByTwoDecksCountsInBoth() {
        let shared = UUID()
        let other = UUID()
        let states = [state(shared, state: "REVIEW", dueAt: now)]

        let progress = LocalProgressProjection.progress(
            cardsByDeck: [deck: [shared, other], UUID(): [shared]],
            states: states,
            now: now
        )

        XCTAssertEqual(progress.count, 2)
        XCTAssertEqual(progress.map(\.startedCards).reduce(0, +), 2)
    }

    private func state(_ card: UUID, state: String, dueAt: Date) -> CardStateRecord {
        CardStateRecord(
            learningCardID: card,
            state: state,
            difficulty: 5,
            stability: 1,
            dueAt: dueAt,
            repetitions: 1,
            lapses: 0,
            schedulerVersion: "test",
            stateVersion: 1,
            updatedAt: dueAt,
            isLocalProjection: true
        )
    }
}
