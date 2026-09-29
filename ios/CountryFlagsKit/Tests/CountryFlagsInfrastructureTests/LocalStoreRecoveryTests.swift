import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// A store that will not open (#445).
///
/// It used to end in `fatalError` on every launch. These tests hold the
/// recovery to what the issue asks: the launch carries on with a fresh store,
/// and the file that would not open is kept, byte for byte.
final class LocalStoreRecoveryTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    /// The acceptance criteria, on a real file: bytes that are not a database
    /// where the store should be. The launch gets a working store, says that
    /// it started fresh, and the damaged file sits unchanged in the folder the
    /// notice names.
    func testACorruptedStoreIsSetAsideAndAFreshOneOpens() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let damaged = Data(String(repeating: "not a database. ", count: 512).utf8)
        try damaged.write(to: temporary.fileURL)
        XCTAssertThrowsError(try LocalStore(fileURL: temporary.fileURL), "the fixture must fail to open")

        let logger = RecordingLogger()
        let opening = try LocalStoreRecovery.open(
            fileURL: temporary.fileURL,
            now: now,
            logger: logger
        )

        let notice = try XCTUnwrap(opening.recovery)
        XCTAssertEqual(notice.outcome, .startedFresh)
        XCTAssertEqual(notice.occurredAt, now)
        let folder = try XCTUnwrap(notice.preservedFolder)
        let kept = temporary.directory
            .appendingPathComponent(LocalStoreRecovery.folderName)
            .appendingPathComponent(folder)
            .appendingPathComponent(temporary.fileURL.lastPathComponent)
        XCTAssertEqual(try Data(contentsOf: kept), damaged, "the original file is preserved")

        // The fresh store is on disk, where the damaged one was, and it works.
        let learning = opening.store.makeLearningRepository()
        try await learning.saveSession(
            PersistenceFixtures.session(),
            for: PersistenceFixtures.guestScope
        )
        let relaunch = try LocalStoreRecovery.open(
            fileURL: temporary.fileURL,
            now: now,
            logger: RecordingLogger()
        )
        XCTAssertNil(relaunch.recovery, "the next launch opens the fresh store as it is")
        let sessions = try await relaunch.store.makeLearningRepository()
            .sessions(for: PersistenceFixtures.guestScope)
        XCTAssertEqual(sessions.map(\.id), [PersistenceFixtures.sessionID])
        XCTAssertTrue(logger.recorded.contains { $0.level == .error })
    }

    /// An ordinary launch moves nothing and says nothing.
    func testAHealthyStoreOpensWithoutRecovery() throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        _ = try temporary.open()

        let opening = try LocalStoreRecovery.open(
            fileURL: temporary.fileURL,
            now: now,
            logger: RecordingLogger()
        )

        XCTAssertNil(opening.recovery)
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: temporary.directory
                    .appendingPathComponent(LocalStoreRecovery.folderName).path
            )
        )
    }

    /// Two failures on the same second do not overwrite each other's kept
    /// copy.
    func testASecondRecoveryKeepsTheFirstCopy() throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let first = Data(String(repeating: "first damaged store. ", count: 256).utf8)
        let second = Data(String(repeating: "second damaged store. ", count: 256).utf8)

        try first.write(to: temporary.fileURL)
        let one = try XCTUnwrap(
            try LocalStoreRecovery.open(fileURL: temporary.fileURL, now: now, logger: NoOpLogger())
                .recovery?.preservedFolder
        )
        for url in LocalStore.fileURLs(for: temporary.fileURL) {
            try? FileManager.default.removeItem(at: url)
        }
        try second.write(to: temporary.fileURL)
        let two = try XCTUnwrap(
            try LocalStoreRecovery.open(fileURL: temporary.fileURL, now: now, logger: NoOpLogger())
                .recovery?.preservedFolder
        )

        XCTAssertNotEqual(one, two)
        let root = temporary.directory.appendingPathComponent(LocalStoreRecovery.folderName)
        let name = temporary.fileURL.lastPathComponent
        XCTAssertEqual(
            try Data(contentsOf: root.appendingPathComponent(one).appendingPathComponent(name)),
            first
        )
        XCTAssertEqual(
            try Data(contentsOf: root.appendingPathComponent(two).appendingPathComponent(name)),
            second
        )
    }

    /// When a fresh store will not open either (a full disk), the launch runs
    /// on a store in memory and says that nothing is being saved. The file it
    /// moved is still kept.
    func testAStoreThatNeverOpensRunsInMemoryAndKeepsTheFile() throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let damaged = Data(String(repeating: "still not a database. ", count: 256).utf8)
        try damaged.write(to: temporary.fileURL)

        let opening = try LocalStoreRecovery.open(
            files: LocalStore.fileURLs(for: temporary.fileURL),
            now: now,
            fileManager: .default,
            logger: NoOpLogger(),
            opening: { throw PersistenceError.storeUnavailable("disk full") }
        )

        let notice = try XCTUnwrap(opening.recovery)
        XCTAssertEqual(notice.outcome, .notSaving)
        let folder = try XCTUnwrap(notice.preservedFolder)
        let kept = temporary.directory
            .appendingPathComponent(LocalStoreRecovery.folderName)
            .appendingPathComponent(folder)
            .appendingPathComponent(temporary.fileURL.lastPathComponent)
        XCTAssertEqual(try Data(contentsOf: kept), damaged)
    }

    /// No file to set aside: nothing is moved, and the launch runs in memory.
    func testAMissingFileIsNotInventedAndRunsInMemory() throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }

        let opening = try LocalStoreRecovery.open(
            files: LocalStore.fileURLs(for: temporary.fileURL),
            now: now,
            fileManager: .default,
            logger: NoOpLogger(),
            opening: { throw PersistenceError.storeUnavailable("cannot create") }
        )

        XCTAssertEqual(opening.recovery?.outcome, .notSaving)
        XCTAssertNil(opening.recovery?.preservedFolder)
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: temporary.directory
                    .appendingPathComponent(LocalStoreRecovery.folderName).path
            )
        )
    }

    /// The notice outlives the launch until it is read.
    func testTheNoticeIsKeptUntilCleared() throws {
        let suite = "store-recovery-tests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let notices = UserDefaultsStoreRecoveryNoticeStore(defaults: defaults)
        let notice = StoreRecoveryNotice(
            outcome: .startedFresh,
            preservedFolder: "CountryFlags-mock-20260928T101500Z",
            occurredAt: now
        )

        XCTAssertNil(notices.pendingNotice())
        notices.store(notice)
        XCTAssertEqual(UserDefaultsStoreRecoveryNoticeStore(defaults: defaults).pendingNotice(), notice)
        notices.clearNotice()
        XCTAssertNil(notices.pendingNotice())
    }
}
