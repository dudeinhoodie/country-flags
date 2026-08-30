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

    // MARK: - Harness

    private func makeStore(
        deleting: StubDeleting = StubDeleting(result: .failure(Failure.refused)),
        session: RecordingSession = RecordingSession(),
        cleaner: RecordingCleaner = RecordingCleaner(),
        deletionState: InMemoryDeletionState = InMemoryDeletionState()
    ) -> AccountLifecycleStore {
        AccountLifecycleStore(
            deleting: deleting,
            session: session,
            scopes: FixedScopeResolver(scope: account),
            cleaner: cleaner,
            deletionState: deletionState
        )
    }

    private enum Failure: Error {
        case refused
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
