import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

private let instant = Date(timeIntervalSince1970: 1_800_000_000)

/// An authentication backend a test can steer, and which counts what it was
/// asked to do — the refresh count is what proves one rotation per storm of
/// 401s rather than one per request.
private actor StubAuthService: AuthenticationService {
    enum Behaviour: Sendable {
        case succeeds
        case refuses(APIError)
    }

    private var exchange: Behaviour
    private var refreshBehaviour: Behaviour
    private(set) var refreshCount = 0
    /// Every refresh token this service was shown, in the order it saw them.
    ///
    /// A real backend spends the token it is presented, so seeing one twice is
    /// not a detail of timing — it is the failure #392 was: the second caller
    /// presented what the first had already replaced. Recorded rather than
    /// refused, because the tests that assert the refusal path set their own
    /// behaviour and should keep deciding it.
    private(set) var presentedRefreshTokens: [String] = []
    /// The bearer each sign-out presented, in order. The backend reads the
    /// session to end from it, so a sign-out without one ends nothing.
    private(set) var loggedOutAccessTokens: [String] = []
    /// What the sign-outs answer, consumed in order; once it is empty they
    /// succeed.
    private var signOutAnswers: [Behaviour] = []
    let userID = UUID()

    init(exchange: Behaviour = .succeeds, refresh: Behaviour = .succeeds) {
        self.exchange = exchange
        refreshBehaviour = refresh
    }

    func setRefresh(_ behaviour: Behaviour) { refreshBehaviour = behaviour }

    func answerSignOuts(_ answers: Behaviour...) { signOutAnswers = answers }

    func exchange(_ credential: ProviderCredential) async throws -> AuthSessionRecord {
        switch exchange {
        case .succeeds:
            return AuthSessionRecord(
                userID: userID,
                accessToken: "access-1",
                accessTokenExpiresAt: instant,
                refreshToken: "refresh-1"
            )
        case .refuses(let error):
            throw error
        }
    }

    /// Never exercised here: a proof creates no session, so the coordinator
    /// this file tests has no part in it.
    func reauthenticate(with credential: ProviderCredential) async throws -> ReauthenticationProof {
        ReauthenticationProof(token: "proof", expiresAt: instant)
    }

    func refresh(refreshToken: String) async throws -> RefreshedSessionRecord {
        presentedRefreshTokens.append(refreshToken)
        refreshCount += 1
        switch refreshBehaviour {
        case .succeeds:
            // A rotation hands out a new pair, which is what makes presenting
            // the old refresh token a second time a refusal.
            return RefreshedSessionRecord(
                accessToken: "access-\(refreshCount + 1)",
                accessTokenExpiresAt: instant,
                refreshToken: "refresh-\(refreshCount + 1)"
            )
        case .refuses(let error):
            throw error
        }
    }

    func logout(accessToken: String) async throws {
        loggedOutAccessTokens.append(accessToken)
        guard !signOutAnswers.isEmpty else { return }
        if case .refuses(let error) = signOutAnswers.removeFirst() {
            throw error
        }
    }
}

private let refused = APIError.unauthorized(
    APIErrorDetails(
        statusCode: 401,
        code: "REFRESH_TOKEN_REVOKED",
        message: "Refused",
        requestID: nil
    )
)

private struct FixedGuestScopes: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}

final class SessionCoordinatorTests: XCTestCase {
    private let guestScope = AccountScope.guest(installationID: UUID())

    // MARK: - Signing in

    func testSigningInAdoptsTheAccountScopeAndKeepsTheRefreshTokenOutOfMemoryOnly() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)

        let outcome = await session.signIn(with: .google(idToken: String(repeating: "t", count: 40)))

        XCTAssertEqual(outcome, .succeeded(userID: service.userID))
        let state = await session.currentState()
        XCTAssertEqual(state, .authenticated(userID: service.userID))
        let scope = await session.currentScope()
        XCTAssertEqual(scope, .authenticated(userID: service.userID))
        // The refresh token is the only secret that survives the process, and
        // it lives behind the keychain boundary rather than in any store.
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertEqual(stored, "refresh-1")
        let accessToken = await session.currentAccessToken()
        XCTAssertEqual(accessToken, "access-1")
    }

    /// Cancelling is a normal outcome, and a refusal is not the same thing as
    /// being offline. The interface says something different for each.
    func testARefusedIdentityTokenIsNotReportedAsAFailureToReach() async {
        let service = StubAuthService(exchange: .refuses(refused))
        let session = makeCoordinator(service: service)

        let outcome = await session.signIn(with: .google(idToken: "t"))

        XCTAssertEqual(outcome, .failed(.rejected(code: "REFRESH_TOKEN_REVOKED")))
        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
    }

    func testAFailedSignInLeavesTheGuestScopeExactlyWhereItWas() async {
        let session = makeCoordinator(service: StubAuthService(exchange: .refuses(.transport("no"))))

        let outcome = await session.signIn(with: .google(idToken: "t"))

        XCTAssertEqual(outcome, .failed(.offline))
        let scope = await session.currentScope()
        XCTAssertEqual(scope, guestScope, "the guest kept studying under their own scope")
    }

    // MARK: - Refresh

    /// The acceptance criterion behind `TokenRefreshCoordinator`: several
    /// requests meeting a 401 together must rotate once. Every refresh after
    /// the first would present a spent token and be refused.
    func testConcurrentRefreshesRotateOnce() async throws {
        let service = StubAuthService()
        let session = makeCoordinator(service: service)
        _ = await session.signIn(with: .google(idToken: "t"))
        let refreshes = TokenRefreshCoordinator(provider: session)

        async let first = refreshes.refresh(replacing: "access-1")
        async let second = refreshes.refresh(replacing: "access-1")
        async let third = refreshes.refresh(replacing: "access-1")
        let tokens = try await [first, second, third]

        let count = await service.refreshCount
        XCTAssertEqual(count, 1)
        XCTAssertEqual(Set(tokens).count, 1, "everyone waiting got the same rotation")
    }

    /// A refused refresh ends the session. Retrying with a spent token can only
    /// be refused again, and the learner has to be told to sign in rather than
    /// left watching a spinner.
    func testARefusedRefreshExpiresTheSessionWithoutTouchingGuestData() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)
        _ = await session.signIn(with: .google(idToken: "t"))
        await service.setRefresh(.refuses(refused))

        do {
            _ = try await session.refreshAccessToken()
            XCTFail("a refused refresh has to surface")
        } catch {
            XCTAssertEqual(APIError.from(error), refused)
        }

        let state = await session.currentState()
        XCTAssertEqual(state, .authenticationExpired(userID: service.userID))
        // The spent secret is gone, and the scope falls back to the guest the
        // device was before signing in — their progress is still theirs.
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertNil(stored)
        let scope = await session.currentScope()
        XCTAssertEqual(scope, guestScope)
    }

    /// A tunnel, a lift, hotel wifi: the request fails, the session does not.
    /// Deleting the refresh token here is what signed people out for going
    /// underground — and once it is gone, no amount of signal brings it back.
    func testARefreshThatNeverReachedTheBackendKeepsTheSessionAndItsToken() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)
        _ = await session.signIn(with: .google(idToken: "t"))
        await service.setRefresh(.refuses(.transport("-1009")))

        do {
            _ = try await session.refreshAccessToken()
            XCTFail("the request still has to fail")
        } catch {
            XCTAssertEqual(APIError.from(error), .transport("-1009"))
        }

        let state = await session.currentState()
        XCTAssertEqual(state, .authenticated(userID: service.userID))
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertEqual(stored, "refresh-1", "the token was never refused, so it stays")
        let scope = await session.currentScope()
        XCTAssertEqual(scope, .authenticated(userID: service.userID))
    }

    /// A backend having a bad day is not a refusal either.
    func testAServerErrorDuringRefreshDoesNotEndTheSession() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)
        _ = await session.signIn(with: .google(idToken: "t"))
        let outage = APIError.server(
            APIErrorDetails(statusCode: 503, code: "UNAVAILABLE", message: "no", requestID: nil)
        )
        await service.setRefresh(.refuses(outage))

        _ = try? await session.refreshAccessToken()

        let state = await session.currentState()
        XCTAssertEqual(state, .authenticated(userID: service.userID))
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertEqual(stored, "refresh-1")
    }

    func testThereIsNothingToRefreshWithoutASession() async {
        let session = makeCoordinator(service: StubAuthService())

        do {
            _ = try await session.refreshAccessToken()
            XCTFail("a guest has no session to refresh")
        } catch {
            XCTAssertEqual(APIError.from(error).details?.code, "NO_SESSION")
        }
    }

    // MARK: - Relaunch

    /// A stored refresh token is an account. The app rotates it before it says
    /// anything about who is signed in, so a relaunch does not flash a
    /// signed-out interface at somebody who is not.
    func testARelaunchRestoresTheSessionFromTheStoredRefreshToken() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        try await tokens.setValue("refresh-stored", for: .refreshToken)
        try await tokens.setValue(service.userID.uuidString, for: .accountUserID)
        let session = makeCoordinator(service: service, tokens: tokens)

        await session.restore()

        let state = await session.currentState()
        XCTAssertEqual(state, .authenticated(userID: service.userID))
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertEqual(stored, "refresh-2", "the stored token rotated with the session")
    }

    func testARelaunchWithARevokedTokenReportsAnExpiredSessionRatherThanAGuest() async throws {
        let service = StubAuthService(refresh: .refuses(refused))
        let tokens = InMemoryTokenStore()
        try await tokens.setValue("refresh-stored", for: .refreshToken)
        try await tokens.setValue(service.userID.uuidString, for: .accountUserID)
        let session = makeCoordinator(service: service, tokens: tokens)

        await session.restore()

        let state = await session.currentState()
        XCTAssertEqual(
            state,
            .authenticationExpired(userID: service.userID),
            "the identifier stored beside the token says who has to sign in again"
        )
    }

    /// The bug this pair of tests exists for: a launch with no network is not
    /// a revoked token, and the app used to treat it as one — reporting an
    /// expired session to somebody whose session was perfectly good.
    func testARelaunchWithNoNetworkStaysSignedIn() async throws {
        let service = StubAuthService(refresh: .refuses(.transport("-1009")))
        let tokens = InMemoryTokenStore()
        try await tokens.setValue("refresh-stored", for: .refreshToken)
        try await tokens.setValue(service.userID.uuidString, for: .accountUserID)
        let session = makeCoordinator(service: service, tokens: tokens)

        await session.restore()

        let state = await session.currentState()
        XCTAssertEqual(state, .authenticated(userID: service.userID))
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertEqual(stored, "refresh-stored", "nothing was refused, so nothing was spent")
    }

    func testARelaunchWithNoStoredTokenIsSimplyAGuest() async {
        let session = makeCoordinator(service: StubAuthService())

        await session.restore()

        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let scope = await session.currentScope()
        XCTAssertEqual(scope, guestScope)
    }

    // MARK: - Warm start

    /// The state waits for the keychain the way the scope does. Nothing has
    /// called `restore()` here, which is exactly the first read of a warm
    /// start: the account screen asked before the launch got round to it,
    /// was told `.guest`, and kept showing the guest prompt (#452).
    func testTheStateWaitsForTheKeychainLikeTheScopeDoes() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        try await tokens.setValue("refresh-stored", for: .refreshToken)
        try await tokens.setValue(service.userID.uuidString, for: .accountUserID)
        try await tokens.setValue("Stored Learner", for: .accountDisplayName)
        let session = makeCoordinator(service: service, tokens: tokens)

        let state = await session.currentState()
        let profile = await session.currentProfile()

        XCTAssertEqual(state, .authenticated(userID: service.userID))
        XCTAssertEqual(profile?.displayName, "Stored Learner")
        let rotations = await service.refreshCount
        XCTAssertEqual(rotations, 0, "who this is is the keychain's answer, not the network's")
    }

    /// The race itself: the launch's restoration is suspended on the keychain
    /// when the screen asks. The answer waits for the read instead of
    /// reporting the guest every launch starts as.
    func testAStateReadDuringTheLaunchReadIsNotAGuest() async throws {
        let service = StubAuthService()
        let tokens = GatedTokenStore(values: [
            .refreshToken: "refresh-stored",
            .accountUserID: service.userID.uuidString,
        ])
        let session = makeCoordinator(service: service, tokens: tokens)

        let launch = Task { await session.restore() }
        await tokens.waitUntilAReadIsHeld()
        let early = Task { await session.currentState() }
        await tokens.release()

        let state = await early.value
        XCTAssertEqual(state, .authenticated(userID: service.userID))
        await launch.value
    }

    /// Now that the first state read can start the restoration, it must not
    /// undo a sign-out that came before it. A keychain that refused to delete
    /// the token would otherwise sign the person who just left back in.
    func testTheKeychainReadNeverOverrulesASignOut() async {
        let service = StubAuthService()
        let session = makeCoordinator(service: service, tokens: UndeletableTokenStore())
        _ = await session.signIn(with: .google(idToken: "t"))

        await session.signOut()

        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let scope = await session.currentScope()
        XCTAssertEqual(scope, guestScope)
    }

    // MARK: - Signing out

    /// The backend reads which session to end from the bearer. Sent without
    /// one, as it was, the request was refused and nothing ended (#436).
    func testSigningOutEndsTheSessionAndTellsTheBackendWhichOne() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)
        _ = await session.signIn(with: .google(idToken: "t"))

        await session.signOut()

        let loggedOut = await service.loggedOutAccessTokens
        XCTAssertEqual(loggedOut, ["access-1"], "the session's own bearer names it")
        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertNil(stored)
        let accessToken = await session.currentAccessToken()
        XCTAssertNil(accessToken)
    }

    /// A device that cannot reach the backend must still end up signed out
    /// locally, or it would hold a session it believes it no longer has.
    func testSigningOutSucceedsLocallyEvenWhenTheBackendCannotBeReached() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)
        _ = await session.signIn(with: .google(idToken: "t"))
        await service.answerSignOuts(.refuses(.transport("-1009")))
        await service.setRefresh(.refuses(.transport("-1009")))

        await session.signOut()

        let loggedOut = await service.loggedOutAccessTokens
        XCTAssertEqual(loggedOut, ["access-1"], "it was tried before the tokens went")
        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertNil(stored)
    }

    /// An access token that expired while the app sat in the background is
    /// the ordinary case. The auth client has no middleware to rotate it, so
    /// the session does: one rotation, one retry, with the new bearer.
    func testAStaleBearerIsRotatedOnceBeforeTheSignOutIsRetried() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)
        _ = await session.signIn(with: .google(idToken: "t"))
        await service.answerSignOuts(.refuses(refused))

        await session.signOut()

        let presented = await service.loggedOutAccessTokens
        XCTAssertEqual(presented, ["access-1", "access-2"])
        let rotations = await service.refreshCount
        XCTAssertEqual(rotations, 1)
        // The rotation wrote a new refresh token; the sign-out still takes it.
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertNil(stored)
    }

    /// A launch that could not reach the backend leaves a session with no
    /// access token in memory. The sign-out gets one first rather than going
    /// out bare and being refused.
    func testASignOutWithNoAccessTokenInHandRotatesFirst() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        try await tokens.setValue("refresh-stored", for: .refreshToken)
        try await tokens.setValue(service.userID.uuidString, for: .accountUserID)
        let session = makeCoordinator(service: service, tokens: tokens)

        await session.signOut()

        let presented = await service.loggedOutAccessTokens
        XCTAssertEqual(presented, ["access-2"])
        let rotated = await service.presentedRefreshTokens
        XCTAssertEqual(rotated, ["refresh-stored"])
        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
    }

    /// An expired session has already lost its refresh token, so there is
    /// nothing on the backend to end and nothing to rotate with: the device
    /// signs out without asking.
    func testAnExpiredSessionSignsOutWithoutCallingTheBackend() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        try await tokens.setValue(service.userID.uuidString, for: .accountUserID)
        let session = makeCoordinator(service: service, tokens: tokens)

        await session.signOut()

        let presented = await service.loggedOutAccessTokens
        XCTAssertEqual(presented, [])
        let rotations = await service.refreshCount
        XCTAssertEqual(rotations, 0)
        let account = try await tokens.value(for: .accountUserID)
        XCTAssertNil(account)
    }

    /// The launch has two doors to a rotation and neither may present a
    /// token the other has spent.
    ///
    /// `restore()` refreshes at launch; the first request of that same launch
    /// meets a 401 and refreshes through the middleware. A refresh spends the
    /// token it presents, so the second call carried what the first had just
    /// replaced, was refused, and ended the session — signed out on every
    /// launch (#392). The middleware's own coordinator cannot see this,
    /// because one of the two doors is not the middleware's.
    ///
    /// This used to assert that the launch made exactly one refresh call, and
    /// that assertion was a coin flip: `async let` starts both doors but does
    /// not make them overlap, and two calls that do not overlap are two honest
    /// rotations presenting two different tokens. It failed roughly one run in
    /// three and cost a CI run every time — including one that skipped the UI
    /// suite entirely.
    ///
    /// What is actually wrong, in every interleaving, is presenting a token
    /// twice. That is the property, so that is what is asserted: it cannot
    /// fail for scheduling, and it cannot pass while #392 is back.
    func testALaunchNeverPresentsARefreshTokenTwice() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        try await tokens.setValue("refresh-stored", for: .refreshToken)
        try await tokens.setValue(UUID().uuidString, for: .accountUserID)
        let session = makeCoordinator(service: service, tokens: tokens)

        async let restored: Void = session.restore()
        async let refreshed = session.refreshAccessToken()
        _ = await restored
        _ = try await refreshed

        let presented = await service.presentedRefreshTokens
        XCTAssertEqual(
            presented.count,
            Set(presented).count,
            "a spent refresh token must never be presented again: \(presented)"
        )
        XCTAssertFalse(presented.isEmpty, "the launch refreshed nothing at all")
    }

    // MARK: - A keychain that refuses

    /// The failure behind #392: the keychain refuses, the sign-in looks
    /// perfect because the access token is in memory, and the next launch
    /// reads a refresh token the server has already spent. Written with
    /// `try?`, that happened without a line in the log to say why — and the
    /// person signed out every launch with nothing to explain it.
    func testASignInThatCannotBeWrittenDownSaysSoRatherThanLookingFine() async {
        let logger = RecordingLogger()
        let service = StubAuthService()
        let session = SessionCoordinator(
            service: service,
            tokens: RefusingTokenStore(),
            guestScopes: FixedGuestScopes(scope: guestScope),
            logger: logger
        )

        let outcome = await session.signIn(with: .google(idToken: "t"))

        // The sign-in itself succeeded: the server accepted the identity, and
        // pretending otherwise would be its own lie.
        XCTAssertEqual(outcome, .succeeded(userID: service.userID))
        let transcript = logger.transcript
        XCTAssertTrue(
            transcript.contains("could not be written to the keychain"),
            "a session that will not survive a relaunch has to be reported"
        )
        XCTAssertTrue(
            transcript.contains("will not survive a relaunch"),
            "the consequence is the part that explains tomorrow's report"
        )
        // The status is what separates a locked keychain from a missing
        // entitlement, and it is the first thing anyone reading this asks.
        XCTAssertTrue(transcript.contains("-34018"))
    }

    /// The graver direction. The interface says signed out and the refresh
    /// token is still on disk, so the next launch restores the session of
    /// somebody who asked to leave.
    func testASignOutThatCannotClearTheKeychainIsReportedAndStillDropsMemory() async {
        let logger = RecordingLogger()
        let session = SessionCoordinator(
            service: StubAuthService(),
            tokens: RefusingTokenStore(),
            guestScopes: FixedGuestScopes(scope: guestScope),
            logger: logger
        )
        _ = await session.signIn(with: .google(idToken: "t"))

        await session.signOut()

        let state = await session.currentState()
        XCTAssertEqual(state, .guest, "this process must not go on holding it")
        let accessToken = await session.currentAccessToken()
        XCTAssertNil(accessToken)
        XCTAssertTrue(
            logger.transcript.contains("left session material on the device"),
            "a sign-out that did not remove the token is not a sign-out"
        )
    }

    private func makeCoordinator(
        service: any AuthenticationService,
        tokens: any SecureTokenStoring = InMemoryTokenStore()
    ) -> SessionCoordinator {
        SessionCoordinator(
            service: service,
            tokens: tokens,
            guestScopes: FixedGuestScopes(scope: guestScope),
            logger: NoOpLogger()
        )
    }
}

/// A keychain that answers every write with the status a device gives when
/// the app carries no keychain entitlement. Reads answer nothing, which is
/// what a store that never accepted a write would hold.
private actor RefusingTokenStore: SecureTokenStoring {
    func value(for kind: SecureTokenKind) async throws -> String? { nil }

    func setValue(_ value: String?, for kind: SecureTokenKind) async throws {
        throw SecureTokenStoreError.unavailable(status: -34018)
    }

    func removeAll() async throws {
        throw SecureTokenStoreError.unavailable(status: -34018)
    }
}

/// Holds every read until released, so a test can ask a question while the
/// launch is suspended on the keychain.
private actor GatedTokenStore: SecureTokenStoring {
    private var values: [SecureTokenKind: String]
    private var isOpen = false
    private var held: [CheckedContinuation<Void, Never>] = []
    private var watchers: [CheckedContinuation<Void, Never>] = []

    init(values: [SecureTokenKind: String]) {
        self.values = values
    }

    func value(for kind: SecureTokenKind) async throws -> String? {
        if !isOpen {
            await withCheckedContinuation { continuation in
                held.append(continuation)
                watchers.forEach { $0.resume() }
                watchers.removeAll()
            }
        }
        return values[kind]
    }

    func setValue(_ value: String?, for kind: SecureTokenKind) async throws {
        values[kind] = value
    }

    func removeAll() async throws {
        values.removeAll()
    }

    func waitUntilAReadIsHeld() async {
        guard held.isEmpty else { return }
        await withCheckedContinuation { watchers.append($0) }
    }

    func release() {
        isOpen = true
        held.forEach { $0.resume() }
        held.removeAll()
    }
}

/// Accepts every write but a deletion, the way a keychain that has lost its
/// access group can: the values stay on disk after a sign-out asked for them
/// to go.
private actor UndeletableTokenStore: SecureTokenStoring {
    private var values: [SecureTokenKind: String] = [:]

    func value(for kind: SecureTokenKind) async throws -> String? { values[kind] }

    func setValue(_ value: String?, for kind: SecureTokenKind) async throws {
        guard let value else { throw SecureTokenStoreError.unavailable(status: -25300) }
        values[kind] = value
    }

    func removeAll() async throws {
        throw SecureTokenStoreError.unavailable(status: -25300)
    }
}
