import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// Reminders are a wish plus a permission, and the two are not the same thing.
/// These pin what the settings store does with each answer the system gives —
/// and that studying never depends on any of it.
@MainActor
final class ReminderSettingsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testTurningRemindersOnAsksAndThenSchedules() async throws {
        let reminders = RecordingReminderScheduler(authorization: .notDetermined, grants: true)
        let preferences = InMemoryReminderPreferences()
        let store = makeStore(reminders: reminders, preferences: preferences)
        await store.load()

        await store.setRemindersEnabled(true)

        XCTAssertTrue(store.settings.remindersEnabled)
        XCTAssertEqual(store.reminderAuthorization, .authorized)
        let scheduled = await reminders.scheduled()
        XCTAssertEqual(scheduled.count, 1)
        XCTAssertEqual(scheduled.first?.hour, ReminderSchedule.evening.hour)
    }

    /// A refusal is not recorded as "on": a switch standing over a permission
    /// iOS has denied promises a reminder that will never arrive.
    func testARefusalLeavesThePreferenceOffAndSchedulesNothing() async throws {
        let reminders = RecordingReminderScheduler(authorization: .notDetermined, grants: false)
        let store = makeStore(reminders: reminders, preferences: InMemoryReminderPreferences())
        await store.load()

        await store.setRemindersEnabled(true)

        XCTAssertFalse(store.settings.remindersEnabled)
        XCTAssertEqual(store.reminderAuthorization, .denied)
        let scheduled = await reminders.scheduled()
        XCTAssertTrue(scheduled.isEmpty)
    }

    /// Asking again after a refusal is a request iOS answers without showing
    /// anyone anything, so the store does not ask.
    func testASecondAttemptAfterARefusalDoesNotAskAgain() async throws {
        let reminders = RecordingReminderScheduler(authorization: .denied, grants: false)
        let store = makeStore(reminders: reminders, preferences: InMemoryReminderPreferences())
        await store.load()

        await store.setRemindersEnabled(true)

        let requests = await reminders.requestCount()
        XCTAssertEqual(requests, 0)
        XCTAssertEqual(store.reminderAuthorization, .denied)
    }

    func testTurningRemindersOffCancelsTheScheduledOne() async throws {
        let reminders = RecordingReminderScheduler(authorization: .authorized, grants: true)
        let store = makeStore(reminders: reminders, preferences: InMemoryReminderPreferences())
        await store.load()
        await store.setRemindersEnabled(true)
        // Loading with reminders off cancels once on its own, so the count is
        // read from here rather than from zero.
        let cancelsBefore = await reminders.cancelCount()

        await store.setRemindersEnabled(false)

        XCTAssertFalse(store.settings.remindersEnabled)
        let cancels = await reminders.cancelCount()
        XCTAssertEqual(cancels, cancelsBefore + 1)
    }

    /// The hour is a device preference: it is stored here and applied at once,
    /// rather than waiting for a sync that would never carry it.
    func testChangingTheHourStoresItAndReschedules() async throws {
        let reminders = RecordingReminderScheduler(authorization: .authorized, grants: true)
        let preferences = InMemoryReminderPreferences()
        let store = makeStore(reminders: reminders, preferences: preferences)
        await store.load()
        await store.setRemindersEnabled(true)

        await store.setReminderTime(ReminderSchedule(hour: 8, minute: 30))

        XCTAssertEqual(store.reminderTime, ReminderSchedule(hour: 8, minute: 30))
        XCTAssertEqual(preferences.stored, ReminderSchedule(hour: 8, minute: 30))
        let scheduled = await reminders.scheduled()
        XCTAssertEqual(scheduled.last, ReminderSchedule(hour: 8, minute: 30))
    }

    /// Permission can be taken away in System Settings between visits. The
    /// screen that comes back must stop claiming a reminder it cannot deliver.
    func testPermissionRevokedBetweenVisitsCancelsTheReminder() async throws {
        let reminders = RecordingReminderScheduler(authorization: .denied, grants: false)
        let learning = ReminderTestRepository(
            settings: Fixtures.settings(remindersEnabled: true, now: now)
        )
        let store = SettingsStore(
            learning: learning,
            scopes: FixedScopes(scope: Fixtures.account),
            reminders: reminders,
            reminderPreferences: InMemoryReminderPreferences(),
            dates: FixedDateProvider(instant: now)
        )

        await store.load()

        XCTAssertEqual(store.reminderAuthorization, .denied)
        let cancels = await reminders.cancelCount()
        XCTAssertEqual(cancels, 1)
        let scheduled = await reminders.scheduled().isEmpty
        XCTAssertTrue(scheduled)
    }

    /// A setting that travelled from another device is a wish, not a
    /// permission: the contract says so in as many words, so loading it asks
    /// the system for nothing and schedules nothing.
    func testASettingArrivingFromAnotherDeviceDoesNotAskOrSchedule() async throws {
        let reminders = RecordingReminderScheduler(authorization: .notDetermined, grants: true)
        let store = SettingsStore(
            learning: ReminderTestRepository(
                settings: Fixtures.settings(remindersEnabled: true, now: now)
            ),
            scopes: FixedScopes(scope: Fixtures.account),
            reminders: reminders,
            reminderPreferences: InMemoryReminderPreferences(),
            dates: FixedDateProvider(instant: now)
        )

        await store.load()

        XCTAssertTrue(store.settings.remindersEnabled)
        XCTAssertEqual(store.reminderAuthorization, .notDetermined)
        let requests = await reminders.requestCount()
        XCTAssertEqual(requests, 0)
        let scheduled = await reminders.scheduled()
        XCTAssertTrue(scheduled.isEmpty)
    }

    /// The way out of that state is somebody asking for it.
    func testAskingExplicitlyThenSchedules() async throws {
        let reminders = RecordingReminderScheduler(authorization: .notDetermined, grants: true)
        let store = SettingsStore(
            learning: ReminderTestRepository(
                settings: Fixtures.settings(remindersEnabled: true, now: now)
            ),
            scopes: FixedScopes(scope: Fixtures.account),
            reminders: reminders,
            reminderPreferences: InMemoryReminderPreferences(),
            dates: FixedDateProvider(instant: now)
        )
        await store.load()

        await store.requestReminderPermission()

        XCTAssertEqual(store.reminderAuthorization, .authorized)
        let scheduled = await reminders.scheduled()
        XCTAssertEqual(scheduled.count, 1)
    }

    /// The stored hour survives a relaunch, which is the whole point of
    /// keeping it on the device.
    func testAStoredHourIsReadBackOnLoad() async throws {
        let preferences = InMemoryReminderPreferences()
        preferences.store(reminderSchedule: ReminderSchedule(hour: 21, minute: 15))
        let store = makeStore(
            reminders: RecordingReminderScheduler(authorization: .authorized, grants: true),
            preferences: preferences
        )

        await store.load()

        XCTAssertEqual(store.reminderTime, ReminderSchedule(hour: 21, minute: 15))
    }

    // MARK: - Harness

    private func makeStore(
        reminders: RecordingReminderScheduler,
        preferences: InMemoryReminderPreferences
    ) -> SettingsStore {
        SettingsStore(
            learning: ReminderTestRepository(settings: nil),
            scopes: FixedScopes(scope: Fixtures.account),
            reminders: reminders,
            reminderPreferences: preferences,
            dates: FixedDateProvider(instant: now)
        )
    }

    private enum Fixtures {
        static let account = AccountScope.authenticated(
            userID: UUID(uuidString: "90000000-0000-4000-8000-00000000000a")!
        )

        static func settings(remindersEnabled: Bool, now: Date) -> UserSettingsRecord {
            UserSettingsRecord(
                sessionSize: 10,
                contentLocale: "en",
                defaultAnswerMode: "SELF_RATED",
                extraFactTypes: [],
                soundEnabled: true,
                hapticsEnabled: true,
                remindersEnabled: remindersEnabled,
                version: 1,
                updatedAt: now
            )
        }
    }
}

// MARK: - Doubles

/// A notification centre that records instead of asking iOS for anything.
private actor RecordingReminderScheduler: ReminderScheduling {
    private var currentAuthorization: ReminderAuthorization
    private let grants: Bool
    private var requests = 0
    private var cancels = 0
    private var schedules: [ReminderSchedule] = []

    init(authorization: ReminderAuthorization, grants: Bool) {
        currentAuthorization = authorization
        self.grants = grants
    }

    func authorization() async -> ReminderAuthorization { currentAuthorization }

    func requestAuthorization() async -> ReminderAuthorization {
        requests += 1
        currentAuthorization = grants ? .authorized : .denied
        return currentAuthorization
    }

    func schedule(_ schedule: ReminderSchedule, saying content: ReminderContent) async {
        schedules.append(schedule)
    }

    func cancel() async { cancels += 1 }

    func requestCount() -> Int { requests }
    func cancelCount() -> Int { cancels }
    func scheduled() -> [ReminderSchedule] { schedules }
}

private final class InMemoryReminderPreferences: ReminderPreferenceStoring, @unchecked Sendable {
    private(set) var stored: ReminderSchedule?

    func reminderSchedule() -> ReminderSchedule? { stored }

    func store(reminderSchedule: ReminderSchedule) { stored = reminderSchedule }
}

private struct FixedScopes: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}

/// Only the settings half of the store is exercised here.
private actor ReminderTestRepository: LearningRepository {
    private var storedSettings: UserSettingsRecord?

    init(settings: UserSettingsRecord?) {
        storedSettings = settings
    }

    func settings(for scope: AccountScope) async throws -> UserSettingsRecord? { storedSettings }

    func saveSettings(_ settings: UserSettingsRecord, for scope: AccountScope) async throws {
        storedSettings = settings
    }

    func cardStates(for scope: AccountScope) async throws -> [CardStateRecord] { [] }
    func saveCardStates(_ states: [CardStateRecord], for scope: AccountScope) async throws {}
    func deleteCardStates(_ learningCardIDs: [UUID], for scope: AccountScope) async throws {}
    func deleteAllCardStates(for scope: AccountScope) async throws {}
    func activeSession(for scope: AccountScope) async throws -> StudySessionRecord? { nil }
    func session(id: UUID, for scope: AccountScope) async throws -> StudySessionRecord? { nil }
    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws {}
    func reviews(inSession sessionID: UUID, for scope: AccountScope) async throws
        -> [ReviewEventRecord]
    { [] }
    func sessions(for scope: AccountScope) async throws -> [StudySessionRecord] { [] }
    func reviews(for scope: AccountScope) async throws -> [ReviewEventRecord] { [] }
    func recordReview(
        _ review: ReviewEventRecord,
        projectedState: CardStateRecord,
        outbox: OutboxOperationRecord,
        for scope: AccountScope
    ) async throws {}
    func deckProgress(for scope: AccountScope) async throws -> [DeckProgressRecord] { [] }
    func saveDeckProgress(_ progress: [DeckProgressRecord], for scope: AccountScope) async throws {}
    func achievements(for scope: AccountScope) async throws -> [AchievementRecord] { [] }
    func saveAchievements(_ achievements: [AchievementRecord], for scope: AccountScope) async throws {}
    func dueSummary(for scope: AccountScope) async throws -> DueSummaryRecord? { nil }
    func saveDueSummary(_ summary: DueSummaryRecord, for scope: AccountScope) async throws {}
    func deleteAllProgress(for scope: AccountScope) async throws {}
}
