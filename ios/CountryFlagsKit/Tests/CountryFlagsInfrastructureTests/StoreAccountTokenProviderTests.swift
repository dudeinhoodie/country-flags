import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// What the app is willing to tell Apple about whose purchase this is.
///
/// The token names our account and nothing in the store, so the questions
/// worth asking are about restraint: is it asked for once rather than on every
/// purchase, is a guest asked at all, and does a backend that could not be
/// reached produce silence rather than a guess.
final class StoreAccountTokenProviderTests: XCTestCase {

    private static let token = UUID(uuidString: "3f9a1c2e-0d44-4f7b-9a1e-6c2b8d5e4f01")!

    func testTheProfileNamesTheAccountAPurchaseIsMadeUnder() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.profile(token: Self.token.uuidString)), for: "getMe")

        let provider = makeProvider(transport, scope: CommerceFixtures.userScope)

        let answer = await provider.storeAccountToken()

        XCTAssertEqual(answer, Self.token)
    }

    /// Once per account, not once per purchase: the token is minted once and
    /// stable for the life of the account, so asking again buys nothing and
    /// costs a round trip in front of the buy button.
    func testTheAnswerIsRememberedForAsLongAsTheAccountIs() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.profile(token: Self.token.uuidString)), for: "getMe")
        let provider = makeProvider(transport, scope: CommerceFixtures.userScope)

        let first = await provider.storeAccountToken()
        let second = await provider.storeAccountToken()

        XCTAssertEqual(first, Self.token)
        XCTAssertEqual(second, Self.token)
        let requests = await transport.requests(for: "getMe")
        XCTAssertEqual(requests.count, 1)
    }

    /// A guest owns nothing and buys nothing, and `GET /v1/me` would refuse the
    /// request. Asking is a round trip to be told so.
    func testAGuestIsNeverAsked() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.profile(token: Self.token.uuidString)), for: "getMe")
        let provider = makeProvider(transport, scope: CommerceFixtures.guestScope)

        let answer = await provider.storeAccountToken()

        XCTAssertNil(answer)
        let requests = await transport.requests(for: "getMe")
        XCTAssertTrue(requests.isEmpty)
    }

    /// An account the backend says has no token is a settled answer, not a
    /// missing one.
    func testAProfileWithNoTokenIsAnAnswerAndNotAGap() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(Self.profile(token: nil)), for: "getMe")
        let provider = makeProvider(transport, scope: CommerceFixtures.userScope)

        let first = await provider.storeAccountToken()
        let second = await provider.storeAccountToken()

        XCTAssertNil(first)
        XCTAssertNil(second)
        let requests = await transport.requests(for: "getMe")
        XCTAssertEqual(requests.count, 1)
    }

    /// A request the radio dropped is not an account without a token. The
    /// purchase goes ahead carrying none — it is still attributed by the
    /// authenticated submission — and the next one asks again.
    func testAnUnreachableProfileIsSilenceRatherThanAnAnswer() async throws {
        let transport = MockClientTransport()
        await transport.always(.init(statusCode: 503), for: "getMe")
        let provider = makeProvider(transport, scope: CommerceFixtures.userScope)

        let first = await provider.storeAccountToken()
        XCTAssertNil(first)

        await transport.always(.json(Self.profile(token: Self.token.uuidString)), for: "getMe")
        let second = await provider.storeAccountToken()

        XCTAssertEqual(second, Self.token)
    }

    // MARK: - Support

    private func makeProvider(
        _ transport: MockClientTransport,
        scope: AccountScope
    ) -> StoreAccountTokenProvider {
        StoreAccountTokenProvider(
            clientFactory: APIClientFactory(
                configuration: APITestClient.configuration,
                transport: transport,
                identifiers: SequentialIdentifierProvider(),
                retryPolicy: RetryPolicy(maximumAttempts: 1),
                scheduler: RecordingBackoffScheduler(),
                jitter: ZeroJitterProvider()
            ),
            scopes: FixedCommerceScopes(scope: scope)
        )
    }

    private static func profile(token: String?) -> String {
        let value = token.map { "\"\($0)\"" } ?? "null"
        return """
            {"id":"9f1d7c64-3a2b-4c8d-9e5f-1a2b3c4d5e6f","displayName":"Anna",\
            "preferredLocale":"en","status":"ACTIVE","storeAccountToken":\(value),\
            "createdAt":"2026-09-01T10:00:00Z","updatedAt":"2026-09-06T10:00:00Z"}
            """
    }
}
