import Foundation
import Observation

import CountryFlagsDomain

/// Proves the person at the device is still the account holder, and spends the
/// proof on one operation.
///
/// Three operations need this — clearing progress, exporting the account, and
/// deleting it — and they must not each invent their own rules. The rules are:
/// the proof is obtained per operation, it is checked against its own expiry
/// before it is spent, it lives in memory for the length of one attempt, and it
/// is never written anywhere. That is what "fresh" means; a proof kept for the
/// next time would be exactly the replayable credential the contract avoids.
///
/// The operation runs only after the proof exists, so every failure before that
/// point leaves the account untouched.
@MainActor
@Observable
public final class ReauthenticationCoordinator {
    /// Where one attempt stands. The screen renders this and nothing else.
    public enum Phase: Hashable, Sendable {
        case idle
        /// Waiting for the provider to hand back a credential.
        case provingIdentity
        /// The proof is in hand and the operation is running.
        case working
        case done
        case failed(Failure)
    }

    public enum Failure: Hashable, Sendable {
        /// The provider or the backend would not confirm who this is. Nothing
        /// was asked of the operation, so nothing can have happened.
        case identity
        /// Identity was proven and the operation itself did not go through.
        case operation
    }

    public private(set) var phase: Phase = .idle

    /// Present when the build carries Google credentials, so the sheet can
    /// offer the same two ways in as signing in does.
    public let google: (any GoogleSignInPresenting)?
    /// Whether a fixture credential may stand in for a provider sheet. Debug
    /// environments only, and only when the launch asked: a proof one tap away
    /// in production would defeat the point of asking for one.
    public let allowsFixtureProof: Bool

    private let auth: any AuthenticationService
    private let nonces: any NonceGenerating
    private let dates: any DateProviding
    private let logger: any AppLogging
    private var pendingNonce: SignInNonce?
    private var pendingOperation: (@Sendable (ReauthenticationProof) async throws -> Void)?

    public init(
        auth: any AuthenticationService,
        nonces: any NonceGenerating,
        google: (any GoogleSignInPresenting)? = nil,
        allowsFixtureProof: Bool = false,
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpLogger()
    ) {
        self.auth = auth
        self.nonces = nonces
        self.google = google
        self.allowsFixtureProof = allowsFixtureProof
        self.dates = dates
        self.logger = logger
    }

    /// Asks for the proof an operation needs. The operation is held, not run:
    /// it happens once a provider has answered.
    public func request(
        _ operation: @escaping @Sendable (ReauthenticationProof) async throws -> Void
    ) {
        pendingOperation = operation
        phase = .provingIdentity
    }

    /// Drawn for the request being built, and held until the provider answers.
    public func prepareNonce() -> SignInNonce {
        let nonce = nonces.makeNonce()
        pendingNonce = nonce
        return nonce
    }

    public var preparedNonce: SignInNonce? { pendingNonce }

    /// The credential the provider handed back, turned into a proof and spent
    /// at once on the operation it was drawn for.
    public func prove(with credential: ProviderCredential) async {
        guard phase == .provingIdentity, let operation = pendingOperation else { return }
        pendingNonce = nil
        phase = .working

        let proof: ReauthenticationProof
        do {
            proof = try await auth.reauthenticate(with: credential)
        } catch {
            logger.log(.error, .auth, "A reauthentication for a sensitive operation failed")
            finish(.failed(.identity))
            return
        }
        // The backend enforces the window; the device checks it too, so an
        // expired proof is not spent on a request that cannot succeed.
        guard proof.isValid(at: dates.now()) else {
            finish(.failed(.identity))
            return
        }

        do {
            try await operation(proof)
        } catch {
            logger.log(.error, .auth, "A sensitive operation was refused after a fresh proof")
            finish(.failed(.operation))
            return
        }
        finish(.done)
    }

    /// The provider sheet was dismissed. Nothing failed, and nothing ran.
    public func noteCancelled() {
        pendingNonce = nil
        pendingOperation = nil
        phase = .idle
    }

    public func noteProviderFailure(_ failure: SignInFailure) {
        pendingNonce = nil
        // The kind alone: a failed sign-in must be visible in a log without a
        // credential ever being.
        logger.log(
            .error,
            .auth,
            "A provider refused to prove identity for a sensitive operation",
            ["failure": .safe(String(describing: failure))]
        )
        finish(.failed(.identity))
    }

    /// Clears a finished attempt, so the next one starts from nothing.
    public func reset() {
        pendingNonce = nil
        pendingOperation = nil
        phase = .idle
    }

    private func finish(_ phase: Phase) {
        // The operation is released with the proof it was waiting for: neither
        // outlives the attempt.
        pendingOperation = nil
        self.phase = phase
    }
}
