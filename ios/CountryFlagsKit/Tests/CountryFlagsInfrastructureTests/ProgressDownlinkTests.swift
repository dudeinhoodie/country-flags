import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The canonical answers ride home on the sync run: deck mastery and
/// achievements are the backend's to compute, the store's to hold, and the
/// screens' only source. These pin the wiring and its guards — a miss is
/// reported without blocking the upload, what arrived is kept, and older
/// settings never roll a device back.
final class ProgressDownlinkTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000001")!
    )

    func testASyncRunStoresTheCanonicalProgress() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(result: .success(Fixtures.snapshot(now: now)))
        )

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertNil(status.lastFailure)
        let decks = try await learning.deckProgress(for: account)
        XCTAssertEqual(decks.map(\.currentMasteryTier), ["SILVER"])
        let achievements = try await learning.achievements(for: account)
        XCTAssertEqual(achievements.map(\.code), ["FIRST_SESSION"])
    }

    /// A downlink that misses leaves yesterday's canon on screen, and the run
    /// says so: a screen re-reading the store would otherwise present the old
    /// numbers as checked. The failure is the transport's, so the chip can
    /// say "no network", and the run records no success time.
    func testADownlinkMissIsReportedAsTheRunsFailure() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(result: .failure(APIError.transport("-1005")))
        )

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertEqual(status.lastFailure, .offline)
        XCTAssertNil(status.lastSuccessAt)
    }

    /// The documents ride in parallel; the one request the radio dropped must
    /// not cost the three that landed. What arrived is stored, and the miss
    /// is still the run's failure.
    func testAPartialDownloadKeepsWhatArrivedAndStillReportsTheMiss() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let whole = Fixtures.snapshot(now: now)
        let partial = PartialProgressDownload(
            delivered: ProgressSnapshot(
                decks: whole.decks,
                achievements: nil,
                settings: nil,
                dueSummary: nil
            ),
            missing: [.achievements, .settings, .dueSummary],
            underlying: APIError.transport("-1005")
        )
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(result: .failure(partial))
        )

        let status = await coordinator.synchronize(scope: account, trigger: .launch)

        XCTAssertEqual(status.lastFailure, .offline)
        let decks = try await learning.deckProgress(for: account)
        XCTAssertEqual(decks.map(\.currentMasteryTier), ["SILVER"])
        let achievements = try await learning.achievements(for: account)
        XCTAssertTrue(achievements.isEmpty)
    }

    /// The version moves when the server accepts a change, so an older number
    /// arriving late must not roll back what another device wrote through.
    func testOlderServerSettingsDoNotRollTheDeviceBack() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let newer = Fixtures.settings(version: 5, sessionSize: 20, now: now)
        try await learning.saveSettings(newer, for: account)
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(
                result: .success(
                    Fixtures.snapshot(
                        now: now,
                        settings: Fixtures.settings(version: 3, sessionSize: 5, now: now)
                    )
                )
            )
        )

        _ = await coordinator.synchronize(scope: account, trigger: .launch)

        let stored = try await learning.settings(for: account)
        XCTAssertEqual(stored?.version, 5)
        XCTAssertEqual(stored?.sessionSize, 20)
    }

    func testNewerServerSettingsReplaceTheLocalOnes() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        try await learning.saveSettings(
            Fixtures.settings(version: 2, sessionSize: 10, now: now), for: account
        )
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(
                result: .success(
                    Fixtures.snapshot(
                        now: now,
                        settings: Fixtures.settings(version: 4, sessionSize: 5, now: now)
                    )
                )
            )
        )

        _ = await coordinator.synchronize(scope: account, trigger: .launch)

        let stored = try await learning.settings(for: account)
        XCTAssertEqual(stored?.version, 4)
        XCTAssertEqual(stored?.sessionSize, 5)
    }

    /// The settings screen stored a change whose round trip failed. The
    /// server still holds the version it was based on, with the old value,
    /// so the run offers the change again and keeps what the server accepted.
    func testAChangeTheServerNeverHeardIsOfferedAgain() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let unsent = Fixtures.settings(version: 3, sessionSize: 20, now: now)
        try await learning.saveSettings(unsent, for: account)
        let settingsSync = ScriptedSettingsSync(
            result: .success(.updated(Fixtures.settings(version: 4, sessionSize: 20, now: now)))
        )
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(
                result: .success(
                    Fixtures.snapshot(
                        now: now,
                        settings: Fixtures.settings(version: 3, sessionSize: 10, now: now)
                    )
                )
            ),
            settingsSync: settingsSync
        )

        _ = await coordinator.synchronize(scope: account, trigger: .launch)

        let sent = await settingsSync.sent
        XCTAssertEqual(sent, [unsent])
        let stored = try await learning.settings(for: account)
        XCTAssertEqual(stored?.version, 4)
        XCTAssertEqual(stored?.sessionSize, 20)
    }

    func testSettingsTheServerAlreadyHoldsAreNotSentAgain() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let same = Fixtures.settings(version: 3, sessionSize: 20, now: now)
        try await learning.saveSettings(same, for: account)
        let settingsSync = ScriptedSettingsSync(
            result: .success(.updated(Fixtures.settings(version: 4, sessionSize: 20, now: now)))
        )
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(
                result: .success(Fixtures.snapshot(now: now, settings: same))
            ),
            settingsSync: settingsSync
        )

        _ = await coordinator.synchronize(scope: account, trigger: .launch)

        let sent = await settingsSync.sent
        XCTAssertTrue(sent.isEmpty)
    }

    /// Another device wrote between the failed round trip and this run. Its
    /// settings win, as they would have on the screen.
    func testAnUnsentChangeThatMeetsAConflictTakesTheServerSettings() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        try await learning.saveSettings(
            Fixtures.settings(version: 3, sessionSize: 20, now: now), for: account
        )
        let settingsSync = ScriptedSettingsSync(
            result: .success(.conflict(Fixtures.settings(version: 5, sessionSize: 5, now: now)))
        )
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(
                result: .success(
                    Fixtures.snapshot(
                        now: now,
                        settings: Fixtures.settings(version: 3, sessionSize: 10, now: now)
                    )
                )
            ),
            settingsSync: settingsSync
        )

        _ = await coordinator.synchronize(scope: account, trigger: .launch)

        let stored = try await learning.settings(for: account)
        XCTAssertEqual(stored?.version, 5)
        XCTAssertEqual(stored?.sessionSize, 5)
    }

    /// Still no network for the change: it stays on the device for the next
    /// run, which sees the same difference and tries again.
    func testAnUnsentChangeThatStillCannotBeDeliveredStaysOnTheDevice() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        try await learning.saveSettings(
            Fixtures.settings(version: 3, sessionSize: 20, now: now), for: account
        )
        let coordinator = makeCoordinator(
            store: store,
            download: ScriptedDownload(
                result: .success(
                    Fixtures.snapshot(
                        now: now,
                        settings: Fixtures.settings(version: 3, sessionSize: 10, now: now)
                    )
                )
            ),
            settingsSync: ScriptedSettingsSync(result: .failure(APIError.transport("-1009")))
        )

        _ = await coordinator.synchronize(scope: account, trigger: .launch)

        let stored = try await learning.settings(for: account)
        XCTAssertEqual(stored?.version, 3)
        XCTAssertEqual(stored?.sessionSize, 20)
    }

    // MARK: - Harness

    private func makeCoordinator(
        store: LocalStore,
        download: ScriptedDownload,
        settingsSync: ScriptedSettingsSync? = nil
    ) -> SyncCoordinator {
        SyncCoordinator(
            outbox: store.makeOutboxRepository(),
            learning: store.makeLearningRepository(),
            uploader: AcceptingUploader(),
            progressDownload: download,
            settingsSync: settingsSync,
            dates: FixedDateProvider(instant: now)
        )
    }
}

// MARK: - Doubles

private struct AcceptingUploader: ReviewUploading {
    func upload(_ operations: [OutboxOperationRecord]) async throws -> ReviewBatchOutcome {
        ReviewBatchOutcome(
            acknowledgements: [],
            cursor: nil,
            serverTime: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}

/// Answers every settings change the same way and remembers what was sent.
private actor ScriptedSettingsSync: SettingsSyncing {
    private let result: Result<SettingsUpdateOutcome, any Error>
    private(set) var sent: [UserSettingsRecord] = []

    init(result: Result<SettingsUpdateOutcome, any Error>) {
        self.result = result
    }

    func update(_ settings: UserSettingsRecord) async throws -> SettingsUpdateOutcome {
        sent.append(settings)
        return try result.get()
    }
}

private struct ScriptedDownload: ProgressDownloading {
    let result: Result<ProgressSnapshot, any Error>

    func download() async throws -> ProgressSnapshot {
        try result.get()
    }
}

private enum Fixtures {
    struct Offline: Error {}

    static func snapshot(now: Date, settings: UserSettingsRecord? = nil) -> ProgressSnapshot {
        ProgressSnapshot(
            decks: [
                DeckProgressRecord(
                    deckID: UUID(uuidString: "40000000-0000-4000-8000-000000000001")!,
                    totalCards: 52,
                    learnedCards: 20,
                    dueCards: 4,
                    currentMasteryTier: "SILVER",
                    highestAchievementTier: "SILVER",
                    updatedAt: now
                )
            ],
            achievements: [
                AchievementRecord(
                    id: UUID(uuidString: "a0000000-0000-4000-8000-000000000001")!,
                    code: "FIRST_SESSION",
                    category: "MILESTONE",
                    tier: "BRONZE",
                    scopeType: "GLOBAL",
                    scopeID: nil,
                    earnedAt: now
                )
            ],
            settings: settings
        )
    }

    static func settings(version: Int, sessionSize: Int, now: Date) -> UserSettingsRecord {
        UserSettingsRecord(
            sessionSize: sessionSize,
            contentLocale: "en",
            defaultAnswerMode: "SELF_RATED",
            extraFactTypes: [],
            soundEnabled: true,
            hapticsEnabled: true,
            remindersEnabled: false,
            version: version,
            updatedAt: now
        )
    }
}
