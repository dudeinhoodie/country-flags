import XCTest

@testable import CountryFlagsDomain

final class AuthenticationStateTests: XCTestCase {
    /// Signing in is an offer, never a gate: the guest flow stays available in
    /// every state, including after a session expired.
    func testStudyingIsAllowedInEveryState() {
        let states: [AuthenticationState] = [
            .guest,
            .authenticating(.apple),
            .authenticated(userID: UUID()),
            .authenticationExpired(userID: UUID()),
        ]

        for state in states {
            XCTAssertTrue(state.allowsGuestStudy, "\(state)")
        }
    }

    func testOnlyAnActiveSessionCountsAsAuthenticated() {
        XCTAssertTrue(AuthenticationState.authenticated(userID: UUID()).isAuthenticated)
        XCTAssertFalse(AuthenticationState.guest.isAuthenticated)
        XCTAssertFalse(AuthenticationState.authenticating(.google).isAuthenticated)
        // An expired session knows who it belonged to but cannot act as them.
        XCTAssertFalse(AuthenticationState.authenticationExpired(userID: UUID()).isAuthenticated)
    }

    /// Dismissing the sheet is a normal outcome. Reporting it as an error would
    /// tell the user something broke when they simply changed their mind.
    func testCancellationIsDistinctFromFailure() {
        let cancelled = SignInOutcome.cancelled
        let failed = SignInOutcome.failed(.provider(code: "UNKNOWN"))

        XCTAssertNotEqual(cancelled, failed)
        if case .failed = cancelled { XCTFail("Cancellation must not be a failure") }
    }

    /// A backend that refused the identity token will refuse it again; offering
    /// a retry there would loop the user through the same sheet.
    func testOnlySomeSignInFailuresAreWorthRetrying() {
        XCTAssertTrue(SignInFailure.offline.isRetryable)
        XCTAssertTrue(SignInFailure.provider(code: "CANCELLED_BY_SYSTEM").isRetryable)
        XCTAssertFalse(SignInFailure.rejected(code: "INVALID_TOKEN").isRetryable)
    }
}

final class GuestMigrationPolicyTests: XCTestCase {
    private let guestScope = AccountScope.guest(installationID: UUID())
    private let user = UUID(uuidString: "90000000-0000-4000-8000-000000000001")!
    private let otherUser = UUID(uuidString: "90000000-0000-4000-8000-000000000002")!

    func testAFreshGuestArchiveCanBeImported() {
        let result = GuestMigrationPolicy.canImport(
            guestScope: guestScope,
            previousOwner: nil,
            targetUserID: user,
            hasWork: true
        )

        XCTAssertNoThrow(try result.get())
    }

    /// Devices are shared more often than product discussions assume. A guest
    /// archive already claimed by one account must never land in another.
    func testAnArchiveClaimedByAnotherAccountIsRefused() {
        let result = GuestMigrationPolicy.canImport(
            guestScope: guestScope,
            previousOwner: otherUser,
            targetUserID: user,
            hasWork: true
        )

        XCTAssertEqual(Self.refusal(result), .scopeBelongsToAnotherAccount)
    }

    /// The same person signing in again may re-import: the identifier is stable
    /// and the backend recognises the repeat.
    func testTheSameOwnerMayImportAgain() {
        let result = GuestMigrationPolicy.canImport(
            guestScope: guestScope,
            previousOwner: user,
            targetUserID: user,
            hasWork: true
        )

        XCTAssertNoThrow(try result.get())
    }

    func testAnAuthenticatedScopeIsNotAGuestArchive() {
        let result = GuestMigrationPolicy.canImport(
            guestScope: .authenticated(userID: otherUser),
            previousOwner: nil,
            targetUserID: user,
            hasWork: true
        )

        XCTAssertEqual(Self.refusal(result), .scopeBelongsToAnotherAccount)
    }

    func testAnEmptyArchiveIsNotImported() {
        let result = GuestMigrationPolicy.canImport(
            guestScope: guestScope,
            previousOwner: nil,
            targetUserID: user,
            hasWork: false
        )

        XCTAssertEqual(Self.refusal(result), .nothingToImport)
    }

    private static func refusal(_ result: Result<Void, GuestMigrationRefusal>) -> GuestMigrationRefusal? {
        if case .failure(let refusal) = result { return refusal }
        return nil
    }
}

final class GuestMigrationRecordTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    /// Guest data survives until the backend says it has it. Cleaning up on
    /// submission would lose the work if the import never landed.
    func testSourceDataIsKeptUntilTheBackendAcknowledges() {
        XCTAssertFalse(Self.record(state: .inProgress, acknowledged: nil).mayArchiveSourceScope)
        XCTAssertFalse(Self.record(state: .completed, acknowledged: nil).mayArchiveSourceScope)
        XCTAssertFalse(Self.record(state: .failed, acknowledged: now).mayArchiveSourceScope)
        XCTAssertTrue(Self.record(state: .completed, acknowledged: now).mayArchiveSourceScope)
    }

    private static func record(
        state: GuestMigrationState,
        acknowledged: Date?
    ) -> GuestMigrationRecord {
        GuestMigrationRecord(
            migrationID: UUID(),
            sourceScopeKey: "guest:abc",
            targetUserID: UUID(),
            state: state,
            startedAt: Date(timeIntervalSince1970: 1_800_000_000),
            acknowledgedAt: acknowledged
        )
    }
}

final class SignOutAssessmentTests: XCTestCase {
    /// Signing out with unsent answers would strand them under a scope the
    /// device can no longer authenticate. That is the user's call to make.
    func testUnsyncedWorkRequiresAWarning() {
        XCTAssertTrue(SignOutAssessment(unsyncedCount: 1).requiresWarning)
        XCTAssertFalse(SignOutAssessment(unsyncedCount: 0).requiresWarning)
    }
}
