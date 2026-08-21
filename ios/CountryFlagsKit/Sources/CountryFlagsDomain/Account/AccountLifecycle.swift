import Foundation

/// One way into the account.
///
/// An identity is not a credential: it says which provider a sign-in went
/// through and when it was last used, and holding one authorises nothing. The
/// provider's own subject identifier is deliberately absent — the screen has no
/// use for it and it is one more thing that could be logged.
public struct AccountIdentityRecord: Hashable, Sendable, Identifiable {
    public let id: UUID
    public let provider: AuthProvider
    public let createdAt: Date
    public let lastLoginAt: Date

    public init(id: UUID, provider: AuthProvider, createdAt: Date, lastLoginAt: Date) {
        self.id = id
        self.provider = provider
        self.createdAt = createdAt
        self.lastLoginAt = lastLoginAt
    }
}

/// A device the account has signed in on.
///
/// `isCurrent` is the backend's answer rather than a comparison this client
/// makes: the device identifier it registered under is the backend's to match,
/// and a client that guessed would offer to revoke the wrong phone.
public struct AccountDeviceRecord: Hashable, Sendable, Identifiable {
    public let id: UUID
    public let platform: String
    public let appVersion: String
    public let locale: String
    public let timezone: String
    public let lastSeenAt: Date
    public let isCurrent: Bool

    public init(
        id: UUID,
        platform: String,
        appVersion: String,
        locale: String,
        timezone: String,
        lastSeenAt: Date,
        isCurrent: Bool
    ) {
        self.id = id
        self.platform = platform
        self.appVersion = appVersion
        self.locale = locale
        self.timezone = timezone
        self.lastSeenAt = lastSeenAt
        self.isCurrent = isCurrent
    }
}

/// Why linking or unlinking a provider was refused.
///
/// The distinction that matters is the first case: the identity belongs to
/// somebody else's account, and the only safe answer is to sign in as that
/// account. Merging two accounts is not in this product, and merging by email
/// is forbidden outright.
public enum IdentityChangeFailure: Hashable, Sendable {
    /// `IDENTITY_ALREADY_LINKED`: this Apple or Google login already belongs to
    /// another Country Flags account.
    case belongsToAnotherAccount
    /// `PROVIDER_ALREADY_LINKED`: this account already has an identity from
    /// that provider.
    case providerAlreadyLinked
    /// `LAST_IDENTITY_CANNOT_BE_REMOVED`: an account with no way back in is an
    /// account nobody can reach.
    case lastIdentity
    case offline
    /// Anything else the backend refused, carried by code rather than by its
    /// message: a server sentence is not a thing to put in front of a user.
    case refused(code: String)
}

/// Where a data export stands.
///
/// The raw values are the contract's. `expired` is a status rather than an
/// error: an export has a deliberately short life, and a link that has run out
/// is a normal thing to have to ask for again.
public enum DataExportStatus: String, Hashable, Sendable, CaseIterable {
    case pending = "PENDING"
    case processing = "PROCESSING"
    case ready = "READY"
    case expired = "EXPIRED"
    case failed = "FAILED"

    /// Whether asking again would change the answer.
    public var isSettled: Bool {
        switch self {
        case .pending, .processing: false
        case .ready, .expired, .failed: true
        }
    }
}

/// One export request, as the backend describes it.
///
/// The download URL carries its own proof in a query string and is short-lived,
/// so it is treated as a secret: never logged, never persisted, and never
/// handed to a browser this app does not control.
public struct DataExportRecord: Hashable, Sendable {
    public let id: UUID
    public let status: DataExportStatus
    public let downloadURL: URL?
    public let sha256: String?
    public let expiresAt: Date?
    public let createdAt: Date
    public let completedAt: Date?

    public init(
        id: UUID,
        status: DataExportStatus,
        downloadURL: URL?,
        sha256: String?,
        expiresAt: Date?,
        createdAt: Date,
        completedAt: Date?
    ) {
        self.id = id
        self.status = status
        self.downloadURL = downloadURL
        self.sha256 = sha256
        self.expiresAt = expiresAt
        self.createdAt = createdAt
        self.completedAt = completedAt
    }

    /// Whether the archive can be fetched right now.
    public func isDownloadable(at instant: Date) -> Bool {
        guard status == .ready, downloadURL != nil else { return false }
        guard let expiresAt else { return true }
        return instant < expiresAt
    }
}

/// What the backend answered when the account was asked to be deleted.
///
/// Deletion is not instant: the contract answers with the date it is expected
/// to complete by, and the app says so rather than claiming the account is
/// already gone.
public struct AccountDeletionRecord: Hashable, Sendable {
    public let requestedAt: Date
    public let expectedCompletionAt: Date

    public init(requestedAt: Date, expectedCompletionAt: Date) {
        self.requestedAt = requestedAt
        self.expectedCompletionAt = expectedCompletionAt
    }
}

/// The account's own surface: who can sign into it, and from where.
///
/// Linking takes a provider credential and creates no session — the account is
/// already signed in — while unlinking names only the provider, because an
/// account holds at most one identity per provider.
///
/// Every method here fails with a `PresentableError`: the transport's own error
/// type stays inside the layer that made the request, and what reaches a screen
/// is a kind it may show plus the registered code it may act on.
public protocol AccountDirectory: Sendable {
    func identities() async throws -> [AccountIdentityRecord]
    func link(_ credential: ProviderCredential) async throws -> AccountIdentityRecord
    func unlink(_ provider: AuthProvider) async throws

    func devices() async throws -> [AccountDeviceRecord]
    func revokeDevice(id: UUID) async throws
}

/// Asking for the account's data and fetching it once it is ready.
///
/// The proof is optional because a sign-in a minute old is already a proof:
/// the backend accepts a session that was authenticated inside the same window
/// a minted proof would live for, and only refuses — `REAUTHENTICATION_REQUIRED`
/// — when the sign-in is older than that. Asking first and proving on refusal
/// means nobody is sent through a provider twice in the same minute. Reading a
/// status needs nothing either way: it carries nothing the account holder has
/// not already been shown.
public protocol DataExporting: Sendable {
    func requestExport(provingWith proof: ReauthenticationProof?) async throws -> DataExportRecord
    func exportStatus(id: UUID) async throws -> DataExportRecord
    /// Fetches the archive itself. Separated from the status calls because the
    /// URL is the backend's to hand out and carries its own short-lived proof.
    func downloadArchive(from url: URL) async throws -> Data
}

/// Deleting the whole account, proof in hand.
public protocol AccountDeleting: Sendable {
    func deleteAccount(provingWith proof: ReauthenticationProof) async throws
        -> AccountDeletionRecord
}

/// Remembers that a deletion is under way.
///
/// It has to outlive both the session and the launch: accepting a deletion
/// signs the device out, and a relaunch must still be able to say that the
/// account is going rather than pretend nothing happened. Nothing secret is
/// kept — a date, and nothing that could identify the account.
public protocol AccountDeletionStateStoring: Sendable {
    func pendingDeletion() -> AccountDeletionRecord?
    func store(pendingDeletion: AccountDeletionRecord?)
}
