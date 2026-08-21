import XCTest

@testable import CountryFlagsDomain

final class LocalCardSelectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    /// The chosen number means unique cards, not showings.
    func testEachSizeYieldsThatManyUniqueCards() {
        let cards = (0..<30).map { Self.card(index: $0) }

        for size in StudySessionSize.allCases {
            let selected = LocalCardSelection.select(
                from: cards,
                states: [],
                size: size,
                supportedTemplateSchemaVersions: [1],
                now: now
            )
            XCTAssertEqual(selected.count, size.rawValue, "size \(size.rawValue)")
            XCTAssertEqual(Set(selected.map(\.card.id)).count, size.rawValue, "size \(size.rawValue)")
        }
    }

    /// A deck listing the same card twice must not put it in a session twice.
    func testADuplicateMembershipIsSelectedOnce() {
        let card = Self.card(index: 0)

        let selected = LocalCardSelection.select(
            from: [card, card],
            states: [],
            size: .five,
            supportedTemplateSchemaVersions: [1],
            now: now
        )

        XCTAssertEqual(selected.count, 1)
    }

    /// Fewer usable cards than asked for yields fewer, rather than repeating
    /// one to reach the number.
    func testASmallDeckYieldsWhatItHas() {
        let selected = LocalCardSelection.select(
            from: (0..<3).map { Self.card(index: $0) },
            states: [],
            size: .ten,
            supportedTemplateSchemaVersions: [1],
            now: now
        )

        XCTAssertEqual(selected.count, 3)
    }

    func testDueCardsComeFirstThenNewOnes() {
        let due = Self.card(index: 0)
        let notDue = Self.card(index: 1)
        let new = Self.card(index: 2)

        let selected = LocalCardSelection.select(
            from: [notDue, new, due],
            states: [
                Self.state(for: due, dueAt: now.addingTimeInterval(-60)),
                Self.state(for: notDue, dueAt: now.addingTimeInterval(3600)),
            ],
            size: .five,
            supportedTemplateSchemaVersions: [1],
            now: now
        )

        XCTAssertEqual(selected.map(\.card.id), [due.id, new.id, notDue.id])
        XCTAssertEqual(selected.map(\.reason), [.due, .new, .filler])
        XCTAssertEqual(selected.map(\.order), [0, 1, 2])
    }

    /// A retired card stays readable for a session already using it and is
    /// never selected into a new one.
    func testARetiredCardIsNeverSelected() {
        let retired = Self.card(index: 0, isRetired: true)
        let usable = Self.card(index: 1)

        let selected = LocalCardSelection.select(
            from: [retired, usable],
            states: [],
            size: .five,
            supportedTemplateSchemaVersions: [1],
            now: now
        )

        XCTAssertEqual(selected.map(\.card.id), [usable.id])
    }

    /// A card this build cannot render is skipped at selection, so a session
    /// never contains a card the screen would have to refuse.
    func testAnUnsupportedTemplateIsSkippedAtSelection() {
        let unsupported = Self.card(index: 0, templateSchemaVersion: 9)
        let usable = Self.card(index: 1)

        let selected = LocalCardSelection.select(
            from: [unsupported, usable],
            states: [],
            size: .five,
            supportedTemplateSchemaVersions: [1],
            now: now
        )

        XCTAssertEqual(selected.map(\.card.id), [usable.id])
    }

    /// The same deck, the same clock and the same seed produce the same
    /// session — whatever order the store returned the cards in — which is
    /// what makes an offline selection reproducible in a test and in support.
    func testTheSameSeedReproducesTheSession() {
        let cards = (0..<10).map { Self.card(index: $0) }

        var first = SeededRandomNumberGenerator(seed: 7)
        var second = SeededRandomNumberGenerator(seed: 7)
        let one = LocalCardSelection.select(
            from: cards, states: [], size: .five,
            supportedTemplateSchemaVersions: [1], now: now, using: &first
        )
        let other = LocalCardSelection.select(
            from: cards.reversed(), states: [], size: .five,
            supportedTemplateSchemaVersions: [1], now: now, using: &second
        )

        XCTAssertEqual(one.map(\.card.id), other.map(\.card.id))
    }

    /// Two sessions over the same deck are not the same fixed sequence: the
    /// shuffle is why a learner cannot memorise the deal instead of the flags.
    func testDifferentSeedsDealDifferentSessions() {
        let cards = (0..<20).map { Self.card(index: $0) }

        var first = SeededRandomNumberGenerator(seed: 1)
        var second = SeededRandomNumberGenerator(seed: 2)
        let one = LocalCardSelection.select(
            from: cards, states: [], size: .ten,
            supportedTemplateSchemaVersions: [1], now: now, using: &first
        )
        let other = LocalCardSelection.select(
            from: cards, states: [], size: .ten,
            supportedTemplateSchemaVersions: [1], now: now, using: &second
        )

        XCTAssertNotEqual(one.map(\.card.id), other.map(\.card.id))
    }

    /// The shuffle never crosses a band: whatever the seed, everything owed
    /// comes before everything new, and the fillers stay last.
    func testTheShuffleStaysInsideItsBand() {
        let cards = (0..<12).map { Self.card(index: $0) }
        let states = [
            Self.state(for: cards[0], dueAt: now.addingTimeInterval(-60)),
            Self.state(for: cards[1], dueAt: now.addingTimeInterval(-30)),
            Self.state(for: cards[2], dueAt: now.addingTimeInterval(3600)),
            Self.state(for: cards[3], dueAt: now.addingTimeInterval(3600)),
        ]

        for seed in UInt64(0)..<8 {
            var generator = SeededRandomNumberGenerator(seed: seed)
            let selected = LocalCardSelection.select(
                from: cards, states: states, size: .twenty,
                supportedTemplateSchemaVersions: [1], now: now, using: &generator
            )
            let reasons = selected.map(\.reason)
            XCTAssertEqual(
                reasons,
                reasons.sorted { left, right in Self.bandOrder(left) < Self.bandOrder(right) },
                "seed \(seed)"
            )
            XCTAssertEqual(Set(selected.prefix(2).map(\.card.id)), [cards[0].id, cards[1].id])
        }
    }

    private static func bandOrder(_ reason: SelectionReason) -> Int {
        switch reason {
        case .due: 0
        case .new: 1
        case .filler: 2
        }
    }

    func testAnUnknownStoredSizeFallsBackRatherThanFailing() {
        XCTAssertEqual(StudySessionSize(storedValue: 7), .ten)
        XCTAssertEqual(StudySessionSize(storedValue: 20), .twenty)
    }

    // MARK: - Fixtures

    static func card(
        index: Int,
        isRetired: Bool = false,
        templateSchemaVersion: Int = 1
    ) -> LearningCardRecord {
        LearningCardRecord(
            id: UUID(uuidString: String(format: "50000000-0000-4000-8000-%012d", index))!,
            subjectEntityID: UUID(),
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: templateSchemaVersion,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: UUID(),
            displayName: "Country \(index)",
            aliases: [],
            contentVersion: "v1",
            isRetired: isRetired
        )
    }

    static func state(for card: LearningCardRecord, dueAt: Date) -> CardStateRecord {
        CardStateRecord(
            learningCardID: card.id,
            state: "REVIEW",
            difficulty: 5,
            stability: 3,
            dueAt: dueAt,
            repetitions: 2,
            lapses: 0,
            schedulerVersion: "fsrs-6",
            stateVersion: 3,
            updatedAt: dueAt,
            isLocalProjection: false
        )
    }
}

final class LocalSchedulerProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    /// Everything this produces is marked, because the backend is the source of
    /// truth for `dueAt` and a projection that looked canonical would be
    /// indistinguishable from one after a sync.
    func testAProjectedStateIsAlwaysLabelledAsLocal() {
        let projected = LocalSchedulerProjection.project(
            base: nil,
            cardID: UUID(),
            rating: .good,
            now: now
        )

        XCTAssertTrue(projected.isLocalProjection)
        XCTAssertEqual(projected.schedulerVersion, LocalSchedulerProjection.version)
    }

    func testAgainResetsTheStreakAndCountsALapse() {
        let base = Self.base(repetitions: 4, lapses: 1)

        let projected = LocalSchedulerProjection.project(
            base: base,
            cardID: base.learningCardID,
            rating: .again,
            now: now
        )

        XCTAssertEqual(projected.repetitions, 0)
        XCTAssertEqual(projected.lapses, 2)
        XCTAssertEqual(projected.state, "RELEARNING")
    }

    func testARecallAdvancesTheStreakWithoutALapse() {
        let base = Self.base(repetitions: 1, lapses: 0)

        let projected = LocalSchedulerProjection.project(
            base: base,
            cardID: base.learningCardID,
            rating: .good,
            now: now
        )

        XCTAssertEqual(projected.repetitions, 2)
        XCTAssertEqual(projected.lapses, 0)
        XCTAssertEqual(projected.state, "REVIEW")
    }

    /// Intervals grow with confidence but stay short. Showing a card sooner
    /// than the backend would costs a little repetition; showing it later would
    /// drop it out of the queue until the next sync.
    func testIntervalsGrowWithTheRatingAndStayConservative() {
        let base = Self.base(repetitions: 3, lapses: 0)
        let again = LocalSchedulerProjection.interval(base: base, rating: .again)
        let hard = LocalSchedulerProjection.interval(base: base, rating: .hard)
        let good = LocalSchedulerProjection.interval(base: base, rating: .good)
        let easy = LocalSchedulerProjection.interval(base: base, rating: .easy)

        XCTAssertLessThan(again, hard)
        XCTAssertLessThan(hard, good)
        XCTAssertLessThan(good, easy)
        XCTAssertLessThanOrEqual(easy, 3 * 24 * 60 * 60)
        // The floor the backend's ladder sets: nothing offline may promise a
        // card sooner than the server would ask for it.
        XCTAssertGreaterThanOrEqual(again, 60 * 60)
        for rating in StudyRating.allCases {
            XCTAssertGreaterThanOrEqual(
                LocalSchedulerProjection.interval(base: nil, rating: rating),
                60 * 60,
                "a first answer must not come back inside the hour either"
            )
        }
    }

    /// The state version moves so a later canonical state can be recognised as
    /// newer than the guess it replaces.
    func testTheStateVersionAdvances() {
        let base = Self.base(repetitions: 1, lapses: 0)

        let projected = LocalSchedulerProjection.project(
            base: base,
            cardID: base.learningCardID,
            rating: .good,
            now: now
        )

        XCTAssertEqual(projected.stateVersion, base.stateVersion + 1)
    }

    /// Difficulty and stability belong to the backend's model, so they are
    /// carried forward rather than invented here.
    func testTheBackendsModelValuesAreCarriedRatherThanRecomputed() {
        let base = Self.base(repetitions: 1, lapses: 0)

        let projected = LocalSchedulerProjection.project(
            base: base,
            cardID: base.learningCardID,
            rating: .easy,
            now: now
        )

        XCTAssertEqual(projected.difficulty, base.difficulty)
        XCTAssertEqual(projected.stability, base.stability)
    }

    private static func base(repetitions: Int, lapses: Int) -> CardStateRecord {
        CardStateRecord(
            learningCardID: UUID(),
            state: "REVIEW",
            difficulty: 5.5,
            stability: 12.25,
            dueAt: Date(timeIntervalSince1970: 1_800_000_000),
            repetitions: repetitions,
            lapses: lapses,
            schedulerVersion: "fsrs-6",
            stateVersion: 7,
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000),
            isLocalProjection: false
        )
    }
}
