import Foundation
import Observation

import CountryFlagsDomain

/// What the account section reads and drives.
///
/// The rules live below — the coordinator owns the session, the migration
/// coordinator owns the import — and this object owns the order the screen
/// cares about: a successful sign-in is followed by the guest import, and a
/// sign-out with unsent answers is put to the user before it is put to the
/// backend.
@MainActor
@Observable
public final class AccountStore {
    public private(set) var state: AuthenticationState = .guest
    /// How the last import attempt ended, for the line under the account.
    public private(set) var migration: GuestMigrationOutcome?
    /// The last sign-in failure worth wording. Cancellation never lands here.
    public private(set) var lastFailure: SignInFailure?
    /// Set while a sign-out waits for the user to confirm losing nothing.
    public private(set) var signOutAssessment: SignOutAssessment?

    /// Whether the debug fake sign-in is offered. Wired from the composition:
    /// debug environments only, and only when the launch asked for it.
    public let allowsFakeSignIn: Bool

    private let session: any SessionControlling
    private let migrations: any GuestMigrationRunning
    private let outbox: any OutboxRepository
    private let scopes: any AccountScopeResolving
    private let nonces: any NonceGenerating
    private var pendingNonce: SignInNonce?

    public init(
        session: any SessionControlling,
        migrations: any GuestMigrationRunning,
        outbox: any OutboxRepository,
        scopes: any AccountScopeResolving,
        nonces: any NonceGenerating,
        allowsFakeSignIn: Bool = false
    ) {
        self.session = session
        self.migrations = migrations
        self.outbox = outbox
        self.scopes = scopes
        self.nonces = nonces
        self.allowsFakeSignIn = allowsFakeSignIn
    }

    public func start() async {
        state = await session.currentState()
        // A migration a previous launch left unsettled is finished here, not
        // on the next sign-in: the user already signed in once.
        if case .authenticated(let userID) = state {
            migration = await migrations.importGuestWork(into: userID)
        }
    }

    // MARK: - Signing in

    /// Draws the nonce for the request being built. Held until the provider
    /// answers, because the raw value must accompany the exchange.
    public func prepareNonce() -> SignInNonce {
        let nonce = nonces.makeNonce()
        pendingNonce = nonce
        return nonce
    }

    public var preparedNonce: SignInNonce? { pendingNonce }

    public func signIn(with credential: ProviderCredential) async {
        lastFailure = nil
        pendingNonce = nil
        state = .authenticating(credential.provider)
        let outcome = await session.signIn(with: credential)
        state = await session.currentState()
        switch outcome {
        case .succeeded(let userID):
            migration = await migrations.importGuestWork(into: userID)
        case .cancelled:
            break
        case .failed(let failure):
            lastFailure = failure
        }
    }

    /// The person closed the provider's sheet. Nothing failed; the button is
    /// simply available again.
    public func noteCancelledSignIn() {
        pendingNonce = nil
        lastFailure = nil
    }

    public func noteProviderFailure(_ failure: SignInFailure) {
        pendingNonce = nil
        lastFailure = failure
    }

    // MARK: - Signing out

    /// Counts what has not reached the backend and puts the number to the
    /// user. The sign-out happens only in `confirmSignOut`.
    public func requestSignOut() async {
        let scope = await scopes.currentScope()
        let pending = (try? await outbox.pendingOperations(for: scope)) ?? []
        signOutAssessment = SignOutAssessment(unsyncedCount: pending.count)
    }

    public func cancelSignOut() {
        signOutAssessment = nil
    }

    public func confirmSignOut(everywhere: Bool) async {
        signOutAssessment = nil
        await session.signOut(everywhere: everywhere)
        state = await session.currentState()
        migration = nil
    }
}
