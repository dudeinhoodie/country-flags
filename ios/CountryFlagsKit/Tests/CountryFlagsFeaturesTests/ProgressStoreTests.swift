import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// A learning store that actually keeps what it was given, which the settings
/// rules need: the point of storing first is that the value survives.
private actor StoringLearningRepository: LearningRepository {
    private var storedSettings: UserSettingsRecord?
    private var storedStates: [CardStateRecord]
    private var storedDeckProgress: [DeckProgressRecord]
    private var storedAchievements: [AchievementRecord]
    private var storedDueSummary: DueSummaryRecord?
    private(set) var savedSettings: [UserSettingsRecord] = []

    private let storedActiveSession: StudySessionRecord?
    private let storedSessionReviews: [ReviewEventRecord]

    init(
        settings: UserSettingsRecord? = nil,
        states: [CardStateRecord] = [],
        deckProgress: [DeckProgressRecord] = [],
        achievements: [AchievementRecord] = [],
        dueSummary: DueSummaryRecord? = nil,
        activeSession: StudySessionRecord? = nil,
        sessionReviews: [ReviewEventRecord] = []
    ) {
        storedSettings = settings
        storedStates = states
        storedDeckProgress = deckProgress
        storedAchievements = achievements
        storedDueSummary = dueSummary
        storedActiveSession = activeSession
        storedSessionReviews = sessionReviews
    }

    func settings(for scope: AccountScope) async throws -> UserSettingsRecord? { storedSettings }

    func saveSettings(_ settings: UserSettingsRecord, for scope: AccountScope) async throws {
        storedSettings = settings
        savedSettings.append(settings)
    }

    func cardStates(for scope: AccountScope) async throws -> [CardStateRecord] { storedStates }
    func saveCardStates(_ states: [CardStateRecord], for scope: AccountScope) async throws {
        storedStates = states
    }
    func deleteCardStates(_ learningCardIDs: [UUID], for scope: AccountScope) async throws {
        let ids = Set(learningCardIDs)
        storedStates.removeAll { ids.contains($0.learningCardID) }
    }
    func deleteAllCardStates(for scope: AccountScope) async throws {
        storedStates = []
    }

    func activeSession(for scope: AccountScope) async throws -> StudySessionRecord? {
        storedActiveSession
    }
    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws {}
    func session(id: UUID, for scope: AccountScope) async throws -> StudySessionRecord? { nil }
    func sessions(for scope: AccountScope) async throws -> [StudySessionRecord] { [] }
    func reviews(for scope: AccountScope) async throws -> [ReviewEventRecord] { [] }
    func reviews(
        inSession sessionID: UUID,
        for scope: AccountScope
    ) async throws -> [ReviewEventRecord] {
        storedSessionReviews.filter { $0.sessionID == sessionID }
    }
    func recordReview(
        _ review: ReviewEventRecord,
        projectedState: CardStateRecord,
        outbox: OutboxOperationRecord,
        for scope: AccountScope
    ) async throws {}

    func deckProgress(for scope: AccountScope) async throws -> [DeckProgressRecord] {
        storedDeckProgress
    }
    func saveDeckProgress(
        _ progress: [DeckProgressRecord],
        for scope: AccountScope
    ) async throws {
        storedDeckProgress = progress
    }
    func achievements(for scope: AccountScope) async throws -> [AchievementRecord] {
        storedAchievements
    }
    func saveAchievements(
        _ achievements: [AchievementRecord],
        for scope: AccountScope
    ) async throws {
        storedAchievements = achievements
    }

    func dueSummary(for scope: AccountScope) async throws -> DueSummaryRecord? {
        storedDueSummary
    }

    func saveDueSummary(_ summary: DueSummaryRecord, for scope: AccountScope) async throws {
        storedDueSummary = summary
    }

    func deleteAllProgress(for scope: AccountScope) async throws {
        storedStates = []
        storedDeckProgress = []
        storedAchievements = []
        storedDueSummary = nil
    }
}

/// A catalogue that counts having been read.
///
/// On a fresh install the release is still being written to the content store,
/// and a read of it waits for that import — which is the wait the empty
/// progress screen used to sit through.
private actor CountingContentRepository: ContentRepository {
    private(set) var readCount = 0

    func currentManifest() async throws -> ContentManifestRecord? { nil }

    func applyContent(
        manifest: ContentManifestRecord,
        entities: [GeoEntityRecord],
        decks: [DeckRecord],
        cards: [LearningCardRecord],
        deckCards: [DeckCardRecord]
    ) async throws {}

    func applyStagedPage(_ page: ContentPage, staging: ContentStagingState) async throws {}

    func stagingState(forVersion contentVersion: String) async throws -> ContentStagingState? { nil }

    func commitRelease(manifest: ContentManifestRecord) async throws {}

    func decks() async throws -> [DeckRecord] {
        readCount += 1
        return []
    }

    func cards(inDeck deckID: UUID) async throws -> [LearningCardRecord] {
        readCount += 1
        return []
    }

    func card(id: UUID) async throws -> LearningCardRecord? {
        readCount += 1
        return nil
    }

    func cardIdentifiersByDeck() async throws -> [UUID: [UUID]] {
        readCount += 1
        return [:]
    }

    func entity(id: UUID) async throws -> GeoEntityRecord? {
        readCount += 1
        return nil
    }

    func asset(id: UUID) async throws -> AssetRecord? {
        readCount += 1
        return nil
    }

    func retire(cardIDs: [UUID], entityIDs: [UUID]) async throws {}
}

private struct StubSettingsSync: SettingsSyncing {
    let outcome: SettingsUpdateOutcome
    let recorder: Recorder

    final class Recorder: @unchecked Sendable {
        var sent: [UserSettingsRecord] = []
    }

    func update(_ settings: UserSettingsRecord) async throws -> SettingsUpdateOutcome {
        recorder.sent.append(settings)
        return outcome
    }
}

private let fixedNow = Date(timeIntervalSince1970: 1_800_000_000)

private func deck(id: UUID, code: String, cardCount: Int) -> DeckRecord {
    DeckRecord(
        id: id,
        code: code,
        kind: "CURATED",
        name: code.capitalized,
        deckDescription: "",
        cardCount: cardCount,
        contentVersion: "v1",
        sortOrder: 0
    )
}

/// A deck the account has to hold an entitlement for.
private func lockedDeck(id: UUID, code: String, cardCount: Int) -> DeckRecord {
    DeckRecord(
        id: id,
        code: code,
        kind: "CURATED",
        name: code.capitalized,
        deckDescription: "",
        cardCount: cardCount,
        contentVersion: "v1",
        sortOrder: 1,
        accessModel: DeckAccessModel.entitlement.rawValue,
        requiredEntitlementKey: "entitlement.european_coats",
        offerCodes: ["EUROPEAN_COATS_LIFETIME"]
    )
}

private func card(_ id: UUID) -> LearningCardRecord {
    LearningCardRecord(
        id: id,
        subjectEntityID: UUID(),
        templateCode: "FLAG_TO_COUNTRY",
        templateSchemaVersion: 1,
        semanticVersion: 1,
        revision: 1,
        answerMode: "SELF_RATED",
        promptAssetID: UUID(),
        displayName: "Country",
        aliases: [],
        contentVersion: "v1"
    )
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

@MainActor
final class ProgressStoreTests: XCTestCase {
    private let deckID = UUID()

    /// The screen a guest sees: their work is durable on the device and never
    /// uploaded, so the numbers have to be read from what the device recorded.
    func testCountsAreReadFromTheDeviceEvenWithNothingFromTheServer() async {
        let cards = [UUID(), UUID(), UUID()]
        let store = makeStore(
            cards: cards,
            states: [
                state(cards[0], state: "REVIEW", dueAt: fixedNow.addingTimeInterval(-1)),
                state(cards[1], state: "LEARNING", dueAt: fixedNow.addingTimeInterval(600)),
            ]
        )

        await store.load()

        XCTAssertEqual(store.decks.count, 1)
        XCTAssertEqual(store.decks[0].totalCards, 3)
        XCTAssertEqual(store.decks[0].startedCards, 2)
        XCTAssertEqual(store.decks[0].learnedCards, 1)
        XCTAssertEqual(store.decks[0].dueCards, 1)
        XCTAssertFalse(store.hasNoProgress)
    }

    /// Mastery belongs to the server. Nothing having been said about a deck is
    /// not the same as the lowest tier, and the client may not invent one.
    func testADeckTheServerHasNotRankedHasNoTier() async {
        let cards = [UUID()]
        let store = makeStore(
            cards: cards,
            states: [state(cards[0], state: "REVIEW", dueAt: fixedNow)]
        )

        await store.load()

        XCTAssertNil(store.decks[0].masteryTier)
    }

    func testTheServerTierIsShownIncludingOneThisBuildDoesNotKnow() async {
        let cards = [UUID()]
        let store = makeStore(
            cards: cards,
            states: [state(cards[0], state: "REVIEW", dueAt: fixedNow)],
            deckProgress: [
                DeckProgressRecord(
                    deckID: deckID,
                    totalCards: 1,
                    learnedCards: 1,
                    dueCards: 0,
                    currentMasteryTier: "DIAMOND",
                    highestAchievementTier: "DIAMOND",
                    updatedAt: fixedNow
                )
            ]
        )

        await store.load()

        XCTAssertEqual(store.decks[0].masteryTier, .unknown("DIAMOND"))
    }

    /// `NONE` is the server saying the learner is on no tier yet, which is an
    /// emblem the screen must not draw.
    func testTheNoneTierIsNotDisplayedAsAnAward() async {
        let cards = [UUID()]
        let store = makeStore(
            cards: cards,
            states: [state(cards[0], state: "REVIEW", dueAt: fixedNow)],
            deckProgress: [
                DeckProgressRecord(
                    deckID: deckID,
                    totalCards: 1,
                    learnedCards: 1,
                    dueCards: 0,
                    currentMasteryTier: "NONE",
                    highestAchievementTier: "NONE",
                    updatedAt: fixedNow
                )
            ]
        )

        await store.load()

        XCTAssertNil(store.decks[0].masteryTier)
    }

    /// An empty screen is a different screen: a column of zeroes reads as a
    /// load that failed rather than as work not started.
    func testADeviceThatHasStudiedNothingSaysSo() async {
        let store = makeStore(cards: [UUID(), UUID()], states: [])

        await store.load()

        XCTAssertTrue(store.hasNoProgress)
        XCTAssertTrue(store.isLoaded)
    }

    /// And says so without reading the catalogue: the screen shows no deck rows
    /// at all, while the read would wait for the import a fresh install is
    /// still running. That wait is what left the screen loading for longer than
    /// a person — or a UI test — is willing to look at it.
    func testTheEmptyScreenReadsNoCatalogue() async {
        let content = CountingContentRepository()
        let store = ProgressStore(
            content: content,
            learning: StoringLearningRepository(),
            scopes: FixedScopeResolver(),
            dates: FixedDateProvider(instant: fixedNow)
        )

        await store.load()

        XCTAssertTrue(store.isLoaded)
        XCTAssertTrue(store.hasNoProgress)
        let reads = await content.readCount
        XCTAssertEqual(reads, 0)
    }

    func testOnlyEarnedAchievementsAreListed() async {
        let earned = AchievementRecord(
            id: UUID(),
            code: "FIRST_TEN",
            category: "VOLUME",
            tier: "BRONZE",
            scopeType: "GLOBAL",
            scopeID: nil,
            earnedAt: fixedNow
        )
        let unearned = AchievementRecord(
            id: UUID(),
            code: "FIRST_HUNDRED",
            category: "VOLUME",
            tier: "SILVER",
            scopeType: "GLOBAL",
            scopeID: nil,
            earnedAt: nil
        )
        let store = makeStore(cards: [], states: [], achievements: [earned, unearned])

        await store.load()

        XCTAssertEqual(store.achievements.map(\.code), ["FIRST_TEN"])
        XCTAssertEqual(store.achievements[0].tier, .bronze)
    }

    /// A closed app is not an abandoned session: the screen that greets the
    /// learner offers the way back, with the position they left at.
    func testAHalfAnsweredSessionIsOfferedForContinuing() async {
        let cards = [UUID(), UUID(), UUID()]
        let sessionID = UUID()
        let store = makeStore(
            cards: cards,
            states: [],
            activeSession: session(id: sessionID, cards: cards),
            sessionReviews: [review(sessionID: sessionID, cardID: cards[0])]
        )

        await store.load()

        XCTAssertEqual(store.continuable?.deckID, deckID)
        XCTAssertEqual(store.continuable?.answeredCards, 1)
        XCTAssertEqual(store.continuable?.totalCards, 3)
        XCTAssertEqual(store.continuable?.mode, .selfRated)
    }

    /// Every card answered means there is nothing to walk back into, even if
    /// the completion call never reached the server.
    func testAFullyAnsweredSessionIsNotOffered() async {
        let cards = [UUID(), UUID()]
        let sessionID = UUID()
        let store = makeStore(
            cards: cards,
            states: [],
            activeSession: session(id: sessionID, cards: cards),
            sessionReviews: cards.map { review(sessionID: sessionID, cardID: $0) }
        )

        await store.load()

        XCTAssertNil(store.continuable)
    }

    // MARK: - The backend's breakdown

    /// The counts stay local; the breakdown is the server's. A recent one is
    /// what the screen puts beside the number.
    func testARecentDueSummaryIsOfferedToTheScreen() async {
        let card = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
        let store = makeStore(
            cards: [card],
            states: [state(card, state: "REVIEW", dueAt: fixedNow)],
            dueSummary: dueSummary(serverTime: fixedNow.addingTimeInterval(-600))
        )

        await store.load()

        XCTAssertEqual(store.dueSummary?.newCards, 25)
        XCTAssertEqual(store.dueSummary?.overdue, 7)
    }

    /// Yesterday's queue presented as today's would be worse than no
    /// breakdown at all — and the number beside it is computed locally, so
    /// dropping this costs nothing that matters.
    func testAStaleDueSummaryIsNotOffered() async {
        let card = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
        let store = makeStore(
            cards: [card],
            states: [state(card, state: "REVIEW", dueAt: fixedNow)],
            dueSummary: dueSummary(serverTime: fixedNow.addingTimeInterval(-2 * 24 * 3600))
        )

        await store.load()

        XCTAssertNil(store.dueSummary)
    }

    // MARK: - The backend is the only source of truth (ADR-016)

    /// An account's counts are the backend's. The device can compute its own
    /// — it holds every answer — and deliberately does not: the two disagree
    /// whenever another device has answered, and a screen that blends them
    /// shows a total belonging to neither.
    func testAnAccountShowsTheBackendCountsAndNotTheDeviceOnes() async {
        let cards = [UUID(), UUID(), UUID()]
        let store = makeStore(
            cards: cards,
            states: [
                state(cards[0], state: "REVIEW", dueAt: fixedNow.addingTimeInterval(-1)),
                state(cards[1], state: "LEARNING", dueAt: fixedNow.addingTimeInterval(600)),
            ],
            deckProgress: [
                DeckProgressRecord(
                    deckID: deckID,
                    totalCards: 3,
                    learnedCards: 3,
                    dueCards: 2,
                    currentMasteryTier: "GOLD",
                    highestAchievementTier: "GOLD",
                    updatedAt: fixedNow
                )
            ],
            scope: .authenticated(userID: UUID())
        )

        await store.reload()

        XCTAssertEqual(store.origin, .backend)
        // The device would have said one learned and one due.
        XCTAssertEqual(store.decks[0].learnedCards, 3)
        XCTAssertEqual(store.decks[0].dueCards, 2)
        XCTAssertEqual(store.decks[0].startedCards, 3)
    }

    /// An empty answer is still an answer. Waiting on it forever is what
    /// would strand an account that has genuinely studied nothing.
    func testAnEmptyBackendAnswerEndsTheWait() async {
        let cards = [UUID()]
        let store = makeStore(
            cards: cards,
            states: [state(cards[0], state: "REVIEW", dueAt: fixedNow)],
            scope: .authenticated(userID: UUID())
        )

        await store.canonicalDataDidLand(succeeded: true)

        XCTAssertEqual(store.origin, .backend)
        XCTAssertTrue(store.decks.isEmpty)
    }

    /// A run that failed leaves the wait in place: the backend has not
    /// spoken, and an empty screen must not be presented as its answer.
    func testAFailedRunLeavesTheAccountWaiting() async {
        let cards = [UUID()]
        let store = makeStore(
            cards: cards,
            states: [state(cards[0], state: "REVIEW", dueAt: fixedNow)],
            scope: .authenticated(userID: UUID())
        )

        await store.canonicalDataDidLand(succeeded: false)

        XCTAssertEqual(store.origin, .awaitingBackend)
    }

    /// Nothing rather than a guess: a locally invented figure would be
    /// replaced by a different one the moment the backend answered, and a
    /// screen that changes its mind reads as a screen making numbers up.
    func testAnAccountWithNoBackendCountsYetShowsNothing() async {
        let cards = [UUID()]
        let store = makeStore(
            cards: cards,
            states: [state(cards[0], state: "REVIEW", dueAt: fixedNow)],
            scope: .authenticated(userID: UUID())
        )

        await store.reload()

        XCTAssertEqual(store.origin, .awaitingBackend)
        XCTAssertTrue(store.decks.isEmpty)
        XCTAssertFalse(store.isLoaded)
    }

    /// A guest is the one case the device answers for: their work is never
    /// uploaded, so there is no backend opinion to defer to.
    func testAGuestIsCountedByTheDevice() async {
        let cards = [UUID(), UUID()]
        let store = makeStore(
            cards: cards,
            states: [state(cards[0], state: "REVIEW", dueAt: fixedNow.addingTimeInterval(-1))]
        )

        await store.reload()

        XCTAssertEqual(store.origin, .device)
        XCTAssertEqual(store.decks[0].learnedCards, 1)
    }

    /// The race that left the home screen showing the numbers from before a
    /// session: two overlapping reads used to publish in the order they
    /// finished, so a slow early one could land last and win.
    func testASupersededReloadDoesNotOverwriteTheNewerOne() async {
        let cards = [UUID()]
        let store = makeStore(
            cards: cards,
            states: [state(cards[0], state: "REVIEW", dueAt: fixedNow)],
            scope: .authenticated(userID: UUID())
        )

        // Started and immediately superseded; the second reload is the one
        // whose result may be published.
        async let first: Void = store.reload()
        await store.reload()
        await first

        XCTAssertEqual(store.origin, .awaitingBackend)
        XCTAssertFalse(store.isRefreshing)
    }

    /// One answer to "how much does today owe", asked of the store that owns
    /// the numbers. The home screen used to work it out from a different
    /// reading than this one, so the hero could disagree with the rows.
    func testTheDayIsOwedWhatTheBackendSummarySays() async {
        let card = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
        let store = makeStore(
            cards: [card],
            states: [state(card, state: "REVIEW", dueAt: fixedNow)],
            dueSummary: dueSummary(serverTime: fixedNow.addingTimeInterval(-600))
        )

        await store.reload()

        XCTAssertEqual(store.totalDue, 23)
    }

    private func dueSummary(serverTime: Date) -> DueSummaryRecord {
        DueSummaryRecord(
            overdue: 7,
            learning: 3,
            relearning: 1,
            review: 12,
            newCards: 25,
            totalDue: 23,
            serverTime: serverTime
        )
    }

    /// A deck that has to be bought and has none of its cards on the device
    /// is a deck this account has nothing in. The progress screen leaves it
    /// out rather than claiming a size the learner cannot reach.
    func testALockedDeckIsNotCountedAsProgressWaitingToHappen() async {
        let locked = UUID()
        let answered = UUID()
        let store = ProgressStore(
            content: FakeContentRepository(
                decks: [
                    deck(id: deckID, code: "ALL", cardCount: 1),
                    lockedDeck(id: locked, code: "EUROPEAN_COATS", cardCount: 52),
                ],
                cards: [deckID: [card(answered)]]
            ),
            // Something has been answered, or the screen shows no rows at all
            // and this would prove nothing.
            learning: StoringLearningRepository(
                states: [state(answered, state: "REVIEW", dueAt: fixedNow)]
            ),
            scopes: FixedScopeResolver(scope: .guest(installationID: UUID())),
            dates: FixedDateProvider(instant: fixedNow)
        )

        await store.reload()

        XCTAssertEqual(store.decks.map(\.code), ["ALL"])
    }

    private func makeStore(
        cards: [UUID],
        states: [CardStateRecord],
        deckProgress: [DeckProgressRecord] = [],
        achievements: [AchievementRecord] = [],
        dueSummary: DueSummaryRecord? = nil,
        activeSession: StudySessionRecord? = nil,
        sessionReviews: [ReviewEventRecord] = [],
        scope: AccountScope = .guest(installationID: UUID())
    ) -> ProgressStore {
        ProgressStore(
            content: FakeContentRepository(
                decks: [deck(id: deckID, code: "ALL", cardCount: cards.count)],
                cards: [deckID: cards.map(card)]
            ),
            learning: StoringLearningRepository(
                states: states,
                deckProgress: deckProgress,
                achievements: achievements,
                dueSummary: dueSummary,
                activeSession: activeSession,
                sessionReviews: sessionReviews
            ),
            scopes: FixedScopeResolver(scope: scope),
            dates: FixedDateProvider(instant: fixedNow)
        )
    }

    private func session(id: UUID, cards: [UUID]) -> StudySessionRecord {
        StudySessionRecord(
            id: id,
            deckID: deckID,
            mode: "SELF_RATED",
            selectionOrigin: "CLIENT_OFFLINE",
            requestedUniqueCount: 10,
            status: "ACTIVE",
            contentVersion: "fixture-v2",
            startedAt: fixedNow,
            completedAt: nil,
            cards: cards.enumerated().map { index, cardID in
                StudySessionCardRecord(
                    id: UUID(),
                    learningCardID: cardID,
                    initialOrder: index,
                    selectionReason: "NEW",
                    displayName: "Country \(index)",
                    promptAssetID: UUID(),
                    revision: 1,
                    optionIDs: [],
                    optionNames: []
                )
            }
        )
    }

    private func review(sessionID: UUID, cardID: UUID) -> ReviewEventRecord {
        ReviewEventRecord(
            id: UUID(),
            sessionID: sessionID,
            learningCardID: cardID,
            rating: "GOOD",
            answerMode: "SELF_RATED",
            selectedOptionID: nil,
            responseTimeMilliseconds: nil,
            clientOccurredAt: fixedNow,
            estimatedServerOccurredAt: nil,
            clientSequence: 1,
            baseStateVersion: nil
        )
    }
}

@MainActor
final class SettingsStoreTests: XCTestCase {
    /// The change has to survive a launch in a tunnel, so it is stored before
    /// anything is offered to a server.
    func testAChangeIsStoredBeforeItIsSent() async {
        let learning = StoringLearningRepository()
        let store = SettingsStore(
            learning: learning,
            scopes: FixedScopeResolver(),
            dates: FixedDateProvider(instant: fixedNow)
        )
        await store.load()

        await store.setSessionSize(20)

        XCTAssertEqual(store.settings.sessionSize, 20)
        let saved = await learning.savedSettings
        XCTAssertEqual(saved.map(\.sessionSize), [20])
    }

    /// A guest has no account to attribute anything to, so nothing is offered
    /// to the server and the version stays where the server left it.
    func testAGuestChangeIsNotSent() async {
        let recorder = StubSettingsSync.Recorder()
        let store = SettingsStore(
            learning: StoringLearningRepository(),
            scopes: FixedScopeResolver(scope: .guest(installationID: UUID())),
            sync: StubSettingsSync(
                outcome: .updated(SettingsStore.defaults(now: fixedNow)),
                recorder: recorder
            ),
            dates: FixedDateProvider(instant: fixedNow)
        )
        await store.load()

        await store.setSoundEnabled(false)

        XCTAssertTrue(recorder.sent.isEmpty)
        XCTAssertFalse(store.settings.soundEnabled)
    }

    func testAnAcceptedChangeTakesTheVersionTheServerReturned() async {
        let accepted = UserSettingsRecord(
            sessionSize: 5,
            contentLocale: "en",
            defaultAnswerMode: "SELF_RATED",
            extraFactTypes: [],
            soundEnabled: true,
            hapticsEnabled: true,
            remindersEnabled: false,
            version: 7,
            updatedAt: fixedNow
        )
        let learning = StoringLearningRepository()
        let store = SettingsStore(
            learning: learning,
            scopes: FixedScopeResolver(scope: .authenticated(userID: UUID())),
            sync: StubSettingsSync(outcome: .updated(accepted), recorder: .init()),
            dates: FixedDateProvider(instant: fixedNow)
        )
        await store.load()

        await store.setSessionSize(5)

        XCTAssertEqual(store.settings.version, 7)
        let saved = await learning.savedSettings
        XCTAssertEqual(saved.last?.version, 7)
    }

    /// The deterministic recovery: another device wrote first, so this one
    /// takes what the server has instead of retrying and overwriting it.
    func testAConflictReloadsTheServerSettingsRatherThanRetrying() async {
        let server = UserSettingsRecord(
            sessionSize: 10,
            contentLocale: "ru",
            defaultAnswerMode: "SELF_RATED",
            extraFactTypes: [],
            soundEnabled: false,
            hapticsEnabled: false,
            remindersEnabled: true,
            version: 9,
            updatedAt: fixedNow
        )
        let recorder = StubSettingsSync.Recorder()
        let learning = StoringLearningRepository()
        let store = SettingsStore(
            learning: learning,
            scopes: FixedScopeResolver(scope: .authenticated(userID: UUID())),
            sync: StubSettingsSync(outcome: .conflict(server), recorder: recorder),
            dates: FixedDateProvider(instant: fixedNow)
        )
        await store.load()

        await store.setSessionSize(20)

        XCTAssertEqual(store.settings, server)
        XCTAssertTrue(store.didReloadAfterConflict)
        // Exactly one attempt: a retry would overwrite the other device.
        XCTAssertEqual(recorder.sent.count, 1)
        let saved = await learning.savedSettings
        XCTAssertEqual(saved.last, server)
    }

    /// A round trip that never happened must not cost the choice the user made.
    func testAChangeSurvivesAFailedRoundTrip() async {
        struct FailingSync: SettingsSyncing {
            func update(_ settings: UserSettingsRecord) async throws -> SettingsUpdateOutcome {
                throw APIStubError.unreachable
            }
        }
        let store = SettingsStore(
            learning: StoringLearningRepository(),
            scopes: FixedScopeResolver(scope: .authenticated(userID: UUID())),
            sync: FailingSync(),
            dates: FixedDateProvider(instant: fixedNow)
        )
        await store.load()

        await store.setHapticsEnabled(false)

        XCTAssertFalse(store.settings.hapticsEnabled)
        XCTAssertFalse(store.didReloadAfterConflict)
    }
}

private enum APIStubError: Error {
    case unreachable
}

/// The feature tests have no date double of their own; the study runners all
/// take a clock, so one lives here for whatever needs a fixed instant.
struct FixedDateProvider: DateProviding {
    let instant: Date

    func now() -> Date { instant }
}
