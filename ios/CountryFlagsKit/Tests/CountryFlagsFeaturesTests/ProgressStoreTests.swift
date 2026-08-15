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
    private(set) var savedSettings: [UserSettingsRecord] = []

    init(
        settings: UserSettingsRecord? = nil,
        states: [CardStateRecord] = [],
        deckProgress: [DeckProgressRecord] = [],
        achievements: [AchievementRecord] = []
    ) {
        storedSettings = settings
        storedStates = states
        storedDeckProgress = deckProgress
        storedAchievements = achievements
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

    func activeSession(for scope: AccountScope) async throws -> StudySessionRecord? { nil }
    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws {}
    func session(id: UUID, for scope: AccountScope) async throws -> StudySessionRecord? { nil }
    func sessions(for scope: AccountScope) async throws -> [StudySessionRecord] { [] }
    func reviews(for scope: AccountScope) async throws -> [ReviewEventRecord] { [] }
    func reviews(
        inSession sessionID: UUID,
        for scope: AccountScope
    ) async throws -> [ReviewEventRecord] { [] }
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

    private func makeStore(
        cards: [UUID],
        states: [CardStateRecord],
        deckProgress: [DeckProgressRecord] = [],
        achievements: [AchievementRecord] = []
    ) -> ProgressStore {
        ProgressStore(
            content: FakeContentRepository(
                decks: [deck(id: deckID, code: "ALL", cardCount: cards.count)],
                cards: [deckID: cards.map(card)]
            ),
            learning: StoringLearningRepository(
                states: states,
                deckProgress: deckProgress,
                achievements: achievements
            ),
            scopes: FixedScopeResolver(),
            dates: FixedDateProvider(instant: fixedNow)
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
