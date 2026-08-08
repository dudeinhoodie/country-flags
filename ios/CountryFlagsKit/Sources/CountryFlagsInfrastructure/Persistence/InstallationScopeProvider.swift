import Foundation

import CountryFlagsDomain

/// The account scope of a device that has not signed in.
///
/// The installation identifier is kept next to the session secrets rather than
/// in `UserDefaults`: it is what ties a guest to the progress they made, and a
/// new one every launch would orphan the previous scope and hand the feature
/// flag cache a different key each time.
public struct InstallationScopeProvider: Sendable {
    private let tokens: any SecureTokenStoring
    private let identifiers: any IdentifierProviding

    public init(
        tokens: any SecureTokenStoring,
        identifiers: any IdentifierProviding = SystemIdentifierProvider()
    ) {
        self.tokens = tokens
        self.identifiers = identifiers
    }

    /// The stored guest scope, or a new one on first launch.
    ///
    /// A keychain that cannot be written — a device not unlocked since boot,
    /// say — still yields a usable scope for this run. The caller receives the
    /// scope and whether it was persisted, so a failure is reported rather than
    /// swallowed: data written under a scope that was never stored will not be
    /// found again.
    public func currentGuestScope() async -> (scope: AccountScope, isPersisted: Bool) {
        if let stored = try? await tokens.value(for: .installationID),
            let identifier = UUID(uuidString: stored)
        {
            return (.guest(installationID: identifier), true)
        }

        let identifier = identifiers.next()
        do {
            try await tokens.setValue(identifier.uuidString, for: .installationID)
            return (.guest(installationID: identifier), true)
        } catch {
            return (.guest(installationID: identifier), false)
        }
    }
}
