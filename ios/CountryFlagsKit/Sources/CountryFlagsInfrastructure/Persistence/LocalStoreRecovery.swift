import Foundation

import CountryFlagsDomain

/// The store a launch runs on, and what it had to do to get one.
public struct LocalStoreOpening: Sendable {
    public let store: LocalStore
    /// Nil for an ordinary launch.
    public let recovery: StoreRecoveryNotice?
}

/// Opens the store, and when it will not open, keeps the app alive (#445).
///
/// A failed migration, a damaged file or a full disk used to end in
/// `fatalError` on every launch. The only way out was a reinstall, and a
/// reinstall erases the guest's progress and the unsent answers, which is
/// what the crash existed to protect. So the unreadable files are moved into a
/// folder beside the store and kept, not deleted, and the launch goes on with a
/// fresh store. The kept copy is there for a later build that can read it, or
/// for a diagnostic report.
///
/// Two cases do not move anything:
///
/// - a store file that cannot even be read is not known to be damaged. A
///   device locked since boot refuses the read, and moving a healthy store
///   aside for that would hide it;
/// - a store file that is not there has nothing to set aside.
///
/// Both, and a fresh store that will not open either, leave the launch running
/// on a store in memory, and the notice says that nothing is being saved.
///
/// What this cannot catch is an Objective-C exception from the container, such
/// as the duplicate version checksums described on `LocalStoreMigrationPlan`.
/// That is a defect in a build, not a state of a device, and the migration
/// tests are where it is caught.
public enum LocalStoreRecovery {
    /// The folder, beside the store, that set-aside stores are kept in.
    public static let folderName = "Recovered stores"

    /// Opens the store the app uses.
    ///
    /// - Throws: only when not even a store in memory can be created, which
    ///   leaves nothing to run on.
    public static func open(
        name: String,
        now: Date,
        fileManager: FileManager = .default,
        logger: any AppLogging
    ) throws -> LocalStoreOpening {
        try open(
            files: LocalStore.fileURLs(forName: name),
            now: now,
            fileManager: fileManager,
            logger: logger,
            opening: { try LocalStore(location: .onDisk(name: name)) }
        )
    }

    /// Opens a store at an explicit file, which is what a test needs.
    public static func open(
        fileURL: URL,
        now: Date,
        fileManager: FileManager = .default,
        logger: any AppLogging
    ) throws -> LocalStoreOpening {
        try open(
            files: LocalStore.fileURLs(for: fileURL),
            now: now,
            fileManager: fileManager,
            logger: logger,
            opening: { try LocalStore(fileURL: fileURL) }
        )
    }

    /// - Parameter files: the store first, then SQLite's companions.
    static func open(
        files: [URL],
        now: Date,
        fileManager: FileManager,
        logger: any AppLogging,
        opening: () throws -> LocalStore
    ) throws -> LocalStoreOpening {
        do {
            return LocalStoreOpening(store: try opening(), recovery: nil)
        } catch {
            logger.log(
                .error,
                .persistence,
                "The local store could not be opened",
                ["error": .safe(describe(error))]
            )
        }

        guard let store = files.first, fileManager.fileExists(atPath: store.path) else {
            logger.log(.error, .persistence, "There is no store file to set aside")
            return try inMemory(preservedFolder: nil, now: now)
        }
        guard isReadable(store) else {
            logger.log(
                .error,
                .persistence,
                "The store file cannot be read, so it was left where it is"
            )
            return try inMemory(preservedFolder: nil, now: now)
        }

        let folder: String
        do {
            folder = try setAside(files, now: now, fileManager: fileManager)
        } catch {
            logger.log(
                .error,
                .persistence,
                "The store could not be set aside",
                ["error": .safe(describe(error))]
            )
            return try inMemory(preservedFolder: nil, now: now)
        }

        do {
            let fresh = try opening()
            logger.log(.notice, .persistence, "A fresh store replaced one that would not open")
            return LocalStoreOpening(
                store: fresh,
                recovery: StoreRecoveryNotice(
                    outcome: .startedFresh,
                    preservedFolder: folder,
                    occurredAt: now
                )
            )
        } catch {
            logger.log(
                .error,
                .persistence,
                "A fresh store could not be opened either",
                ["error": .safe(describe(error))]
            )
            return try inMemory(preservedFolder: folder, now: now)
        }
    }

    private static func inMemory(preservedFolder: String?, now: Date) throws -> LocalStoreOpening {
        LocalStoreOpening(
            store: try LocalStore(location: .inMemory),
            recovery: StoreRecoveryNotice(
                outcome: .notSaving,
                preservedFolder: preservedFolder,
                occurredAt: now
            )
        )
    }

    /// Whether the bytes of the file can be read at all.
    private static func isReadable(_ url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        return (try? handle.read(upToCount: 16)) != nil
    }

    /// Moves the store's files into a folder of their own and returns its
    /// name.
    ///
    /// The store goes last. SQLite replays a write-ahead log it finds beside a
    /// database, and a log left behind next to a fresh store would be replayed
    /// into it. So a move that fails part way stops while the store is still
    /// in place, and the launch does not open a fresh one over it.
    private static func setAside(
        _ files: [URL],
        now: Date,
        fileManager: FileManager
    ) throws -> String {
        guard let store = files.first else { throw CocoaError(.fileNoSuchFile) }
        let root = store.deletingLastPathComponent()
            .appendingPathComponent(folderName, isDirectory: true)
        let base = "\(store.deletingPathExtension().lastPathComponent)-\(stamp(now))"
        var name = base
        var attempt = 1
        while fileManager.fileExists(atPath: root.appendingPathComponent(name).path) {
            attempt += 1
            name = "\(base)-\(attempt)"
        }
        let folder = root.appendingPathComponent(name, isDirectory: true)
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        for file in files.dropFirst() + [store] where fileManager.fileExists(atPath: file.path) {
            try fileManager.moveItem(
                at: file,
                to: folder.appendingPathComponent(file.lastPathComponent)
            )
        }
        return name
    }

    /// A timestamp without separators a file browser would trip over.
    private static func stamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withYear, .withMonth, .withDay, .withTime, .withTimeZone]
        return formatter.string(from: date)
    }

    /// The error for the log, trimmed. A store error arrives as a string
    /// already; anything else is reduced to its domain and number.
    private static func describe(_ error: any Error) -> String {
        if case PersistenceError.storeUnavailable(let reason) = error {
            return String(reason.prefix(200))
        }
        let nsError = error as NSError
        return "\(nsError.domain):\(nsError.code)"
    }
}

/// Keeps the recovery notice in the device's defaults, beside the store rather
/// than in it: the store is what failed.
public struct UserDefaultsStoreRecoveryNoticeStore: StoreRecoveryNoticing, @unchecked Sendable {
    private static let key = "store.recovery.notice"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func pendingNotice() -> StoreRecoveryNotice? {
        guard let data = defaults.data(forKey: Self.key) else { return nil }
        return try? JSONDecoder().decode(StoreRecoveryNotice.self, from: data)
    }

    public func store(_ notice: StoreRecoveryNotice) {
        guard let data = try? JSONEncoder().encode(notice) else { return }
        defaults.set(data, forKey: Self.key)
    }

    public func clearNotice() {
        defaults.removeObject(forKey: Self.key)
    }
}
