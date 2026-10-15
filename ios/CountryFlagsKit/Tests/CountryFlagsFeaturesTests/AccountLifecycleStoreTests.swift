import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// Deleting the account in the order that makes it safe: consequences, then
/// the server, then this device's data, then the tokens. These pin every step
/// where stopping early must leave the account exactly where it was.
@MainActor
final class AccountLifecycleStoreTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000101")!
    )

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
        await store.confirmDeletion()

        XCTAssertEqual(store.deletionPhase, .idle)
        XCTAssertEqual(store.pendingDeletion?.expectedCompletionAt, now.addingTimeInterval(604_800))
        XCTAssertEqual(deletionState.stored?.requestedAt, now)
        let erased = await cleaner.erasedScopes()
        let signOuts = await session.signOutCount()
        XCTAssertEqual(erased, [account])
        XCTAssertEqual(signOuts, 1)
    }

    /// The deletion has to say that the session ended, because it ends it from
    /// a store of its own: everything that belonged to the account — the
    /// counts on screen, the decks a purchase opened — is put back by whoever
    /// listens here. Nothing did once, and a deleted account's progress and
    /// paid deck stayed on the device until the next launch.
    func testAnAcceptedDeletionAnnouncesTheSignOut() async throws {
        let store = makeStore(
            deleting: StubDeleting(
                result: .success(
                    AccountDeletionRecord(
                        requestedAt: now,
                        expectedCompletionAt: now.addingTimeInterval(7 * 86_400)
                    )
                )
            )
        )
        let announced = Announced()
        store.onSignedOut = { await announced.note() }
        await store.load()
        store.requestDeletion()

        await store.confirmDeletion()

        let wasAnnounced = await announced.wasAnnounced()
        XCTAssertTrue(wasAnnounced)
    }

    /// A refusal ended nothing, so nothing is announced: the account is still
    /// signed in and everything it opens must stay open.
    func testARefusedDeletionAnnouncesNothing() async throws {
        let store = makeStore(deleting: StubDeleting(result: .failure(Failure.refused)))
        let announced = Announced()
        store.onSignedOut = { await announced.note() }
        await store.load()
        store.requestDeletion()

        await store.confirmDeletion()

        let wasAnnounced = await announced.wasAnnounced()
        XCTAssertFalse(wasAnnounced)
    }

    /// Asking for the dialog is a question, not a consent: nothing may run
    /// until the destructive button inside it is tapped.
    func testRequestingAloneDeletesNothing() async throws {
        let deleting = StubDeleting(result: .failure(Failure.refused))
        let store = makeStore(deleting: deleting)
        await store.load()

        store.requestDeletion()

        XCTAssertTrue(store.isConfirmingDeletion)
        let attempts = await deleting.attempts()
        XCTAssertEqual(attempts, 0)
    }

    /// Confirming without the dialog on screen must be inert: a stale tap
    /// that lands after a cancel is not a consent.
    func testConfirmingWithoutTheDialogIsInert() async throws {
        let deleting = StubDeleting(result: .failure(Failure.refused))
        let store = makeStore(deleting: deleting)
        await store.load()

        await store.confirmDeletion()

        let attempts = await deleting.attempts()
        XCTAssertEqual(attempts, 0)
    }

    /// The dismissal that comes with an accepted confirmation must not cancel
    /// it. Tapping the destructive button takes the dialog down, and SwiftUI
    /// writes the presentation binding back before the button's task runs —
    /// so a gate that read "the dialog is gone" as "they changed their mind"
    /// made the button do nothing at all.
    func testTheDismissalThatCarriesTheConfirmationStillDeletes() async throws {
        let deleting = StubDeleting(
            result: .success(
                AccountDeletionRecord(
                    requestedAt: now,
                    expectedCompletionAt: now.addingTimeInterval(604_800)
                )
            )
        )
        let store = makeStore(deleting: deleting)
        await store.load()
        store.requestDeletion()

        store.cancelDeletion()
        await store.confirmDeletion()

        let attempts = await deleting.attempts()
        XCTAssertEqual(attempts, 1)
        XCTAssertNotNil(store.pendingDeletion)
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
        await store.confirmDeletion()

        XCTAssertEqual(store.deletionPhase, .failed)
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
        XCTAssertTrue(store.isLoaded)
    }

    // MARK: - Signing in again after a deletion (#452)

    /// The guest the deleted account was made from is owned by it for good,
    /// so a later sign-in could never carry that guest over. The device
    /// starts over as a new guest once the deletion has landed and the
    /// session is gone, and the old guest's leftovers go with the account's.
    func testAnAcceptedDeletionStartsANewGuest() async throws {
        let cleaner = RecordingCleaner()
        let session = RecordingSession()
        let guests = RecordingGuestIdentity(previous: previousGuest, session: session)
        let store = makeStore(
            deleting: StubDeleting(result: .success(record)),
            session: session,
            cleaner: cleaner,
            guestIdentity: guests
        )
        await store.load()
        store.requestDeletion()

        await store.confirmDeletion()

        let rotations = await guests.rotations()
        XCTAssertEqual(rotations, 1)
        let signedOutFirst = await guests.rotatedAfterSignOut()
        XCTAssertTrue(signedOutFirst, "the new guest starts once the session is gone")
        let erased = await cleaner.erasedScopes()
        XCTAssertEqual(erased, [account, previousGuest])
    }

    /// Nothing was deleted, so the device keeps the guest it had.
    func testARefusedDeletionKeepsTheGuest() async throws {
        let guests = RecordingGuestIdentity(previous: previousGuest, session: RecordingSession())
        let store = makeStore(
            deleting: StubDeleting(result: .failure(Failure.refused)),
            guestIdentity: guests
        )
        await store.load()
        store.requestDeletion()

        await store.confirmDeletion()

        let rotations = await guests.rotations()
        XCTAssertEqual(rotations, 0)
    }

    /// The response to the first request is lost; the person tries again.
    /// The server answers the repeat with the deletion it already made, and
    /// that answer is what the screen shows: the account is gone, not "still
    /// here".
    func testARepeatAfterALostResponseReportsTheDeletion() async throws {
        let deleting = SequencedDeleting(results: [
            .failure(Failure.responseLost),
            .success(record),
        ])
        let cleaner = RecordingCleaner()
        let store = makeStore(deleting: deleting, cleaner: cleaner)
        await store.load()

        store.requestDeletion()
        await store.confirmDeletion()
        XCTAssertEqual(store.deletionPhase, .failed)

        store.requestDeletion()
        await store.confirmDeletion()

        XCTAssertEqual(store.deletionPhase, .idle)
        XCTAssertEqual(store.pendingDeletion, record)
        let erased = await cleaner.erasedScopes()
        XCTAssertEqual(erased, [account])
    }

    /// Whose data goes is read before the request. A request that meets a
    /// 401 refreshes the session on its way, and a refused refresh moves the
    /// session out of "authenticated": read afterwards, the scope named the
    /// guest and the account's data stayed on the device.
    func testTheAccountIsReadBeforeTheRequestChangesTheSession() async throws {
        let scopes = ScopeAfterRequest(before: account, after: previousGuest)
        let cleaner = RecordingCleaner()
        let store = AccountLifecycleStore(
            deleting: ScopeChangingDeleting(scopes: scopes, record: record),
            session: RecordingSession(),
            scopes: scopes,
            cleaner: cleaner,
            deletionState: InMemoryDeletionState()
        )
        await store.load()
        store.requestDeletion()

        await store.confirmDeletion()

        let erased = await cleaner.erasedScopes()
        XCTAssertEqual(erased, [account])
    }

    private var record: AccountDeletionRecord {
        AccountDeletionRecord(
            requestedAt: now,
            expectedCompletionAt: now.addingTimeInterval(604_800)
        )
    }

    private let previousGuest = AccountScope.guest(
        installationID: UUID(uuidString: "81000000-0000-4000-8000-0000000000e1")!
    )

    // MARK: - Harness

    private func makeStore(
        deleting: any AccountDeleting = StubDeleting(result: .failure(Failure.refused)),
        session: RecordingSession = RecordingSession(),
        cleaner: RecordingCleaner = RecordingCleaner(),
        deletionState: InMemoryDeletionState = InMemoryDeletionState(),
        guestIdentity: (any GuestIdentityRotating)? = nil
    ) -> AccountLifecycleStore {
        AccountLifecycleStore(
            deleting: deleting,
            session: session,
            scopes: FixedScopeResolver(scope: account),
            cleaner: cleaner,
            deletionState: deletionState,
            guestIdentity: guestIdentity
        )
    }

    private enum Failure: Error {
        case refused
        case responseLost
    }
}

// MARK: - Doubles

private actor StubDeleting: AccountDeleting {
    private let result: Result<AccountDeletionRecord, any Error>
    private var attemptCount = 0

    init(result: Result<AccountDeletionRecord, any Error>) {
        self.result = result
    }

    func attempts() -> Int { attemptCount }

    func deleteAccount() async throws -> AccountDeletionRecord {
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
    func signOut() async { signOuts += 1 }
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

/// Answers a scripted series, one result per attempt.
private actor SequencedDeleting: AccountDeleting {
    private var results: [Result<AccountDeletionRecord, any Error>]

    init(results: [Result<AccountDeletionRecord, any Error>]) {
        self.results = results
    }

    func deleteAccount() async throws -> AccountDeletionRecord {
        try results.removeFirst().get()
    }
}

/// Answers one scope until the request has been made, another after.
private actor ScopeAfterRequest: AccountScopeResolving {
    private let before: AccountScope
    private let after: AccountScope
    private var requested = false

    init(before: AccountScope, after: AccountScope) {
        self.before = before
        self.after = after
    }

    func markRequested() { requested = true }

    func currentScope() async -> AccountScope { requested ? after : before }
}

/// A deletion whose request moves the session, as a refused refresh does.
private struct ScopeChangingDeleting: AccountDeleting {
    let scopes: ScopeAfterRequest
    let record: AccountDeletionRecord

    func deleteAccount() async throws -> AccountDeletionRecord {
        await scopes.markRequested()
        return record
    }
}

/// Records the new guests started, and whether the session had already been
/// signed out when each one was.
private actor RecordingGuestIdentity: GuestIdentityRotating {
    private let previous: AccountScope
    private let session: RecordingSession
    private var count = 0
    private var afterSignOut = false

    init(previous: AccountScope, session: RecordingSession) {
        self.previous = previous
        self.session = session
    }

    func rotations() -> Int { count }
    func rotatedAfterSignOut() -> Bool { afterSignOut }

    func startNewGuest() async -> AccountScope {
        count += 1
        afterSignOut = await session.signOutCount() > 0
        return previous
    }
}

private actor Announced {
    private var announced = false

    func note() { announced = true }
    func wasAnnounced() -> Bool { announced }
}
