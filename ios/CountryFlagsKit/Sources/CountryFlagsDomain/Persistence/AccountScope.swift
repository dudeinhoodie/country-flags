import Foundation

/// Who owns a stored record.
///
/// Every user-owned record carries a scope. A guest keeps learning on the
/// device before any account exists, and two accounts can be used on one
/// device, so "the current user" is not enough to separate them: signing out
/// and signing in as somebody else must never surface the previous person's
/// progress.
public enum AccountScope: Hashable, Sendable {
    /// Progress made before signing in, tied to this installation.
    case guest(installationID: UUID)
    case authenticated(userID: UUID)

    /// The stored discriminator.
    ///
    /// A single string keeps the predicate on a SwiftData query trivial and
    /// makes an unscoped record impossible to write by accident: the property
    /// is not optional anywhere.
    public var key: String {
        switch self {
        case .guest(let installationID):
            return "guest:\(installationID.uuidString.lowercased())"
        case .authenticated(let userID):
            return "user:\(userID.uuidString.lowercased())"
        }
    }

    public var isGuest: Bool {
        if case .guest = self { return true }
        return false
    }

    public init?(key: String) {
        let parts = key.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2, let identifier = UUID(uuidString: parts[1]) else {
            return nil
        }
        switch parts[0] {
        case "guest": self = .guest(installationID: identifier)
        case "user": self = .authenticated(userID: identifier)
        default: return nil
        }
    }
}
