import Foundation

import CountryFlagsDomain

/// Supplies the account scope of a device that has not signed in.
///
/// The installation identifier lives next to the session secrets rather than in
/// `UserDefaults`: it is the only thing tying a guest to the progress they made,
/// and the keychain is what survives an app reinstall. Sign-in replaces the
/// scope with an authenticated one; that work package owns the migration.
public actor GuestScopeProvider: AccountScopeResolving, GuestIdentityRotating {
    private let tokens: any SecureTokenStoring
    private let identifiers: any IdentifierProviding
    private let logger: any AppLogging
    /// Asked who the guest was when the keychain cannot say. Nil adopts
    /// nothing and always mints.
    private let guestScopes: (any GuestScopeDiscovering)?
    /// The identity this process settled on.
    ///
    /// A keychain that cannot be written would otherwise mint a new guest on
    /// every call, and the parts of the app would act as different people
    /// within one launch: the study screen would write under one scope while
    /// sync read an empty queue under another. Losing the identity across
    /// launches is bad; losing it between two calls is incoherent.
    private var resolved: AccountScope?
    /// The first resolution while it is in flight. The actor lets a second
    /// caller in at every suspension, and resolving suspends several times.
    /// Two callers resolving in parallel on an empty keychain would each mint
    /// their own guest, and the app would act as two people in one launch.
    private var resolving: Task<AccountScope, Never>?

    public init(
        tokens: any SecureTokenStoring,
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        logger: any AppLogging = OSLogAppLogger(),
        guestScopes: (any GuestScopeDiscovering)? = nil
    ) {
        self.tokens = tokens
        self.identifiers = identifiers
        self.logger = logger
        self.guestScopes = guestScopes
    }

    /// The stored scope, the store's own guest when the keychain lost it, or
    /// a new one on first launch.
    ///
    /// A keychain that cannot be written — a device not unlocked since boot,
    /// for instance — still yields a usable scope, but the guest data written
    /// under it will not be found again. That is logged rather than hidden: it
    /// is a real, if rare, loss and support needs to be able to see it.
    public func currentScope() async -> AccountScope {
        if let resolved { return resolved }
        if let resolving { return await resolving.value }
        let task = Task { await self.resolve() }
        resolving = task
        let scope = await task.value
        resolved = scope
        resolving = nil
        return scope
    }

    private func resolve() async -> AccountScope {
        if let stored = try? await tokens.value(for: .installationID),
            let identifier = UUID(uuidString: stored)
        {
            return .guest(installationID: identifier)
        }

        let identifier = await adoptableGuest() ?? identifiers.next()
        do {
            try await tokens.setValue(identifier.uuidString, for: .installationID)
        } catch {
            logger.log(
                .error,
                .persistence,
                "The installation identifier could not be stored",
                ["code": .safe(String(describing: error))]
            )
        }
        return .guest(installationID: identifier)
    }

    /// The guest the store already belongs to, when there is exactly one.
    ///
    /// With no identifier in the keychain, a store holding one guest's work
    /// is that guest's store. It came across in a backup that the identifier
    /// did not, or it outlived a keychain that was reset. Minting a new guest
    /// beside it hid all of their progress.
    ///
    /// Two or more guests are left as they are: nothing says which of them is
    /// this person, and merging them could not be undone. A new guest starts,
    /// and every earlier scope stays in the store untouched.
    private func adoptableGuest() async -> UUID? {
        guard let guestScopes else { return nil }
        let found: Set<AccountScope>
        do {
            found = try await guestScopes.guestScopesWithWork()
        } catch {
            logger.log(
                .error,
                .persistence,
                "The store could not be asked which guest it belongs to",
                ["code": .safe(String(describing: error))]
            )
            return nil
        }
        let installations = found.compactMap { scope -> UUID? in
            guard case .guest(let installationID) = scope else { return nil }
            return installationID
        }
        guard installations.count == 1, let adopted = installations.first else {
            if installations.count > 1 {
                logger.log(
                    .notice,
                    .persistence,
                    "Several guests own work in the store; none was adopted",
                    ["count": .count(installations.count)]
                )
            }
            return nil
        }
        logger.log(.notice, .persistence, "The store's guest was adopted")
        return adopted
    }

    /// A new installation identifier, written where the old one was.
    ///
    /// The new guest is this process's answer even if the keychain refuses
    /// it, for the reason `resolved` exists; the refusal is logged, because
    /// the next launch would then come back as the guest the deletion left.
    public func startNewGuest() async -> AccountScope {
        let previous = await currentScope()
        let identifier = identifiers.next()
        do {
            try await tokens.setValue(identifier.uuidString, for: .installationID)
        } catch {
            logger.log(
                .error,
                .persistence,
                "The new installation identifier could not be stored",
                ["code": .safe(String(describing: error))]
            )
        }
        resolved = .guest(installationID: identifier)
        return previous
    }
}
