import Foundation

/// What a launch did because the store would not open (#445).
///
/// The store is the only home of a guest's progress and of every answer not
/// yet uploaded, so a store that fails to open used to stop the app on every
/// launch. A reinstall was the only way out, and a reinstall erases exactly
/// what the crash was protecting. The launch now sets the file aside, keeps
/// it, and carries on with a fresh one, and this is what it tells the person.
public struct StoreRecoveryNotice: Hashable, Sendable, Codable {
    public enum Outcome: String, Hashable, Sendable, Codable {
        /// The store was moved aside and a fresh one opened in its place.
        case startedFresh
        /// No store could be opened on disk, so this run keeps its work in
        /// memory and loses it when the app closes. Whatever was on disk is
        /// left where it is, or kept in the set-aside folder.
        case notSaving
    }

    public let outcome: Outcome
    /// The folder the unreadable files were moved into, by name. Nil when
    /// nothing was moved. A name rather than a path: the container moves on
    /// an app update, and the folder moves with it.
    public let preservedFolder: String?
    public let occurredAt: Date

    public init(outcome: Outcome, preservedFolder: String?, occurredAt: Date) {
        self.outcome = outcome
        self.preservedFolder = preservedFolder
        self.occurredAt = occurredAt
    }
}

/// Remembers a recovery until somebody has read about it.
///
/// Device bookkeeping kept outside the store, since the store is what failed.
/// A person who closes the app before reading the screen sees it on the next
/// launch, when the fresh store opens without complaint and nothing else would
/// say that their progress went missing.
public protocol StoreRecoveryNoticing: Sendable {
    func pendingNotice() -> StoreRecoveryNotice?
    func store(_ notice: StoreRecoveryNotice)
    func clearNotice()
}
