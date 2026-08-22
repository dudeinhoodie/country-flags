import Foundation

/// Where a guest's work stands on its way into an account.
public enum GuestMigrationState: String, Hashable, Sendable, CaseIterable, Codable {
    case notStarted
    /// Submitted; the backend has not finished applying it.
    case inProgress
    case completed
    case failed
}

/// A guest import, identified so it can be repeated safely.
///
/// The identifier is stable across attempts: a network failure mid-import is
/// followed by the same request, and the backend recognises it rather than
/// importing the same work twice. The reviews keep their original UUIDs for the
/// same reason — an import is the same work changing owner, not new work.
public struct GuestMigrationRecord: Hashable, Sendable, Codable {
    public let migrationID: UUID
    /// The guest scope being imported. Kept so the device can prove which
    /// archive it is talking about after a relaunch.
    public let sourceScopeKey: String
    /// The account it is being imported into.
    public let targetUserID: UUID
    public let state: GuestMigrationState
    public let startedAt: Date
    public let acknowledgedAt: Date?

    public init(
        migrationID: UUID,
        sourceScopeKey: String,
        targetUserID: UUID,
        state: GuestMigrationState,
        startedAt: Date,
        acknowledgedAt: Date?
    ) {
        self.migrationID = migrationID
        self.sourceScopeKey = sourceScopeKey
        self.targetUserID = targetUserID
        self.state = state
        self.acknowledgedAt = acknowledgedAt
        self.startedAt = startedAt
    }

    /// Guest data may be cleaned up only once the backend has said it has it.
    /// Deleting on submission would lose the work if the import never landed.
    public var mayArchiveSourceScope: Bool {
        state == .completed && acknowledgedAt != nil
    }

    /// Whether this archive still has somewhere to go.
    ///
    /// An import that stopped halfway is the case worth naming: the work is
    /// on the device, the account it belongs to is written down, and nothing
    /// about the situation resolves itself with time. A refusal is settled —
    /// the same archive cannot get a different answer — and so is an import
    /// the backend acknowledged.
    public var isSettled: Bool {
        mayArchiveSourceScope || state == .failed
    }
}

public enum GuestMigrationRefusal: Error, Equatable, Sendable {
    /// The guest scope on this device belongs to a different account's earlier
    /// session. Importing it would attribute one person's work to another.
    case scopeBelongsToAnotherAccount
    /// There is nothing queued or stored to import.
    case nothingToImport
}

/// Decides whether a guest archive may be imported into an account.
public enum GuestMigrationPolicy {
    /// - Parameters:
    ///   - guestScope: the scope the device studied under.
    ///   - previousOwner: the account this guest scope was already imported
    ///     into, if any.
    ///   - targetUserID: the account signing in now.
    ///
    /// A guest scope that was already imported into one account must never be
    /// imported into another. The device is shared more often than product
    /// discussions assume, and the second person would silently inherit the
    /// first person's progress.
    public static func canImport(
        guestScope: AccountScope,
        previousOwner: UUID?,
        targetUserID: UUID,
        hasWork: Bool
    ) -> Result<Void, GuestMigrationRefusal> {
        guard guestScope.isGuest else {
            return .failure(.scopeBelongsToAnotherAccount)
        }
        if let previousOwner, previousOwner != targetUserID {
            return .failure(.scopeBelongsToAnotherAccount)
        }
        guard hasWork else { return .failure(.nothingToImport) }
        return .success(())
    }
}

/// What signing out must not do quietly.
public struct SignOutAssessment: Hashable, Sendable {
    /// Work that has not reached the backend yet.
    public let unsyncedCount: Int

    public init(unsyncedCount: Int) {
        self.unsyncedCount = unsyncedCount
    }

    /// Whether the user has to be warned before the session ends.
    ///
    /// Signing out with unsent answers would strand them under a scope the
    /// device can no longer authenticate. That is the user's decision to make,
    /// so it is put to them rather than made for them.
    public var requiresWarning: Bool { unsyncedCount > 0 }
}
