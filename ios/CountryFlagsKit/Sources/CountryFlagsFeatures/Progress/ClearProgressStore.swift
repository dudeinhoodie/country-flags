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
/// The proof lives in this object for the length of one attempt and is never
/// written down. That is what "fresh" means: it cannot be reused later, by
/// this app or by anything that reads its storage.
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

    public private(set) var phase: Phase = .idle
    /// Whether the entry point is shown at all. A guest has no account-side
    /// progress to delete and no identity to prove; offering the row would be
    /// offering a button that cannot work.
    public private(set) var isOffered = false

    /// Present when the build carries Google credentials, so the sheet can
    /// offer the same two ways in as signing in does.
    public let google: (any GoogleSignInPresenting)?
    /// Called once the deletion landed and the device was cleared, so the
    /// composition can put the screens that read the store back in step.
    public var onCleared: (@Sendable () async -> Void)?

    private let auth: any AuthenticationService
    private let clearing: any ProgressClearing
    private let learning: any LearningRepository
    private let outbox: any OutboxRepository
    private let scopes: any AccountScopeResolving
    private let nonces: any NonceGenerating
    private let dates: any DateProviding
    private let logger: any AppLogging
    private var pendingNonce: SignInNonce?

    public init(
        auth: any AuthenticationService,
        clearing: any ProgressClearing,
        learning: any LearningRepository,
        outbox: any OutboxRepository,
        scopes: any AccountScopeResolving,
        nonces: any NonceGenerating,
        google: (any GoogleSignInPresenting)? = nil,
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpLogger()
    ) {
        self.auth = auth
        self.clearing = clearing
        self.learning = learning
        self.outbox = outbox
        self.scopes = scopes
        self.nonces = nonces
        self.google = google
        self.dates = dates
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

    /// Accepting the consequences moves to the proof, not to the deletion:
    /// a confirmation is a statement of intent, and the contract asks for
    /// evidence of identity on top of it.
    public func confirm() {
        guard phase == .confirming else { return }
        phase = .provingIdentity
    }

    public func cancel() {
        pendingNonce = nil
        phase = .idle
    }

    /// Drawn for the request being built, and held until the provider answers.
    public func prepareNonce() -> SignInNonce {
        let nonce = nonces.makeNonce()
        pendingNonce = nonce
        return nonce
    }

    public var preparedNonce: SignInNonce? { pendingNonce }

    /// The credential the provider handed back, turned into a proof and spent
    /// immediately on the one operation it was drawn for.
    public func prove(with credential: ProviderCredential) async {
        guard phase == .provingIdentity else { return }
        pendingNonce = nil
        phase = .clearing

        let proof: ReauthenticationProof
        do {
            proof = try await auth.reauthenticate(with: credential)
        } catch {
            // Nothing has been asked of the progress endpoint yet, so nothing
            // can have been deleted.
            logger.log(.error, .auth, "A reauthentication for clearing progress failed")
            phase = .failed(.identity)
            return
        }
        // The backend enforces the window; the device checks it too so an
        // expired proof is not sent as if it might work.
        guard proof.isValid(at: dates.now()) else {
            phase = .failed(.identity)
            return
        }

        do {
            _ = try await clearing.clearProgress(provingWith: proof)
        } catch {
            logger.log(.error, .sync, "The backend refused to clear the progress")
            phase = .failed(.deletion)
            return
        }

        await eraseLocalProgress()
        phase = .cleared
        await onCleared?()
    }

    /// The provider sheet was dismissed. Nothing failed; the confirmation
    /// simply goes away.
    public func noteCancelledProof() {
        pendingNonce = nil
        phase = .idle
    }

    public func noteProviderFailure(_ failure: SignInFailure) {
        pendingNonce = nil
        // The kind alone: a failed sign-in must be visible in a log without a
        // credential ever being.
        logger.log(
            .error,
            .auth,
            "A provider refused to prove identity for clearing progress",
            ["failure": .safe(String(describing: failure))]
        )
        phase = .failed(.identity)
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
