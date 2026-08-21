import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// The account's own operations: adding and removing ways in, revoking
/// devices, exporting the data and deleting the account. What is pinned here is
/// the order things happen in, and what is left standing when one of them
/// fails.
@MainActor
final class AccountLifecycleStoreTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000101")!
    )

    // MARK: - Reading

    func testTheScreenReadsIdentitiesAndDevices() async throws {
        let directory = StubDirectory(
            identities: [Fixtures.identity(.apple, now: now)],
            devices: [Fixtures.device(isCurrent: true, now: now)]
        )
        let store = makeStore(directory: directory)

        await store.load()

        XCTAssertEqual(store.identities.map(\.provider), [.apple])
        XCTAssertEqual(store.devices.map(\.isCurrent), [true])
        XCTAssertNil(store.loadFailure)
        XCTAssertTrue(store.isLoaded)
    }

    /// This device leads the list: it is the one a person is looking for.
    func testThisDeviceIsListedFirst() async throws {
        let directory = StubDirectory(
            identities: [],
            devices: [
                Fixtures.device(isCurrent: false, now: now.addingTimeInterval(-100)),
                Fixtures.device(isCurrent: true, now: now.addingTimeInterval(-10_000)),
            ]
        )
        let store = makeStore(directory: directory)

        await store.load()

        XCTAssertEqual(store.devices.first?.isCurrent, true)
    }

    func testAnOfflineReadIsSeparatedFromARefusal() async throws {
        let directory = StubDirectory(
            identities: [],
            devices: [],
            failure: PresentableError(kind: .offline)
        )
        let store = makeStore(directory: directory)

        await store.load()

        XCTAssertEqual(store.loadFailure, .offline)
    }

    // MARK: - Identities

    func testLinkingAnotherProviderReloadsTheList() async throws {
        let directory = StubDirectory(identities: [Fixtures.identity(.apple, now: now)], devices: [])
        let store = makeStore(directory: directory)
        await store.load()
        await directory.setIdentities([
            Fixtures.identity(.apple, now: now), Fixtures.identity(.google, now: now),
        ])

        await store.link(with: .google(idToken: "google-token"))

        XCTAssertEqual(store.identities.map(\.provider), [.apple, .google])
        XCTAssertNil(store.identityFailure)
    }

    /// The one refusal with a way out that is not "try again". Merging is not
    /// offered, and email is never used to match two accounts.
    func testALoginOwnedByAnotherAccountOffersASafeSwitch() async throws {
        let directory = StubDirectory(
            identities: [Fixtures.identity(.apple, now: now)],
            devices: [],
            failure: PresentableError(kind: .conflict, code: "IDENTITY_ALREADY_LINKED")
        )
        let session = RecordingSession()
        let store = makeStore(directory: directory, session: session)
        await store.load()

        await store.link(with: .google(idToken: "google-token"))

        XCTAssertEqual(store.identityFailure, .belongsToAnotherAccount)

        await store.signOutToSwitchAccounts()

        let signOuts = await session.signOutCount()
        XCTAssertEqual(signOuts, 1)
        XCTAssertNil(store.identityFailure)
    }

    func testASecondIdentityForTheSameProviderIsReportedAsSuch() async throws {
        let directory = StubDirectory(
            identities: [Fixtures.identity(.apple, now: now)],
            devices: [],
            failure: PresentableError(kind: .conflict, code: "PROVIDER_ALREADY_LINKED")
        )
        let store = makeStore(directory: directory)
        await store.load()

        await store.link(with: .apple(identityToken: "t", authorizationCode: "c", rawNonce: "n"))

        XCTAssertEqual(store.identityFailure, .providerAlreadyLinked)
    }

    /// The rule belongs to the server. The client shows the refusal rather than
    /// counting identities itself and hiding the button.
    func testTheLastIdentityRefusalComesFromTheServer() async throws {
        let directory = StubDirectory(
            identities: [Fixtures.identity(.apple, now: now)],
            devices: [],
            failure: PresentableError(kind: .conflict, code: "LAST_IDENTITY_CANNOT_BE_REMOVED")
        )
        let store = makeStore(directory: directory)
        await store.load()

        await store.unlink(.apple)

        XCTAssertEqual(store.identityFailure, .lastIdentity)
        XCTAssertEqual(store.identities.map(\.provider), [.apple])
    }

    // MARK: - Devices

    func testRevokingAnotherDeviceKeepsThisSession() async throws {
        let other = Fixtures.device(isCurrent: false, now: now)
        let directory = StubDirectory(identities: [], devices: [other])
        let session = RecordingSession()
        let store = makeStore(directory: directory, session: session)
        await store.load()

        await store.revoke(device: other)

        let revoked = await directory.revokedDevices()
        let signOuts = await session.signOutCount()
        XCTAssertEqual(revoked, [other.id])
        XCTAssertEqual(signOuts, 0)
    }

    /// Revoking this device revokes its sessions, so the tokens it holds are
    /// already worthless. Clearing them here is what stops the app from
    /// discovering that one request at a time.
    func testRevokingThisDeviceEndsTheLocalSession() async throws {
        let current = Fixtures.device(isCurrent: true, now: now)
        let directory = StubDirectory(identities: [], devices: [current])
        let session = RecordingSession()
        let store = makeStore(directory: directory, session: session)
        let signedOut = Notified()
        store.onSignedOut = { await signedOut.note() }
        await store.load()

        await store.revoke(device: current)

        let signOuts = await session.signOutCount()
        XCTAssertEqual(signOuts, 1)
        XCTAssertTrue(store.devices.isEmpty)
        let wasNotified = await signedOut.wasNotified()
        XCTAssertTrue(wasNotified)
    }

    // MARK: - Export

    func testAnExportIsFollowedFromProcessingToAnArchiveOnDisk() async throws {
        let exporting = StubExporting(
            requested: Fixtures.export(status: .processing, now: now),
            statuses: [
                Fixtures.export(status: .processing, now: now),
                Fixtures.export(status: .ready, now: now),
            ]
        )
        let archives = RecordingArchiveStore()
        let store = makeStore(exporting: exporting, archives: archives)
        await store.load()

        await store.requestExport()
        await store.followExport()

        XCTAssertEqual(store.export?.status, .ready)
        XCTAssertNotNil(store.exportArchive)
        XCTAssertFalse(store.exportFailure)
        let stored = archives.storedCount()
        XCTAssertEqual(stored, 1)
    }

    func testAFailedExportIsReportedRatherThanRetriedForever() async throws {
        let exporting = StubExporting(
            requested: Fixtures.export(status: .processing, now: now),
            statuses: [Fixtures.export(status: .failed, now: now)]
        )
        let store = makeStore(exporting: exporting)
        await store.load()

        await store.requestExport()
        await store.followExport()

        XCTAssertTrue(store.exportFailure)
        XCTAssertNil(store.exportArchive)
    }

    /// A link that has run out is not an archive: the screen offers to ask
    /// again rather than handing over a file it never fetched.
    func testAnExpiredDownloadLinkIsNotFetched() async throws {
        let expired = Fixtures.export(
            status: .ready,
            now: now,
            expiresAt: now.addingTimeInterval(-60)
        )
        let exporting = StubExporting(requested: expired, statuses: [])
        let store = makeStore(exporting: exporting)
        await store.load()

        await store.requestExport()

        XCTAssertTrue(store.exportFailure)
        XCTAssertNil(store.exportArchive)
        let downloads = await exporting.downloadCount()
        XCTAssertEqual(downloads, 0)
    }

    func testADownloadThatFailsLeavesNoArchive() async throws {
        let exporting = StubExporting(
            requested: Fixtures.export(status: .ready, now: now),
            statuses: [],
            downloadFails: true
        )
        let store = makeStore(exporting: exporting)
        await store.load()

        await store.requestExport()

        XCTAssertTrue(store.exportFailure)
        XCTAssertNil(store.exportArchive)
    }

    /// The complaint this answers: signing in and then being sent through the
    /// provider again, seconds later, to ask for your own data.
    func testAFreshSessionGetsTheArchiveWithoutProvingItselfAgain() async throws {
        let exporting = StubExporting(
            requested: Fixtures.export(status: .ready, now: now),
            statuses: []
        )
        let store = makeStore(exporting: exporting)
        await store.load()

        await store.requestExport()

        let proved = await exporting.provedIdentity
        XCTAssertEqual(proved, [false], "nobody should have been asked to sign in")
        XCTAssertEqual(store.reauthenticationPhase, .idle, "no proof sheet was raised")
        XCTAssertNotNil(store.exportArchive)
    }

    /// A session old enough to have gone cold is worth one round trip — and
    /// exactly one.
    func testAColdSessionIsAskedToProveItselfOnceAndThenSucceeds() async throws {
        let exporting = StubExporting(
            requested: Fixtures.export(status: .ready, now: now),
            statuses: [],
            refusesWithoutProof: true
        )
        let store = makeStore(exporting: exporting)
        await store.load()

        await store.requestExport()
        XCTAssertEqual(store.reauthenticationPhase, .provingIdentity)
        await store.prove(with: .google(idToken: "google-token"))

        let proved = await exporting.provedIdentity
        XCTAssertEqual(proved, [false, true])
        XCTAssertNotNil(store.exportArchive)
        XCTAssertFalse(store.exportFailure)
    }

    /// An export left in the caches is a copy of the whole account nobody asked
    /// to keep.
    func testLeavingTheScreenDiscardsTheArchive() async throws {
        let exporting = StubExporting(
            requested: Fixtures.export(status: .ready, now: now),
            statuses: []
        )
        let archives = RecordingArchiveStore()
        let store = makeStore(exporting: exporting, archives: archives)
        await store.load()
        await store.requestExport()

        store.discardExportArchive()

        XCTAssertNil(store.exportArchive)
        let discarded = archives.discardedCount()
        XCTAssertEqual(discarded, 1)
    }

    // MARK: - Deletion

    func testAnAcceptedDeletionClearsTheDeviceAndRemembersTheDate() async throws {
        let deleting = StubDeleting(
            result: .success(
                AccountDeletionRecord(
                    requestedAt: now,
                    expectedCompletionAt: now.addingTimeInterval(7 * 86_400)
                )
            )
        )
        let cleaner = RecordingCleaner()
        let session = RecordingSession()
        let deletionState = InMemoryDeletionState()
        let store = makeStore(
            deleting: deleting,
            session: session,
            cleaner: cleaner,
            deletionState: deletionState
        )
        await store.load()

        store.requestDeletion()
        store.confirmDeletion()
        await store.prove(with: .google(idToken: "google-token"))

        XCTAssertEqual(store.reauthenticationPhase, .done)
        XCTAssertEqual(store.pendingDeletion?.expectedCompletionAt, now.addingTimeInterval(604_800))
        XCTAssertEqual(deletionState.stored?.requestedAt, now)
        let erased = await cleaner.erasedScopes()
        let signOuts = await session.signOutCount()
        XCTAssertEqual(erased, [account])
        XCTAssertEqual(signOuts, 1)
    }

    /// Confirming is a statement of intent, not the deletion: the contract asks
    /// for evidence of identity on top of it.
    func testConfirmingAloneDeletesNothing() async throws {
        let deleting = StubDeleting(result: .failure(Failure.refused))
        let store = makeStore(deleting: deleting)
        await store.load()

        store.requestDeletion()
        store.confirmDeletion()

        XCTAssertEqual(store.reauthenticationPhase, .provingIdentity)
        let attempts = await deleting.attempts()
        XCTAssertEqual(attempts, 0)
    }

    func testARefusedDeletionLeavesTheAccountAndTheDeviceAlone() async throws {
        let deleting = StubDeleting(result: .failure(Failure.refused))
        let cleaner = RecordingCleaner()
        let session = RecordingSession()
        let deletionState = InMemoryDeletionState()
        let store = makeStore(
            deleting: deleting,
            session: session,
            cleaner: cleaner,
            deletionState: deletionState
        )
        await store.load()

        store.requestDeletion()
        store.confirmDeletion()
        await store.prove(with: .google(idToken: "google-token"))

        XCTAssertEqual(store.reauthenticationPhase, .failed(.operation))
        XCTAssertNil(store.pendingDeletion)
        XCTAssertNil(deletionState.stored)
        let erased = await cleaner.erasedScopes()
        let signOuts = await session.signOutCount()
        XCTAssertTrue(erased.isEmpty)
        XCTAssertEqual(signOuts, 0)
    }

    /// The notice has to outlive the sign-out the deletion causes, and the
    /// launch after it — which is exactly the state it is read back in.
    func testAPendingDeletionSurvivesARelaunchWithoutAnAccount() async throws {
        let deletionState = InMemoryDeletionState()
        deletionState.store(
            pendingDeletion: AccountDeletionRecord(
                requestedAt: now,
                expectedCompletionAt: now.addingTimeInterval(604_800)
            )
        )
        let store = makeStore(
            session: RecordingSession(state: .guest),
            deletionState: deletionState
        )

        await store.load()

        XCTAssertNotNil(store.pendingDeletion)
        XCTAssertTrue(store.identities.isEmpty)
        XCTAssertTrue(store.isLoaded)
    }

    // MARK: - Harness

    private func makeStore(
        directory: StubDirectory = StubDirectory(identities: [], devices: []),
        exporting: StubExporting = StubExporting(requested: nil, statuses: []),
        deleting: StubDeleting = StubDeleting(result: .failure(Failure.refused)),
        session: RecordingSession = RecordingSession(),
        cleaner: RecordingCleaner = RecordingCleaner(),
        deletionState: InMemoryDeletionState = InMemoryDeletionState(),
        archives: RecordingArchiveStore = RecordingArchiveStore()
    ) -> AccountLifecycleStore {
        AccountLifecycleStore(
            directory: directory,
            exporting: exporting,
            deleting: deleting,
            reauthentication: ReauthenticationCoordinator(
                auth: StubReauthenticator(
                    proof: ReauthenticationProof(
                        token: "proof-1",
                        expiresAt: now.addingTimeInterval(300)
                    )
                ),
                nonces: FixedNonces(),
                dates: FixedDateProvider(instant: now)
            ),
            session: session,
            scopes: FixedScopeResolver(scope: account),
            cleaner: cleaner,
            deletionState: deletionState,
            archives: archives,
            // Polling without the waiting: the state machine is what is under
            // test, not the seconds between its steps.
            waiter: ImmediateWaiter(),
            dates: FixedDateProvider(instant: now)
        )
    }

    private enum Failure: Error {
        case refused
    }

    private enum Fixtures {
        static func identity(_ provider: AuthProvider, now: Date) -> AccountIdentityRecord {
            AccountIdentityRecord(
                id: UUID(uuidString: "a0000000-0000-4000-8000-00000000000\(provider == .apple ? 1 : 2)")!,
                provider: provider,
                createdAt: provider == .apple ? now : now.addingTimeInterval(60),
                lastLoginAt: now
            )
        }

        static func device(isCurrent: Bool, now: Date) -> AccountDeviceRecord {
            AccountDeviceRecord(
                id: UUID(uuidString: "d0000000-0000-4000-8000-00000000000\(isCurrent ? 1 : 2)")!,
                platform: "IOS",
                appVersion: "1.0.0",
                locale: "en",
                timezone: "UTC",
                lastSeenAt: now,
                isCurrent: isCurrent
            )
        }

        static func export(
            status: DataExportStatus,
            now: Date,
            expiresAt: Date? = nil
        ) -> DataExportRecord {
            DataExportRecord(
                id: UUID(uuidString: "e0000000-0000-4000-8000-000000000001")!,
                status: status,
                downloadURL: status == .ready
                    ? URL(string: "https://example.invalid/export?token=proof") : nil,
                sha256: nil,
                expiresAt: expiresAt ?? (status == .ready ? now.addingTimeInterval(900) : nil),
                createdAt: now,
                completedAt: status == .ready ? now : nil
            )
        }
    }
}

// MARK: - Doubles

private actor StubDirectory: AccountDirectory {
    private var storedIdentities: [AccountIdentityRecord]
    private var storedDevices: [AccountDeviceRecord]
    private let failure: PresentableError?
    private var revoked: [UUID] = []

    init(
        identities: [AccountIdentityRecord],
        devices: [AccountDeviceRecord],
        failure: PresentableError? = nil
    ) {
        storedIdentities = identities
        storedDevices = devices
        self.failure = failure
    }

    func setIdentities(_ identities: [AccountIdentityRecord]) {
        storedIdentities = identities
    }

    func revokedDevices() -> [UUID] { revoked }

    func identities() async throws -> [AccountIdentityRecord] {
        // The read itself only fails when the failure is about reading; a
        // conflict belongs to the change that produced it.
        if let failure, failure.kind == .offline { throw failure }
        return storedIdentities
    }

    func link(_ credential: ProviderCredential) async throws -> AccountIdentityRecord {
        if let failure { throw failure }
        let linked = AccountIdentityRecord(
            id: UUID(uuidString: "a0000000-0000-4000-8000-000000000009")!,
            provider: credential.provider,
            createdAt: Date(timeIntervalSince1970: 1_800_000_000),
            lastLoginAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
        return linked
    }

    func unlink(_ provider: AuthProvider) async throws {
        if let failure { throw failure }
        storedIdentities.removeAll { $0.provider == provider }
    }

    func devices() async throws -> [AccountDeviceRecord] {
        if let failure, failure.kind == .offline { throw failure }
        return storedDevices
    }

    func revokeDevice(id: UUID) async throws {
        if let failure, failure.kind == .offline { throw failure }
        revoked.append(id)
        storedDevices.removeAll { $0.id == id }
    }
}

private actor StubExporting: DataExporting {
    private let requested: DataExportRecord?
    private var statuses: [DataExportRecord]
    private let downloadFails: Bool
    private var downloads = 0
    /// What the backend answers a request that carries no proof. `nil` means
    /// it accepts one — the session is fresh enough to speak for itself.
    private let refusal: PresentableError?

    init(
        requested: DataExportRecord?,
        statuses: [DataExportRecord],
        downloadFails: Bool = false,
        refusesWithoutProof: Bool = false
    ) {
        self.requested = requested
        self.statuses = statuses
        self.downloadFails = downloadFails
        refusal = refusesWithoutProof ? PresentableError(kind: .unauthorized) : nil
    }

    func downloadCount() -> Int { downloads }

    /// Records whether the caller offered a proof, which is the difference
    /// between "asked politely first" and "sent somebody through a provider".
    private(set) var provedIdentity: [Bool] = []

    func requestExport(
        provingWith proof: ReauthenticationProof?
    ) async throws -> DataExportRecord {
        provedIdentity.append(proof != nil)
        if let refusal, proof == nil { throw refusal }
        guard let requested else { throw PresentableError(kind: .unexpected) }
        return requested
    }

    func exportStatus(id: UUID) async throws -> DataExportRecord {
        guard !statuses.isEmpty else { throw PresentableError(kind: .unexpected) }
        return statuses.removeFirst()
    }

    func downloadArchive(from url: URL) async throws -> Data {
        downloads += 1
        if downloadFails { throw PresentableError(kind: .server) }
        return Data("{}".utf8)
    }
}

private actor StubDeleting: AccountDeleting {
    private let result: Result<AccountDeletionRecord, any Error>
    private var attemptCount = 0

    init(result: Result<AccountDeletionRecord, any Error>) {
        self.result = result
    }

    func attempts() -> Int { attemptCount }

    func deleteAccount(provingWith proof: ReauthenticationProof) async throws
        -> AccountDeletionRecord
    {
        attemptCount += 1
        return try result.get()
    }
}

private actor RecordingSession: SessionControlling {
    private let state: AuthenticationState
    private var signOuts = 0

    init(state: AuthenticationState = .authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000101")!
    )) {
        self.state = state
    }

    func signOutCount() -> Int { signOuts }

    func currentState() async -> AuthenticationState { state }
    func currentProfile() async -> AccountProfile? { nil }
    func adoptProviderProfile(name: String?, avatarURL: URL?) async {}
    func signIn(with credential: ProviderCredential) async -> SignInOutcome { .cancelled }
    func signOut(everywhere: Bool) async { signOuts += 1 }
}

private actor RecordingCleaner: AccountScopeCleaner {
    private var erased: [AccountScope] = []

    func erasedScopes() -> [AccountScope] { erased }

    func erase(scope: AccountScope) async throws { erased.append(scope) }
}

private final class InMemoryDeletionState: AccountDeletionStateStoring, @unchecked Sendable {
    private(set) var stored: AccountDeletionRecord?

    func pendingDeletion() -> AccountDeletionRecord? { stored }

    func store(pendingDeletion: AccountDeletionRecord?) { stored = pendingDeletion }
}

/// Counts synchronously: the protocol is not async, so a double that recorded
/// through a task would be counted after the assertion that reads it — which is
/// a flake rather than a finding.
private final class RecordingArchiveStore: ExportArchiveStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var stored = 0
    private var discarded = 0

    func store(archive: Data, for exportID: UUID) throws -> URL {
        lock.withLock { stored += 1 }
        return URL(fileURLWithPath: "/tmp/country-flags-export-\(exportID.uuidString).json")
    }

    func discard(archive url: URL) {
        lock.withLock { discarded += 1 }
    }

    func storedCount() -> Int { lock.withLock { stored } }
    func discardedCount() -> Int { lock.withLock { discarded } }
}

private struct StubReauthenticator: AuthenticationService {
    let proof: ReauthenticationProof

    func reauthenticate(with credential: ProviderCredential) async throws -> ReauthenticationProof {
        proof
    }

    func exchange(_ credential: ProviderCredential) async throws -> AuthSessionRecord {
        throw PresentableError(kind: .unexpected)
    }

    func refresh(refreshToken: String) async throws -> RefreshedSessionRecord {
        throw PresentableError(kind: .unexpected)
    }

    func logout(refreshToken: String) async throws {}
    func logoutEverywhere() async throws {}
}

private struct FixedNonces: NonceGenerating {
    func makeNonce() -> SignInNonce { SignInNonce(raw: "raw", hashed: "hashed") }
}

private struct ImmediateWaiter: Waiting {
    func wait(seconds: TimeInterval) async {}
}

private actor Notified {
    private var notified = false

    func note() { notified = true }
    func wasNotified() -> Bool { notified }
}
