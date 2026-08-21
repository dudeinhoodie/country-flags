import Foundation
import Observation

import CountryFlagsDomain

/// Everything the account screen shows and drives: the ways in, the devices,
/// the export and the deletion.
///
/// The rules that are not about this screen live below it — the coordinator
/// owns fresh proofs, the session owns tokens, the cleaner owns local data —
/// and what is owned here is the order they happen in. Two of those orders
/// matter enough to state: revoking the device you are holding ends this
/// session locally, and an accepted deletion signs the device out and erases
/// the account's data here before it says anything reassuring.
@MainActor
@Observable
public final class AccountLifecycleStore {
    /// Why a read did not produce a screen. Offline is worth separating: it is
    /// the one a learner can fix by waiting.
    public enum LoadFailure: Hashable, Sendable {
        case offline
        case refused
    }

    public private(set) var identities: [AccountIdentityRecord] = []
    public private(set) var devices: [AccountDeviceRecord] = []
    public private(set) var isLoaded = false
    public private(set) var loadFailure: LoadFailure?
    /// The last refusal from linking or unlinking. It is what the safe-recovery
    /// wording is chosen from, so it carries the reason rather than a flag.
    public private(set) var identityFailure: IdentityChangeFailure?
    /// Set while a provider sheet or a link call is in flight, so the screen
    /// can stop offering the same button twice.
    public private(set) var isChangingIdentities = false

    public private(set) var export: DataExportRecord?
    /// The archive on disk, once it has been fetched. A file rather than bytes
    /// in memory because the only thing to do with it is hand it to the share
    /// sheet, which takes a URL.
    public private(set) var exportArchive: URL?
    /// Whether the proof being asked for belongs to an export rather than to a
    /// deletion: what lets the export section speak for the phase.
    private var isExportAttempt = false
    /// Why the last export attempt failed, when the backend said.
    public private(set) var exportError: PresentableError?
    public private(set) var exportFailure: Bool = false

    /// The deletion the account is going through, if it is. Read from a store
    /// that survives both the session and the launch.
    public private(set) var pendingDeletion: AccountDeletionRecord?
    /// Set while the consequences of deleting are on screen.
    public private(set) var isConfirmingDeletion = false

    /// Present when the build carries Google credentials.
    public var google: (any GoogleSignInPresenting)? { reauthentication.google }
    public var allowsFixtureProof: Bool { reauthentication.allowsFixtureProof }
    public var reauthenticationPhase: ReauthenticationCoordinator.Phase {
        reauthentication.phase
    }
    /// Called after the account is signed out by a deletion or by revoking this
    /// device, so the composition can send the interface back to its guest self.
    public var onSignedOut: (@Sendable () async -> Void)?

    private let directory: any AccountDirectory
    private let exporting: any DataExporting
    private let deleting: any AccountDeleting
    private let reauthentication: ReauthenticationCoordinator
    private let session: any SessionControlling
    private let scopes: any AccountScopeResolving
    private let cleaner: any AccountScopeCleaner
    private let deletionState: any AccountDeletionStateStoring
    private let archives: any ExportArchiveStoring
    private let waiter: any Waiting
    private let dates: any DateProviding
    private let logger: any AppLogging

    /// Long enough that a learner is not left staring at a spinner, bounded so
    /// a backend that never settles the export cannot poll forever.
    private static let exportPollInterval: TimeInterval = 3
    private static let exportPollAttempts = 20

    public init(
        directory: any AccountDirectory,
        exporting: any DataExporting,
        deleting: any AccountDeleting,
        reauthentication: ReauthenticationCoordinator,
        session: any SessionControlling,
        scopes: any AccountScopeResolving,
        cleaner: any AccountScopeCleaner,
        deletionState: any AccountDeletionStateStoring,
        archives: any ExportArchiveStoring = TemporaryExportArchiveStore(),
        waiter: any Waiting = TaskWaiter(),
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpLogger()
    ) {
        self.directory = directory
        self.exporting = exporting
        self.deleting = deleting
        self.reauthentication = reauthentication
        self.session = session
        self.scopes = scopes
        self.cleaner = cleaner
        self.deletionState = deletionState
        self.archives = archives
        self.waiter = waiter
        self.dates = dates
        self.logger = logger
    }

    // MARK: - Reading

    public func load() async {
        // The deletion notice comes first and from local storage: it has to
        // appear even when the account it belongs to can no longer be read,
        // which is exactly the state an accepted deletion leaves behind.
        pendingDeletion = deletionState.pendingDeletion()
        guard await session.currentState().isAuthenticated else {
            identities = []
            devices = []
            isLoaded = true
            return
        }
        await reload()
        isLoaded = true
    }

    private func reload() async {
        do {
            async let identities = directory.identities()
            async let devices = directory.devices()
            self.identities = try await identities.sorted { $0.createdAt < $1.createdAt }
            self.devices = try await devices.sorted { left, right in
                // This device leads, the rest by when they were last seen: the
                // one being held is the one a person is looking for.
                if left.isCurrent != right.isCurrent { return left.isCurrent }
                return left.lastSeenAt > right.lastSeenAt
            }
            loadFailure = nil
        } catch {
            loadFailure = Self.loadFailure(from: error)
        }
    }

    // MARK: - Identities

    /// Adds another way in. The credential the provider just issued is the
    /// evidence; no separate proof is asked for, which is what the contract
    /// says by requiring only the session here.
    public func link(with credential: ProviderCredential) async {
        guard !isChangingIdentities else { return }
        isChangingIdentities = true
        identityFailure = nil
        defer { isChangingIdentities = false }
        do {
            _ = try await directory.link(credential)
            await reload()
        } catch {
            identityFailure = Self.identityFailure(from: error)
        }
    }

    /// Removes one way in. The backend refuses to remove the last one, and the
    /// screen says so rather than pre-empting the rule with its own count:
    /// which identities count is the server's policy, not this client's.
    public func unlink(_ provider: AuthProvider) async {
        guard !isChangingIdentities else { return }
        isChangingIdentities = true
        identityFailure = nil
        defer { isChangingIdentities = false }
        do {
            try await directory.unlink(provider)
            await reload()
        } catch {
            identityFailure = Self.identityFailure(from: error)
        }
    }

    public func dismissIdentityFailure() {
        identityFailure = nil
    }

    /// The safe way out of `IDENTITY_ALREADY_LINKED`: sign out and sign in as
    /// the account that already owns the login. Merging the two accounts is
    /// not offered, and matching them by email is forbidden outright.
    public func signOutToSwitchAccounts() async {
        identityFailure = nil
        await session.signOut(everywhere: false)
        await onSignedOut?()
    }

    // MARK: - Devices

    public func revoke(device: AccountDeviceRecord) async {
        do {
            try await directory.revokeDevice(id: device.id)
        } catch {
            loadFailure = Self.loadFailure(from: error)
            return
        }
        guard device.isCurrent else {
            await reload()
            return
        }
        // The sessions of this device were just revoked, so the tokens in the
        // keychain are already worthless. Clearing them here is what stops the
        // app from spending a launch discovering that one request at a time.
        logger.log(.info, .auth, "This device was revoked and the session ended")
        await session.signOut(everywhere: false)
        identities = []
        devices = []
        await onSignedOut?()
    }

    // MARK: - Export

    /// Asks for the archive, proving identity first, and then follows the
    /// request until the backend settles it.
    public func requestExport() {
        exportFailure = false
        exportError = nil
        exportArchive = nil
        isExportAttempt = true
        reauthentication.request { [weak self] proof in
            guard let self else { return }
            do {
                let requested = try await self.exporting.requestExport(provingWith: proof)
                await self.adopt(requested)
            } catch {
                // The refusal was invisible before this: the coordinator swallows
                // what the operation throws, so a backend that would not start the
                // export closed the proof sheet and left the screen exactly as it
                // was — which reads as a button that does nothing.
                await self.noteExportFailure(error)
                throw error
            }
        }
    }

    /// Whether an export is on its way, counting the proof it is waiting for.
    /// The proof sheet is modal and one sensitive operation runs at a time, so
    /// the phase belongs to whichever attempt is open.
    public var isPreparingExport: Bool {
        guard isExportAttempt else { return false }
        switch reauthenticationPhase {
        case .provingIdentity, .working: return true
        default: return false
        }
    }

    /// Whether the export attempt died at the proof rather than at the export.
    public var didExportProofFail: Bool {
        guard isExportAttempt else { return false }
        if case .failed = reauthenticationPhase { return true }
        return false
    }

    private func noteExportFailure(_ error: Error) {
        exportFailure = true
        // The kind, not the server's words: it turns "could not" into "too
        // many requests" or "no connection", which is the difference between
        // a person waiting and a person filing a bug.
        exportError = error as? PresentableError
        logger.log(
            .error,
            .auth,
            "The account export could not be requested",
            ["kind": .safe(exportError?.kind.rawValue ?? "unknown")]
        )
    }

    /// Walks `PENDING`/`PROCESSING` to a settled state, then fetches the
    /// archive if there is one to fetch.
    ///
    /// Bounded rather than endless: a backend that never settles the export
    /// leaves the screen saying it is still being prepared, which is true,
    /// instead of polling until the app is closed.
    public func followExport() async {
        guard var current = export else { return }
        var attempts = 0
        while !current.status.isSettled, attempts < Self.exportPollAttempts {
            await waiter.wait(seconds: Self.exportPollInterval)
            if Task.isCancelled { return }
            do {
                current = try await exporting.exportStatus(id: current.id)
            } catch {
                exportFailure = true
                return
            }
            export = current
            attempts += 1
        }
        guard current.status == .ready else {
            // Expired and failed are both settled and both mean there is
            // nothing to hand over; the screen offers to ask again.
            exportFailure = current.status != .ready
            return
        }
        await downloadArchive(of: current)
    }

    private func adopt(_ record: DataExportRecord) async {
        export = record
        isExportAttempt = false
        if record.status.isSettled, record.status == .ready {
            await downloadArchive(of: record)
        }
    }

    private func downloadArchive(of record: DataExportRecord) async {
        guard record.isDownloadable(at: dates.now()), let url = record.downloadURL else {
            // A link that has run out is not an error to report as a failure of
            // the export: it is one to ask again for.
            exportFailure = true
            return
        }
        do {
            let data = try await exporting.downloadArchive(from: url)
            exportArchive = try archives.store(archive: data, for: record.id)
        } catch {
            // Neither the URL nor the reason: the first carries a proof and the
            // second may quote it back.
            logger.log(.error, .auth, "The account export could not be downloaded")
            exportFailure = true
        }
    }

    /// Forgets the archive on disk. Called when the screen goes away: an export
    /// left in the caches is a copy of the whole account nobody asked to keep.
    public func discardExportArchive() {
        if let exportArchive {
            archives.discard(archive: exportArchive)
        }
        exportArchive = nil
        export = nil
    }

    // MARK: - Deletion

    public func requestDeletion() {
        isExportAttempt = false
        reauthentication.reset()
        isConfirmingDeletion = true
    }

    public func cancelDeletion() {
        isConfirmingDeletion = false
        reauthentication.noteCancelled()
    }

    /// Accepting the consequences asks for a fresh proof; the deletion itself
    /// happens once a provider has answered.
    public func confirmDeletion() {
        guard isConfirmingDeletion else { return }
        isConfirmingDeletion = false
        reauthentication.request { [weak self] proof in
            guard let self else { return }
            let deletion = try await self.deleting.deleteAccount(provingWith: proof)
            await self.adoptAcceptedDeletion(deletion)
        }
    }

    /// The backend has accepted the deletion. What follows is local and must
    /// happen even if nothing else does: the notice is stored so a relaunch
    /// still knows, the account's data on this device goes, and the tokens go
    /// with it.
    private func adoptAcceptedDeletion(_ deletion: AccountDeletionRecord) async {
        deletionState.store(pendingDeletion: deletion)
        pendingDeletion = deletion

        let scope = await scopes.currentScope()
        do {
            try await cleaner.erase(scope: scope)
        } catch {
            logger.log(.error, .persistence, "The account's local data outlived its deletion")
        }
        await session.signOut(everywhere: false)
        identities = []
        devices = []
        export = nil
        exportArchive = nil
        await onSignedOut?()
    }

    // MARK: - Proof plumbing

    public func prepareNonce() -> SignInNonce { reauthentication.prepareNonce() }

    public var preparedNonce: SignInNonce? { reauthentication.preparedNonce }

    public func prove(with credential: ProviderCredential) async {
        await reauthentication.prove(with: credential)
    }

    public func noteCancelledProof() {
        reauthentication.noteCancelled()
    }

    public func noteProviderFailure(_ failure: SignInFailure) {
        reauthentication.noteProviderFailure(failure)
    }

    public func resetReauthentication() {
        reauthentication.reset()
    }

    // MARK: - Mapping

    /// The layer below hands up a `PresentableError`: a kind chosen for what a
    /// screen may say, and the registered code. Neither the server's sentence
    /// nor its envelope reaches this far.
    private static func loadFailure(from error: any Error) -> LoadFailure {
        guard let presentable = error as? PresentableError else { return .refused }
        return presentable.kind == .offline ? .offline : .refused
    }

    private static func identityFailure(from error: any Error) -> IdentityChangeFailure {
        guard let presentable = error as? PresentableError else {
            return .refused(code: "UNKNOWN")
        }
        if presentable.kind == .offline { return .offline }
        switch presentable.code {
        case "IDENTITY_ALREADY_LINKED": return .belongsToAnotherAccount
        case "PROVIDER_ALREADY_LINKED": return .providerAlreadyLinked
        case "LAST_IDENTITY_CANNOT_BE_REMOVED": return .lastIdentity
        case let code: return .refused(code: code ?? "UNKNOWN")
        }
    }
}

/// Keeps a downloaded archive on disk for as long as the screen needs it.
///
/// A seam rather than a `FileManager` call inside the store: an export is a
/// copy of somebody's whole account, and a test has to be able to prove it was
/// written where it was meant to be and removed afterwards.
public protocol ExportArchiveStoring: Sendable {
    func store(archive: Data, for exportID: UUID) throws -> URL
    func discard(archive url: URL)
}

/// The default: a file in the caches directory, replaced rather than
/// accumulated, and removed when the screen is done with it.
public struct TemporaryExportArchiveStore: ExportArchiveStoring {
    private let directory: URL

    public init(directory: URL? = nil) {
        self.directory =
            directory
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "exports", directoryHint: .isDirectory)
    }

    public func store(archive: Data, for exportID: UUID) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Named for the export rather than for the account: a file name is one
        // more place an identifier could be read from.
        let url = directory.appending(path: "country-flags-export-\(exportID.uuidString).json")
        try archive.write(to: url, options: .atomic)
        return url
    }

    public func discard(archive url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}
