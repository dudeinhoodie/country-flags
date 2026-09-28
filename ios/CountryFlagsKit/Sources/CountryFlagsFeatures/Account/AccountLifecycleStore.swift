import Foundation
import Observation

import CountryFlagsDomain

/// The account's one irreversible act: deleting it.
///
/// This store used to also carry the linked identities, the device roster and
/// the data export; those sections left the screen, and the machinery — the
/// fresh-proof coordinator above all — went with them. What remains is the
/// order an accepted deletion happens in, which is the part that was never
/// negotiable: the server accepts first, then this device's data goes, then
/// the tokens, and only then does anything reassuring appear.
///
/// The signed-in session is the proof. The provider reauthentication this
/// used to demand dead-ended the flow on devices where the provider sheet
/// could not finish, and the deletion itself stays a grace-period request
/// rather than an immediate erasure — which is what makes the session alone
/// an acceptable gate.
@MainActor
@Observable
public final class AccountLifecycleStore {
    /// Where a deletion attempt stands. The screen renders this and nothing
    /// else.
    public enum DeletionPhase: Hashable, Sendable {
        case idle
        case working
        case failed
    }

    /// The deletion the account is going through, if it is. Read from a store
    /// that survives both the session and the launch.
    public private(set) var pendingDeletion: AccountDeletionRecord?
    /// Set while the consequences of deleting are on screen.
    public private(set) var isConfirmingDeletion = false
    public private(set) var deletionPhase: DeletionPhase = .idle
    public private(set) var isLoaded = false

    /// Whether the consequences have been put to the learner, whatever is on
    /// screen now.
    ///
    /// Kept apart from `isConfirmingDeletion` for the reason described on
    /// `ClearProgressStore.isArmed`: SwiftUI writes the dialog's presentation
    /// binding back as the destructive button dismisses it, so the flag that
    /// says "the dialog is up" is already false by the time the accepted
    /// action runs, and a deletion gated on it never started.
    private var isArmedForDeletion = false

    /// Called after the account is signed out by a deletion, so the
    /// composition can send the interface back to its guest self.
    public var onSignedOut: (@Sendable () async -> Void)?

    private let deleting: any AccountDeleting
    private let session: any SessionControlling
    private let scopes: any AccountScopeResolving
    private let cleaner: any AccountScopeCleaner
    private let deletionState: any AccountDeletionStateStoring
    private let guestIdentity: (any GuestIdentityRotating)?
    private let logger: any AppLogging

    /// - Parameter guestIdentity: starts the device over as a new guest once
    ///   the deletion has landed. Nil keeps the guest it had, which is what
    ///   tests that are not about the next sign-in want.
    public init(
        deleting: any AccountDeleting,
        session: any SessionControlling,
        scopes: any AccountScopeResolving,
        cleaner: any AccountScopeCleaner,
        deletionState: any AccountDeletionStateStoring,
        guestIdentity: (any GuestIdentityRotating)? = nil,
        logger: any AppLogging = NoOpLogger()
    ) {
        self.deleting = deleting
        self.session = session
        self.scopes = scopes
        self.cleaner = cleaner
        self.deletionState = deletionState
        self.guestIdentity = guestIdentity
        self.logger = logger
    }

    // MARK: - Reading

    public func load() async {
        // The deletion notice comes from local storage: it has to appear even
        // when the account it belongs to can no longer be read, which is
        // exactly the state an accepted deletion leaves behind.
        pendingDeletion = deletionState.pendingDeletion()
        isLoaded = true
    }

    // MARK: - Deletion

    public func requestDeletion() {
        deletionPhase = .idle
        isArmedForDeletion = true
        isConfirmingDeletion = true
    }

    public func cancelDeletion() {
        isConfirmingDeletion = false
    }

    /// The consequences were accepted; the deletion runs now, server first.
    public func confirmDeletion() async {
        guard isArmedForDeletion else { return }
        isArmedForDeletion = false
        isConfirmingDeletion = false
        deletionPhase = .working
        // Whose data this is, read before the request rather than after it.
        // A request that meets a 401 on its way refreshes the session, and a
        // refused refresh moves the session out of "authenticated", so a scope
        // read afterwards named the guest and the account's data stayed.
        let scope = await scopes.currentScope()
        let deletion: AccountDeletionRecord
        do {
            // A repeat of a deletion whose response was lost is answered by
            // the server with the same result, not with a 401 (#452): what
            // lands here is the server's word either way.
            deletion = try await deleting.deleteAccount()
        } catch {
            logger.log(.error, .auth, "The backend refused an account deletion")
            deletionPhase = .failed
            return
        }
        await adoptAcceptedDeletion(deletion, scope: scope)
        deletionPhase = .idle
    }

    /// The backend has accepted the deletion. What follows is local and must
    /// happen even if nothing else does: the notice is stored so a relaunch
    /// still knows, the account's data on this device goes, and the tokens go
    /// with it. Then the device starts over as a new guest.
    private func adoptAcceptedDeletion(
        _ deletion: AccountDeletionRecord,
        scope: AccountScope
    ) async {
        deletionState.store(pendingDeletion: deletion)
        pendingDeletion = deletion

        do {
            try await cleaner.erase(scope: scope)
        } catch {
            logger.log(.error, .persistence, "The account's local data outlived its deletion")
        }
        await session.signOut(everywhere: false)
        await startNewGuest()
        await onSignedOut?()
    }

    /// Replaces the guest the deleted account was made from (#452).
    ///
    /// That guest's work went into the account, and the migration records
    /// say so for good: a later sign-in would find the guest owned by an
    /// account that no longer exists, refuse to import, and say nothing. A new
    /// guest is nobody's yet. Whatever the old guest still held is erased
    /// with it: the deletion promised a start from nothing, and records under
    /// a scope nothing will ever read again only take up the store.
    private func startNewGuest() async {
        guard let guestIdentity else { return }
        let previous = await guestIdentity.startNewGuest()
        do {
            try await cleaner.erase(scope: previous)
        } catch {
            logger.log(.error, .persistence, "The previous guest's data outlived the deletion")
        }
    }
}
