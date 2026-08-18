import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

@MainActor
final class AccountStoreTests: XCTestCase {
    /// A successful sign-in is immediately followed by the guest import: the
    /// person who signed in expects their progress to follow them without
    /// being asked a second question.
    func testASuccessfulSignInRunsTheGuestImport() async {
        let session = ScriptedSession(outcome: .succeeded(userID: Fixtures.userID))
        let migrations = RecordingMigrations()
        let store = makeStore(session: session, migrations: migrations)

        await store.signIn(with: Fixtures.credential)

        let imported = await migrations.importedInto
        XCTAssertEqual(imported, [Fixtures.userID])
        XCTAssertNil(store.lastFailure)
    }

    /// The sync follows the import, in that order: it is what brings the
    /// account's history home, and without it a fresh device showed nothing
    /// until the next foreground.
    func testASuccessfulSignInStartsASyncAfterTheImport() async {
        let session = ScriptedSession(outcome: .succeeded(userID: Fixtures.userID))
        let order = OrderRecorder()
        let migrations = RecordingMigrations(order: order)
        let store = makeStore(session: session, migrations: migrations)
        store.onSignedIn = { await order.note("sync") }

        await store.signIn(with: Fixtures.credential)

        let imported = await migrations.importedInto
        XCTAssertEqual(imported, [Fixtures.userID])
        // Both happened, and in this order: the sync must upload the imported
        // work rather than race it.
        let notes = await order.notes
        XCTAssertEqual(notes, ["import", "sync"])
    }

    func testAFailedSignInDoesNotStartASync() async {
        let session = ScriptedSession(outcome: .failed(.offline))
        let store = makeStore(session: session, migrations: RecordingMigrations())
        let order = OrderRecorder()
        store.onSignedIn = { await order.note("sync") }

        await store.signIn(with: Fixtures.credential)

        let notes = await order.notes
        XCTAssertEqual(notes, [])
    }

    func testAFailedSignInIsWordedAndImportsNothing() async {
        let session = ScriptedSession(outcome: .failed(.offline))
        let migrations = RecordingMigrations()
        let store = makeStore(session: session, migrations: migrations)

        await store.signIn(with: Fixtures.credential)

        let imported = await migrations.importedInto
        XCTAssertTrue(imported.isEmpty)
        XCTAssertEqual(store.lastFailure, .offline)
    }

    /// Signing out with unsent answers is the user's decision: the number is
    /// counted and put to them before anything is revoked.
    func testSignOutWithUnsyncedWorkRequiresAWarning() async {
        let store = makeStore(
            session: ScriptedSession(outcome: .succeeded(userID: Fixtures.userID)),
            migrations: RecordingMigrations(),
            pendingOperations: 3
        )

        await store.requestSignOut()

        XCTAssertEqual(store.signOutAssessment?.unsyncedCount, 3)
        XCTAssertEqual(store.signOutAssessment?.requiresWarning, true)
    }

    func testSignOutWithNothingPendingWarnsAboutNothing() async {
        let store = makeStore(
            session: ScriptedSession(outcome: .succeeded(userID: Fixtures.userID)),
            migrations: RecordingMigrations()
        )

        await store.requestSignOut()

        XCTAssertEqual(store.signOutAssessment?.requiresWarning, false)
    }

    /// The provider sheet being dismissed is a change of mind, not a failure:
    /// nothing is worded and nothing is reported.
    func testACancelledSignInLeavesNoFailureBehind() {
        let store = makeStore(
            session: ScriptedSession(outcome: .cancelled),
            migrations: RecordingMigrations()
        )

        _ = store.prepareNonce()
        store.noteCancelledSignIn()

        XCTAssertNil(store.lastFailure)
        XCTAssertNil(store.preparedNonce)
    }

    // MARK: - Harness

    private func makeStore(
        session: ScriptedSession,
        migrations: RecordingMigrations,
        pendingOperations: Int = 0
    ) -> AccountStore {
        AccountStore(
            session: session,
            migrations: migrations,
            outbox: StubOutbox(pendingCount: pendingOperations),
            scopes: StubScopes(),
            nonces: StubNonces()
        )
    }
}

// MARK: - Doubles

private enum Fixtures {
    static let userID = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
    static let credential = ProviderCredential.apple(
        identityToken: "token",
        authorizationCode: "code",
        rawNonce: "nonce"
    )
}

private actor ScriptedSession: SessionControlling {
    private let outcome: SignInOutcome
    private var state: AuthenticationState = .guest

    init(outcome: SignInOutcome) {
        self.outcome = outcome
    }

    func currentState() async -> AuthenticationState { state }

    func currentProfile() async -> AccountProfile? {
        state.isAuthenticated
            ? AccountProfile(displayName: "Scripted Learner", avatarURL: nil)
            : nil
    }

    func adoptProviderProfile(name: String?, avatarURL: URL?) async {}

    func signIn(with credential: ProviderCredential) async -> SignInOutcome {
        if case .succeeded(let userID) = outcome {
            state = .authenticated(userID: userID)
        }
        return outcome
    }

    func signOut(everywhere: Bool) async {
        state = .guest
    }
}

private actor RecordingMigrations: GuestMigrationRunning {
    private(set) var importedInto: [UUID] = []
    private let order: OrderRecorder?

    init(order: OrderRecorder? = nil) {
        self.order = order
    }

    func importGuestWork(into userID: UUID) async -> GuestMigrationOutcome {
        importedInto.append(userID)
        await order?.note("import")
        return .nothingToImport
    }
}

private struct StubScopes: AccountScopeResolving {
    func currentScope() async -> AccountScope {
        .guest(installationID: UUID(uuidString: "10000000-0000-4000-8000-000000000001")!)
    }
}

private struct StubNonces: NonceGenerating {
    func makeNonce() -> SignInNonce {
        SignInNonce(raw: "raw", hashed: "hashed")
    }
}

private struct StubOutbox: OutboxRepository {
    let pendingCount: Int

    func enqueue(_ operation: OutboxOperationRecord, for scope: AccountScope) async throws {}

    func pendingOperations(for scope: AccountScope) async throws -> [OutboxOperationRecord] {
        (0..<pendingCount).map { index in
            OutboxOperationRecord(
                id: UUID(uuidString: String(format: "90000000-0000-4000-8000-%012d", index))!,
                kind: .reviewBatch,
                dependencyID: nil,
                payload: Data(),
                state: .pending,
                attemptCount: 0,
                lastFailureCode: nil,
                createdAt: Date(timeIntervalSince1970: 1_800_000_000),
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
            )
        }
    }

    func updateState(
        of operationID: UUID,
        to state: OutboxState,
        failureCode: String?,
        for scope: AccountScope
    ) async throws {}

    func requeueInterruptedOperations(for scope: AccountScope) async throws -> Int { 0 }

    func cursor(
        _ feed: SyncCursorRecord.Feed,
        for scope: AccountScope
    ) async throws -> SyncCursorRecord? { nil }

    func saveCursor(_ cursor: SyncCursorRecord, for scope: AccountScope) async throws {}

    func discardQueuedWork(for scope: AccountScope) async throws {}
}


private actor OrderRecorder {
    private(set) var notes: [String] = []

    func note(_ name: String) {
        notes.append(name)
    }
}
