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
    private(set) var loggedOutRefreshTokens: [String] = []
    private(set) var didLogOutEverywhere = false
    let userID = UUID()

    init(exchange: Behaviour = .succeeds, refresh: Behaviour = .succeeds) {
        self.exchange = exchange
        refreshBehaviour = refresh
    }

    func setRefresh(_ behaviour: Behaviour) { refreshBehaviour = behaviour }

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

    func refresh(refreshToken: String) async throws -> RefreshedSessionRecord {
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

    func logout(refreshToken: String) async throws {
        loggedOutRefreshTokens.append(refreshToken)
    }

    func logoutEverywhere() async throws { didLogOutEverywhere = true }
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
        XCTAssertEqual(state, .authenticationExpired(userID: nil))
    }

    func testARelaunchWithNoStoredTokenIsSimplyAGuest() async {
        let session = makeCoordinator(service: StubAuthService())

        await session.restore()

        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let scope = await session.currentScope()
        XCTAssertEqual(scope, guestScope)
    }

    // MARK: - Signing out

    func testSigningOutEndsTheSessionAndTellsTheBackendWhichOne() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)
        _ = await session.signIn(with: .google(idToken: "t"))

        await session.signOut(everywhere: false)

        let loggedOut = await service.loggedOutRefreshTokens
        XCTAssertEqual(loggedOut, ["refresh-1"])
        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertNil(stored)
        let accessToken = await session.currentAccessToken()
        XCTAssertNil(accessToken)
    }

    /// The answer to a lost phone: the other devices lose their sessions too.
    func testSigningOutEverywhereEndsTheOtherDevicesToo() async {
        let service = StubAuthService()
        let session = makeCoordinator(service: service)
        _ = await session.signIn(with: .google(idToken: "t"))

        await session.signOut(everywhere: true)

        let everywhere = await service.didLogOutEverywhere
        XCTAssertTrue(everywhere)
    }

    /// A device that cannot reach the backend must still end up signed out
    /// locally, or it would hold a session it believes it no longer has.
    func testSigningOutSucceedsLocallyEvenWhenTheBackendCannotBeReached() async throws {
        let service = StubAuthService()
        let tokens = InMemoryTokenStore()
        let session = makeCoordinator(service: service, tokens: tokens)
        _ = await session.signIn(with: .google(idToken: "t"))
        await service.setRefresh(.refuses(.transport("no")))

        await session.signOut(everywhere: false)

        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertNil(stored)
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
