import Foundation
import XCTest

@testable import CountryFlagsDomain

/// The local projection against the server's own golden sequences (#435,
/// ADR-026).
///
/// The fixtures are the ones the backend's adapter spec replays through
/// ts-fsrs, read from `contracts/`, so a change to the server's ladder breaks
/// this test too instead of leaving the device to drift. Played from a new
/// card, the device must agree with the server on the state after every
/// `GOOD` and on every date up to a day, and must never ask for a card later
/// than the server would.
final class LocalSchedulerLadderTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Review: Decodable {
            struct Expected: Decodable {
                let state: String
                let dueAt: Date
            }

            let occurredAt: Date
            let rating: String
            let expected: Expected
        }

        let reviews: [Review]
    }

    func testTwoGoodAnswersGraduateANewCardAsOnTheServer() throws {
        try assertAgrees(with: "fsrs-6-default-v4.json")
    }

    func testLapsesFollowTheServersLadder() throws {
        try assertAgrees(with: "fsrs-6-default-v4-again.json")
    }

    /// The case the fixtures cannot reach: the server's state for a card in
    /// `LEARNING` does not say which rung it is on, so the device asks for the
    /// sooner rung rather than guessing graduation.
    func testACanonicalLearningStateTakesTheSoonerRung() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let canonical = CardStateRecord(
            learningCardID: UUID(),
            state: "LEARNING",
            difficulty: 5,
            stability: 2,
            dueAt: now,
            repetitions: 1,
            lapses: 0,
            schedulerVersion: "fsrs-6-2026-09-26",
            stateVersion: 3,
            updatedAt: now,
            isLocalProjection: false
        )

        let projected = LocalSchedulerProjection.project(
            base: canonical,
            cardID: canonical.learningCardID,
            rating: .good,
            now: now
        )

        XCTAssertEqual(projected.state, "LEARNING")
        XCTAssertEqual(projected.dueAt, now.addingTimeInterval(3 * 60 * 60))
    }

    private func assertAgrees(with name: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let fixture = try Self.fixture(name)
        let cardID = UUID()
        let day: TimeInterval = 24 * 60 * 60
        var state: CardStateRecord?

        for (index, review) in fixture.reviews.enumerated() {
            let rating = try XCTUnwrap(StudyRating(rawValue: review.rating), file: file, line: line)
            let projected = LocalSchedulerProjection.project(
                base: state,
                cardID: cardID,
                rating: rating,
                now: review.occurredAt
            )
            let serverInterval = review.expected.dueAt.timeIntervalSince(review.occurredAt)
            let localInterval = projected.dueAt.timeIntervalSince(review.occurredAt)
            let label = "\(name) answer \(index + 1) (\(review.rating))"

            XCTAssertLessThanOrEqual(
                localInterval, serverInterval,
                "\(label): the device must never ask later than the server",
                file: file, line: line
            )
            // An AGAIN the server keeps in REVIEW, on the strength of the
            // card's stability, is RELEARNING three hours out on the device:
            // the sooner answer (ADR-026). Every other answer must match the
            // server's state, and its date too while that is a day or less.
            let keptInReviewByTheServer = rating == .again && review.expected.state == "REVIEW"
            if !keptInReviewByTheServer {
                XCTAssertEqual(
                    projected.state, review.expected.state,
                    "\(label): the state must match",
                    file: file, line: line
                )
                if serverInterval <= day {
                    XCTAssertEqual(
                        localInterval, serverInterval,
                        "\(label): due dates up to a day must match",
                        file: file, line: line
                    )
                }
            }
            state = projected
        }
    }

    private static func fixture(_ name: String) throws -> Fixture {
        let url = repositoryRoot
            .appending(path: "contracts/fixtures/scheduler")
            .appending(path: name)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = formatter.date(from: text) else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: decoder.codingPath, debugDescription: "Not a date: \(text)")
                )
            }
            return date
        }
        return try decoder.decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// This file sits at `ios/CountryFlagsKit/Tests/CountryFlagsDomainTests/`.
    private static let repositoryRoot: URL = URL(filePath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}
