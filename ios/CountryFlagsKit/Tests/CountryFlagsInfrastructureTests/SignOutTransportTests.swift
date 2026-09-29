import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// The sign-out as it leaves the device: the session, the auth service, the
/// client and its middleware, down to a transport that guards the route the
/// way the backend does.
///
/// The coordinator's own tests stub the service, which is exactly the layer
/// that was wrong (#436): the request went out without a bearer, every one
/// was refused, and nothing above the transport could tell.
final class SignOutTransportTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let signedInBearer = "Bearer mock-access-token-0123456789abcdef0123"
    private let rotatedBearer = "Bearer mock-access-token-rotated-0123456789abc"

    func testASignOutCarriesTheSessionsBearerAndNoRefreshToken() async throws {
        let transport = makeTransport()
        let tokens = InMemoryTokenStore()
        let session = makeSession(transport: transport, tokens: tokens)
        _ = await session.signIn(with: credential)

        await session.signOut()

        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let requests = await transport.requests(for: "logout")
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.header("authorization"), signedInBearer)
        // The bearer names the session. A refresh token beside it is one more
        // secret on the wire and one more way to be refused after a rotation.
        let body = requests.first?.body.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        XCTAssertFalse(body.contains("refreshToken"), body)
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertNil(stored)
    }

    /// A sign-out is this device's business first: no network, and the device
    /// is signed out all the same.
    func testASignOutWithNoNetworkStillSignsTheDeviceOut() async throws {
        let transport = makeTransport()
        await transport.enqueue(
            .transportFailure(URLError(.notConnectedToInternet)),
            for: "logout"
        )
        let tokens = InMemoryTokenStore()
        let session = makeSession(transport: transport, tokens: tokens)
        _ = await session.signIn(with: credential)

        await session.signOut()

        let requests = await transport.requests(for: "logout")
        XCTAssertEqual(requests.count, 1, "it was tried, with the bearer")
        let state = await session.currentState()
        XCTAssertEqual(state, .guest)
        let stored = try await tokens.value(for: .refreshToken)
        XCTAssertNil(stored)
    }

    /// The bearer expired while the app was in the background: the backend
    /// refuses it, the session rotates once, and the sign-out goes again with
    /// the new one.
    func testAnExpiredBearerIsRotatedAndTheSignOutRetried() async {
        let transport = makeTransport()
        await transport.enqueue(
            .errorEnvelope(statusCode: 401, code: "UNAUTHORIZED"),
            for: "logout"
        )
        let session = makeSession(transport: transport)
        _ = await session.signIn(with: credential)

        await session.signOut()

        let requests = await transport.requests(for: "logout")
        XCTAssertEqual(
            requests.map { $0.header("authorization") },
            [signedInBearer, rotatedBearer]
        )
        let rotations = await transport.requests(for: "refreshSession")
        XCTAssertEqual(rotations.count, 1)
    }

    // MARK: - Assembly

    private var credential: ProviderCredential {
        .google(idToken: String(repeating: "t", count: 40))
    }

    /// The routes the sign-in and the sign-out touch, answered as the Mock
    /// build answers them, including the guard on the sign-out.
    private func makeTransport() -> MockClientTransport {
        MockClientTransport(
            fallbacks: [
                "authenticateWithGoogle": MockAuth.session(now: now),
                "refreshSession": MockAuth.refreshedTokens(now: now),
            ],
            handlers: MockAuth.logoutHandlers()
        )
    }

    private func makeSession(
        transport: MockClientTransport,
        tokens: any SecureTokenStoring = InMemoryTokenStore()
    ) -> SessionCoordinator {
        // Built the way the composition builds it: no token provider on the
        // auth client, so whatever bearer arrives is the session's own.
        let factory = APIClientFactory(
            configuration: APITestClient.configuration,
            transport: transport,
            identifiers: SequentialIdentifierProvider(),
            logger: NoOpAPIRequestLogger(),
            retryPolicy: RetryPolicy(maximumAttempts: 1),
            scheduler: RecordingBackoffScheduler(),
            jitter: ZeroJitterProvider()
        )
        return SessionCoordinator(
            service: AuthService(
                clientFactory: factory,
                devices: InstallationDeviceRegistration(tokens: tokens, appVersion: "1.2.3")
            ),
            tokens: tokens,
            guestScopes: GuestOnlyScopes(),
            logger: NoOpLogger()
        )
    }
}

private struct GuestOnlyScopes: AccountScopeResolving {
    func currentScope() async -> AccountScope {
        .guest(installationID: UUID(uuidString: "10000000-0000-4000-8000-000000000436")!)
    }
}
