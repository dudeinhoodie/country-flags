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
    /// The signed-in person as the screen shows them.
    public private(set) var profile: AccountProfile?
    /// How the last import attempt ended, for the line under the account.
    public private(set) var migration: GuestMigrationOutcome?
    /// The last sign-in failure worth wording. Cancellation never lands here.
    public private(set) var lastFailure: SignInFailure?
    /// Set while a sign-out waits for the user to confirm losing nothing.
    public private(set) var signOutAssessment: SignOutAssessment?
    /// The deletion this device asked for, if it did. It is shown here rather
    /// than only on the account screen because an accepted deletion signs the
    /// device out, and a signed-out person cannot reach that screen at all.
    public private(set) var pendingDeletion: AccountDeletionRecord?

    /// Whether the debug fake sign-in is offered. Wired from the composition:
    /// debug environments only, and only when the launch asked for it.
    public let allowsFakeSignIn: Bool
    /// Called after a sign-in succeeds and the guest migration has settled —
    /// in that order, so the sync it starts uploads the imported work rather
    /// than racing it. The composition points this at the sync coordinator.
    public var onSignedIn: (@Sendable () async -> Void)?

    /// Present when the build carries Google credentials; the button follows.
    public let google: (any GoogleSignInPresenting)?

    private let session: any SessionControlling
    private let migrations: any GuestMigrationRunning
    private let outbox: any OutboxRepository
    private let scopes: any AccountScopeResolving
    private let nonces: any NonceGenerating
    private let deletionState: (any AccountDeletionStateStoring)?
    private let analytics: (any AnalyticsTracking)?
    private let dates: any DateProviding
    private let logger: any AppLogging
    private var pendingNonce: SignInNonce?

    public init(
        session: any SessionControlling,
        migrations: any GuestMigrationRunning,
        outbox: any OutboxRepository,
        scopes: any AccountScopeResolving,
        nonces: any NonceGenerating,
        deletionState: (any AccountDeletionStateStoring)? = nil,
        google: (any GoogleSignInPresenting)? = nil,
        allowsFakeSignIn: Bool = false,
        analytics: (any AnalyticsTracking)? = nil,
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpLogger()
    ) {
        self.logger = logger
        self.session = session
        self.migrations = migrations
        self.outbox = outbox
        self.scopes = scopes
        self.nonces = nonces
        self.deletionState = deletionState
        self.analytics = analytics
        self.dates = dates
        self.google = google
        self.allowsFakeSignIn = allowsFakeSignIn
    }

    /// Runs the whole Google round trip: the sheet, the exchange, the import.
    public func signInWithGoogle() async {
        guard let google else { return }
        switch await google.signIn() {
        case .credential(let credential, let profile):
            await signIn(with: credential, providerProfile: profile)
        case .cancelled:
            noteCancelledSignIn()
        case .failed(let failure):
            noteProviderFailure(failure)
        }
    }

    public func start() async {
        state = await session.currentState()
        profile = await session.currentProfile()
        pendingDeletion = deletionState?.pendingDeletion()
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

    public func signIn(
        with credential: ProviderCredential,
        providerProfile: AccountProfile? = nil
    ) async {
        lastFailure = nil
        pendingNonce = nil
        state = .authenticating(credential.provider)
        let outcome = await session.signIn(with: credential)
        state = await session.currentState()
        if let providerProfile {
            await session.adoptProviderProfile(
                name: providerProfile.displayName,
                avatarURL: providerProfile.avatarURL
            )
        }
        profile = await session.currentProfile()
        await reportAuthOutcome(credential.provider, outcome)
        switch outcome {
        case .succeeded(let userID):
            // A deletion notice belongs to the account that was deleted. Once
            // somebody has signed in, it is about an account this device has
            // nothing to do with any more.
            deletionState?.store(pendingDeletion: nil)
            pendingDeletion = nil
            migration = await migrations.importGuestWork(into: userID)
            // The sync is what brings the account's history home; without
            // this, a fresh device showed nothing until the next foreground.
            await onSignedIn?()
        case .cancelled:
            break
        case .failed(let failure):
            lastFailure = failure
        }
    }

    /// The provider and how it ended — success, cancelled or failed — and
    /// nothing else. The provider's own subject, the account identifier and the
    /// tokens are all deliberately absent: an analytics backend has no use for
    /// any of them.
    private func reportAuthOutcome(_ provider: AuthProvider, _ outcome: SignInOutcome) async {
        guard let analytics else { return }
        let result: AnalyticsAuthResult =
            switch outcome {
            case .succeeded: .success
            case .cancelled: .cancelled
            case .failed: .failed
            }
        await analytics.track(
            .authCompleted(provider: provider, result: result, at: dates.now())
        )
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
        // The kind alone: a sign-in failure must be visible in a log without
        // a credential ever being.
        logger.log(
            .error,
            .sync,
            "A provider sign-in failed before the exchange",
            ["failure": .safe(String(describing: failure))]
        )
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
        // The trail that was being attributed to whoever just left ends here.
        await analytics?.setIdentity(nil)
        state = await session.currentState()
        profile = nil
        migration = nil
    }
}
