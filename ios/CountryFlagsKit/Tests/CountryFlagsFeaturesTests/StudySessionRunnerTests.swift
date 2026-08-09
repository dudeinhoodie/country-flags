import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

/// The durable half of the session: what reaches the store, when, and what a
/// relaunch reconstructs from it.
@MainActor
final class StudySessionRunnerTests: XCTestCase {
    private let deckID = UUID(uuidString: "70000000-0000-4000-8000-000000000001")!
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testStartingASessionPersistsItsCompositionAndShowsTheFirstCard() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 3, learning: learning)

        await runner.startOrResume(deckID: deckID, size: .five)

        let sessions = await learning.recordedSessions()
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions.first?.status, StudySessionStatus.active.rawValue)
        XCTAssertEqual(sessions.first?.requestedUniqueCount, 5)
        // The composition is fixed at the start, so it is stored with the
        // session rather than recomputed later.
        XCTAssertEqual(sessions.first?.cards.count, 3)
        XCTAssertEqual(runner.state?.position, 1)
        XCTAssertFalse(runner.state?.isAnswerRevealed ?? true)
    }

    /// A deck with nothing this build can study says so rather than starting an
    /// empty session.
    func testADeckWithNoUsableCardsRefusesToStart() async {
        let runner = makeRunner(cards: 0, learning: RecordingLearningRepository())

        await runner.startOrResume(deckID: deckID, size: .five)

        XCTAssertEqual(runner.startFailure, .noUsableCards)
        XCTAssertNil(runner.state)
    }

    /// Every rating is durable before the next card appears, together with its
    /// projected state and its outbox entry.
    func testARatingIsRecordedWithItsProjectionAndOutboxEntry() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 2, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)

        runner.revealAnswer()
        await runner.rate(.good)

        let reviews = await learning.recordedReviews()
        let projections = await learning.recordedProjections()
        let outbox = await learning.recordedOutbox()
        XCTAssertEqual(reviews.count, 1)
        XCTAssertEqual(reviews.first?.rating, "GOOD")
        XCTAssertEqual(reviews.first?.answerMode, "SELF_RATED")
        XCTAssertEqual(projections.count, 1)
        // Anything this device computed is labelled as a guess, because the
        // backend owns the real schedule.
        XCTAssertTrue(projections.first?.isLocalProjection ?? false)
        XCTAssertEqual(outbox.count, 1)
        XCTAssertEqual(outbox.first?.state, .pending)
        // The session has to reach the backend before the reviews that name it.
        XCTAssertEqual(outbox.first?.dependencyID, runner.state?.sessionID)
        XCTAssertEqual(runner.state?.position, 2)
    }

    /// A rolled-back write records nothing and leaves the learner on the same
    /// card, told that it was not saved.
    func testAFailedWriteRecordsNothingAndKeepsTheCard() async {
        let learning = RecordingLearningRepository(failReviews: true)
        let runner = makeRunner(cards: 2, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)

        runner.revealAnswer()
        await runner.rate(.good)

        let reviews = await learning.recordedReviews()
        XCTAssertTrue(reviews.isEmpty)
        XCTAssertTrue(runner.lastCommitFailed)
        XCTAssertEqual(runner.state?.position, 1)
        XCTAssertTrue(runner.state?.isAnswerRevealed ?? false)
    }

    /// The acceptance criterion for a double tap: two ratings that overlap
    /// produce one review.
    func testTwoOverlappingRatingsProduceOneReview() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 2, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)
        runner.revealAnswer()

        // The first write is held open, so the second tap lands while it is in
        // flight — which is exactly when a real double tap arrives.
        await learning.armGate()
        async let first: Void = runner.rate(.good)
        await Task.yield()
        async let second: Void = runner.rate(.easy)
        await Task.yield()
        await learning.openGate()
        _ = await (first, second)

        let reviews = await learning.recordedReviews()
        XCTAssertEqual(reviews.count, 1)
        XCTAssertEqual(reviews.first?.rating, "GOOD")
    }

    // MARK: - Relaunch

    /// A kill after a commit resumes on the next card: the review is in the
    /// store, so the card it answered is done.
    func testARelaunchAfterACommitResumesOnTheNextCard() async {
        let learning = RecordingLearningRepository()
        let first = makeRunner(cards: 3, learning: learning)
        await first.startOrResume(deckID: deckID, size: .five)
        first.revealAnswer()
        await first.rate(.good)

        let relaunched = makeRunner(cards: 3, learning: learning)
        await relaunched.startOrResume(deckID: deckID, size: .five)

        XCTAssertEqual(relaunched.state?.position, 2)
        XCTAssertEqual(relaunched.state?.sessionID, first.state?.sessionID)
        let sessions = await learning.recordedSessions()
        // The resumed run continues the stored session rather than starting a
        // second one.
        XCTAssertEqual(sessions.count, 1)
    }

    /// A kill before the commit reshows the same card and records nothing: the
    /// answer never reached the store, so it never happened.
    func testARelaunchBeforeACommitReshowsTheSameCard() async {
        let learning = RecordingLearningRepository(failReviews: true)
        let first = makeRunner(cards: 3, learning: learning)
        await first.startOrResume(deckID: deckID, size: .five)
        first.revealAnswer()
        await first.rate(.good)

        let relaunched = makeRunner(cards: 3, learning: learning)
        await relaunched.startOrResume(deckID: deckID, size: .five)

        XCTAssertEqual(relaunched.state?.position, 1)
        // The prompt is shown again rather than the answer the learner saw
        // before the crash.
        XCTAssertFalse(relaunched.state?.isAnswerRevealed ?? true)
        let reviews = await learning.recordedReviews()
        XCTAssertTrue(reviews.isEmpty)
    }

    // MARK: - Result

    /// The result is built from what was saved, so it survives being reopened
    /// and cannot report an answer the store never took.
    func testTheResultCountsTheReviewsThatWereActuallyStored() async {
        let learning = RecordingLearningRepository()
        let runner = makeRunner(cards: 2, learning: learning)
        await runner.startOrResume(deckID: deckID, size: .five)

        runner.revealAnswer()
        await runner.rate(.good)
        runner.revealAnswer()
        await runner.rate(.again)

        let summary = try? XCTUnwrap(runner.summary)
        XCTAssertEqual(summary?.answeredCards, 2)
        XCTAssertEqual(summary?.plannedCards, 2)
        XCTAssertEqual(summary?.ratings[.good], 1)
        XCTAssertEqual(summary?.ratings[.again], 1)
        XCTAssertEqual(summary?.recalledCards, 1)

        let sessions = await learning.recordedSessions()
        XCTAssertEqual(sessions.first?.status, StudySessionStatus.completed.rawValue)
        XCTAssertNotNil(sessions.first?.completedAt)
    }

    /// A finished session is not resumed: opening the deck again starts a new
    /// one, and the completed record stays exactly as it was.
    func testAFinishedSessionIsNotResumed() async {
        let learning = RecordingLearningRepository()
        let identifiers = SequentialUUIDProvider()
        let runner = makeRunner(cards: 1, learning: learning, identifiers: identifiers)
        await runner.startOrResume(deckID: deckID, size: .five)
        runner.revealAnswer()
        await runner.rate(.easy)

        let reopened = makeRunner(cards: 1, learning: learning, identifiers: identifiers)
        await reopened.startOrResume(deckID: deckID, size: .five)

        // The finished session is kept as it was, and opening the deck again
        // begins a new one rather than resuming or overwriting it.
        let sessions = await learning.recordedSessions()
        XCTAssertEqual(sessions.filter { $0.status == StudySessionStatus.completed.rawValue }.count, 1)
        XCTAssertEqual(sessions.filter { $0.status == StudySessionStatus.active.rawValue }.count, 1)
        XCTAssertNotEqual(reopened.state?.sessionID, runner.state?.sessionID)
        XCTAssertEqual(reopened.state?.position, 1)
    }

    // MARK: - Helpers

    /// - Parameter identifiers: shared between two runners when a test models a
    ///   relaunch. A real relaunch does not restart the identifier space, and a
    ///   double that did would let a new session collide with the stored one.
    private func makeRunner(
        cards: Int,
        learning: RecordingLearningRepository,
        identifiers: any IdentifierProviding = SequentialUUIDProvider()
    ) -> StudySessionRunner {
        StudySessionRunner(
            scopes: FixedScopeResolver(),
            content: FakeContentRepository(
                decks: [Self.deck(id: deckID)],
                cards: [deckID: (0..<cards).map { Self.card(index: $0) }]
            ),
            learning: learning,
            dates: FixedDates(instant: now),
            identifiers: identifiers
        )
    }

    private static func deck(id: UUID) -> DeckRecord {
        DeckRecord(
            id: id,
            code: "DECK",
            kind: "CURATED",
            name: "Deck",
            deckDescription: "",
            cardCount: 0,
            contentVersion: "v1",
            sortOrder: 0
        )
    }

    private static func card(index: Int) -> LearningCardRecord {
        LearningCardRecord(
            id: UUID(uuidString: String(format: "50000000-0000-4000-8000-%012d", index))!,
            subjectEntityID: UUID(),
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: UUID(),
            displayName: "Country \(index)",
            aliases: [],
            contentVersion: "v1"
        )
    }
}
