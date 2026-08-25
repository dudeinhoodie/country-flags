import Foundation
import Observation

import CountryFlagsDomain

/// Erasing a learner's history, in the order that makes it safe.
///
/// Two things happen and the order is the whole design: the consequences are
/// said out loud, and only after they are accepted is anything deleted — on
/// the server first, on the device after it agreed. A device that wiped
/// itself first would turn a dropped connection into lost work with nothing
/// to restore it from.
///
/// The signed-in session is the proof. This used to demand a fresh provider
/// credential on top, which dead-ended the flow on devices where the
/// provider sheet could not finish — and progress, unlike the account, is
/// recoverable by studying again, so the session plus an explicit
/// confirmation is a defensible gate.
@MainActor
@Observable
public final class ClearProgressStore {
    /// Where the flow stands. The screen renders one of these and nothing else.
    public enum Phase: Hashable, Sendable {
        case idle
        /// The consequences are on screen, waiting to be accepted or dismissed.
        case confirming
        case clearing
        case cleared
        case failed
    }

    /// Whether the entry point is shown at all. A guest has no account-side
    /// progress to delete; offering the row would be offering a button that
    /// cannot work.
    public private(set) var isOffered = false
    public private(set) var phase: Phase = .idle

    /// Called once the deletion landed and the device was cleared, so the
    /// composition can put the screens that read the store back in step.
    public var onCleared: (@Sendable () async -> Void)?

    private let clearing: any ProgressClearing
    private let learning: any LearningRepository
    private let outbox: any OutboxRepository
    private let scopes: any AccountScopeResolving
    private let logger: any AppLogging

    public init(
        clearing: any ProgressClearing,
        learning: any LearningRepository,
        outbox: any OutboxRepository,
        scopes: any AccountScopeResolving,
        logger: any AppLogging = NoOpLogger()
    ) {
        self.clearing = clearing
        self.learning = learning
        self.outbox = outbox
        self.scopes = scopes
        self.logger = logger
    }

    public func load() async {
        isOffered = await !scopes.currentScope().isGuest
    }

    // MARK: - The flow

    /// Puts the consequences to the learner. Nothing is deleted here.
    public func request() {
        guard isOffered else { return }
        phase = .confirming
    }

    /// The consequences were accepted; the deletion runs now, server first.
    public func confirm() async {
        guard phase == .confirming else { return }
        phase = .clearing
        do {
            _ = try await clearing.clearProgress()
        } catch {
            logger.log(.error, .sync, "The backend refused to clear progress")
            phase = .failed
            return
        }
        await eraseLocalProgress()
        phase = .cleared
        await onCleared?()
    }

    public func cancel() {
        if phase == .confirming { phase = .idle }
    }

    /// Only ever reached after the backend accepted the deletion.
    ///
    /// The queue goes with the history: an unsent review belongs to a session
    /// the account no longer has, and the cursor points into a stream the
    /// deletion rotated.
    private func eraseLocalProgress() async {
        let scope = await scopes.currentScope()
        do {
            try await learning.deleteAllProgress(for: scope)
            try await outbox.discardQueuedWork(for: scope)
        } catch {
            // The account's copy is gone either way; a device that could not
            // finish clearing itself resynchronizes into the same emptiness on
            // the next run, so this is reported rather than surfaced as a
            // failure to delete.
            logger.log(.error, .persistence, "The device could not finish clearing its progress")
        }
    }
}
