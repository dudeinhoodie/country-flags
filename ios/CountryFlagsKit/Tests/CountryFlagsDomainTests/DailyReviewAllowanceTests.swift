import XCTest

@testable import CountryFlagsDomain

/// The day's limit on owed cards, on the device (#438): the same cut the
/// server makes, so a guest's session stops dealing owed cards where an
/// account's would.
final class DailyReviewAllowanceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let day: TimeInterval = 24 * 60 * 60

    func testTheAllowanceTakesTheOldestDebtAndLeavesTheRestOut() {
        let owed = (0..<4).map { LocalCardSelectionTests.card(index: $0) }
        let new = (10..<13).map { LocalCardSelectionTests.card(index: $0) }
        // Oldest first: index 0 was due four days ago, index 3 yesterday.
        let states = owed.enumerated().map { offset, card in
            LocalCardSelectionTests.state(
                for: card,
                dueAt: now.addingTimeInterval(-Double(4 - offset) * day)
            )
        }

        let selected = LocalCardSelection.select(
            from: owed + new,
            states: states,
            size: .ten,
            supportedTemplateSchemaVersions: [1],
            now: now,
            dueAllowance: 2
        )

        let dealt = Set(selected.map(\.card.id))
        XCTAssertEqual(
            Set(selected.filter { $0.reason == .due }.map(\.card.id)),
            Set(owed.prefix(2).map(\.id))
        )
        // Past the allowance an owed card is not dealt as filler either: it
        // is still owed, tomorrow.
        XCTAssertFalse(dealt.contains(owed[2].id))
        XCTAssertFalse(dealt.contains(owed[3].id))
        // New cards are not owed, and the limit does not touch them.
        XCTAssertTrue(Set(new.map(\.id)).isSubset(of: dealt))
    }

    func testAtTheLimitNoOwedCardIsDealt() {
        let owed = LocalCardSelectionTests.card(index: 0)
        let new = LocalCardSelectionTests.card(index: 1)

        let selected = LocalCardSelection.select(
            from: [owed, new],
            states: [LocalCardSelectionTests.state(for: owed, dueAt: now.addingTimeInterval(-day))],
            size: .five,
            supportedTemplateSchemaVersions: [1],
            now: now,
            dueAllowance: 0
        )

        XCTAssertEqual(selected.map(\.card.id), [new.id])
    }

    func testWithoutAnAllowanceEveryOwedCardIsDealt() {
        let owed = (0..<3).map { LocalCardSelectionTests.card(index: $0) }

        let selected = LocalCardSelection.select(
            from: owed,
            states: owed.map {
                LocalCardSelectionTests.state(for: $0, dueAt: now.addingTimeInterval(-day))
            },
            size: .five,
            supportedTemplateSchemaVersions: [1],
            now: now
        )

        XCTAssertEqual(selected.filter { $0.reason == .due }.count, 3)
    }

    func testTheRoomLeftCountsDistinctCardsAnsweredToday() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let today = (0..<10).map { index in
            answered(LocalCardSelectionTests.card(index: index), at: now)
        }
        let yesterday = (10..<15).map { index in
            answered(LocalCardSelectionTests.card(index: index), at: now.addingTimeInterval(-day))
        }

        XCTAssertEqual(
            DailyReviewAllowance.answeredToday(today + yesterday, now: now, calendar: calendar),
            10
        )
        XCTAssertEqual(
            DailyReviewAllowance.remaining(today + yesterday, now: now, calendar: calendar),
            DailyReviewAllowance.limit - 10
        )

        let full = (0..<60).map { index in
            answered(LocalCardSelectionTests.card(index: index), at: now)
        }
        XCTAssertEqual(DailyReviewAllowance.remaining(full, now: now, calendar: calendar), 0)
    }

    private func answered(_ card: LearningCardRecord, at date: Date) -> CardStateRecord {
        CardStateRecord(
            learningCardID: card.id,
            state: "LEARNING",
            difficulty: 5,
            stability: 1,
            dueAt: date.addingTimeInterval(3 * 60 * 60),
            repetitions: 1,
            lapses: 0,
            schedulerVersion: "local-conservative-1",
            stateVersion: 1,
            updatedAt: date,
            isLocalProjection: true
        )
    }
}
