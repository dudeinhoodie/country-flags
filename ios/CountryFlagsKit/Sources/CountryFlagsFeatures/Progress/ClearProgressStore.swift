import Foundation
import Observation

import CountryFlagsDomain

/// Erasing a learner's history, in the order that makes it safe.
///
/// Three things have to happen and the order is the whole design: the
/// consequences are said out loud, the person proves they are still the
/// account holder, and only then is anything deleted — on the server first,
/// on the device after it agreed. A device that wiped itself first would turn
/// a dropped connection into lost work with nothing to restore it from.
///
/// The proof itself is the coordinator's business: it is obtained per attempt,
/// spent at once and never written down, which is the same rule the export and
/// the account deletion follow.
@MainActor
@Observable
public final class ClearProgressStore {
    /// Where the flow stands. The screen renders one of these and nothing else.
    public enum Phase: Hashable, Sendable {
        case idle
        /// The consequences are on screen, waiting to be accepted or dismissed.
        case confirming
        /// Waiting for the provider to hand back a credential.
        case provingIdentity
        case clearing
        case cleared
        case failed(Failure)
    }

    /// Why nothing was deleted. Both cases mean the same thing to the learner
    /// — their progress is untouched — and different things to what they
    /// should do next.
    public enum Failure: Hashable, Sendable {
        /// The provider or the backend would not confirm who this is.
        case identity
        /// Identity was proven, but the deletion itself did not go through.
        case deletion
    }

    /// Whether the entry point is shown at all. A guest has no account-side
    /// progress to delete and no identity to prove; offering the row would be
    /// offering a button that cannot work.
    public private(set) var isOffered = false
    /// Set while the consequences are on screen. Everything after it is the
    /// coordinator's phase, which is why this is the only step held here.
    private var isConfirming = false

    public var phase: Phase {
        if isConfirming { return .confirming }
        switch reauthentication.phase {
        case .idle: return .idle
        case .provingIdentity: return .provingIdentity
        case .working: return .clearing
        case .done: return .cleared
        case .failed(.identity): return .failed(.identity)
        case .failed(.operation): return .failed(.deletion)
        }
    }

    /// Present when the build carries Google credentials.
    public var google: (any GoogleSignInPresenting)? { reauthentication.google }
    public var allowsFixtureProof: Bool { reauthentication.allowsFixtureProof }
    /// Called once the deletion landed and the device was cleared, so the
    /// composition can put the screens that read the store back in step.
    public var onCleared: (@Sendable () async -> Void)?

    private let reauthentication: ReauthenticationCoordinator
    private let clearing: any ProgressClearing
    private let learning: any LearningRepository
    private let outbox: any OutboxRepository
    private let scopes: any AccountScopeResolving
    private let logger: any AppLogging

    public init(
        reauthentication: ReauthenticationCoordinator,
        clearing: any ProgressClearing,
        learning: any LearningRepository,
        outbox: any OutboxRepository,
        scopes: any AccountScopeResolving,
        logger: any AppLogging = NoOpLogger()
    ) {
        self.reauthentication = reauthentication
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
        reauthentication.reset()
        isConfirming = true
    }

    /// Accepting the consequences asks for the proof, not for the deletion: a
    /// confirmation is a statement of intent, and the contract asks for
    /// evidence of identity on top of it.
    public func confirm() {
        guard isConfirming else { return }
        isConfirming = false
        reauthentication.request { [weak self] proof in
            guard let self else { return }
            _ = try await self.clearing.clearProgress(provingWith: proof)
            await self.eraseLocalProgress()
            await self.onCleared?()
        }
    }

    public func cancel() {
        isConfirming = false
        reauthentication.noteCancelled()
    }

    /// Drawn for the request being built, and held until the provider answers.
    public func prepareNonce() -> SignInNonce { reauthentication.prepareNonce() }

    public var preparedNonce: SignInNonce? { reauthentication.preparedNonce }

    public func prove(with credential: ProviderCredential) async {
        await reauthentication.prove(with: credential)
    }

    /// The provider sheet was dismissed. Nothing failed; the confirmation
    /// simply goes away.
    public func noteCancelledProof() {
        isConfirming = false
        reauthentication.noteCancelled()
    }

    public func noteProviderFailure(_ failure: SignInFailure) {
        isConfirming = false
        reauthentication.noteProviderFailure(failure)
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
