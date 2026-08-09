import Foundation

import CountryFlagsDomain

/// Supplies the account scope of a device that has not signed in.
///
/// The installation identifier lives next to the session secrets rather than in
/// `UserDefaults`: it is the only thing tying a guest to the progress they made,
/// and the keychain is what survives an app reinstall. Sign-in replaces the
/// scope with an authenticated one; that work package owns the migration.
public actor GuestScopeProvider: AccountScopeResolving {
    private let tokens: any SecureTokenStoring
    private let identifiers: any IdentifierProviding
    private let logger: any AppLogging
    /// The identity this process settled on.
    ///
    /// A keychain that cannot be written would otherwise mint a new guest on
    /// every call, and the parts of the app would act as different people
    /// within one launch: the study screen would write under one scope while
    /// sync read an empty queue under another. Losing the identity across
    /// launches is bad; losing it between two calls is incoherent.
    private var resolved: AccountScope?

    public init(
        tokens: any SecureTokenStoring,
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        logger: any AppLogging = OSLogAppLogger()
    ) {
        self.tokens = tokens
        self.identifiers = identifiers
        self.logger = logger
    }

    /// The stored scope, or a new one on first launch.
    ///
    /// A keychain that cannot be written — a device not unlocked since boot,
    /// for instance — still yields a usable scope, but the guest data written
    /// under it will not be found again. That is logged rather than hidden: it
    /// is a real, if rare, loss and support needs to be able to see it.
    public func currentScope() async -> AccountScope {
        if let resolved { return resolved }

        if let stored = try? await tokens.value(for: .installationID),
            let identifier = UUID(uuidString: stored)
        {
            let scope = AccountScope.guest(installationID: identifier)
            resolved = scope
            return scope
        }

        let identifier = identifiers.next()
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
        let scope = AccountScope.guest(installationID: identifier)
        resolved = scope
        return scope
    }
}
