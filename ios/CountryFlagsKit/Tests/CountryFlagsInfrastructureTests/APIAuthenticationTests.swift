import XCTest

@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

final class APIAuthenticationTests: XCTestCase {
    func testAuthenticatedRequestCarriesTheBearerToken() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(TestFixtures.appConfigJSON), for: "getAppConfig")
        let client = APITestClient.make(
            transport: transport,
            tokens: StubTokenProvider(initialToken: "access-1", refreshedToken: "access-2")
        )

        _ = try await client.getAppConfig(APITestClient.appConfigInput())

        let recorded = await transport.requests(for: "getAppConfig")
        let request = try XCTUnwrap(recorded.first)
        XCTAssertEqual(request.header("authorization"), "Bearer access-1")
    }

    func testExpiredTokenIsRefreshedAndTheRequestIsRepeatedOnce() async throws {
        let transport = MockClientTransport()
        await transport.enqueue(
            .errorEnvelope(statusCode: 401, code: "ACCESS_TOKEN_EXPIRED"),
            .json(TestFixtures.appConfigJSON),
            for: "getAppConfig"
        )
        let tokens = StubTokenProvider(initialToken: "expired", refreshedToken: "fresh")
        let client = APITestClient.make(transport: transport, tokens: tokens)

        _ = try await client.getAppConfig(APITestClient.appConfigInput())

        let requests = await transport.requests(for: "getAppConfig")
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].header("authorization"), "Bearer expired")
        XCTAssertEqual(requests[1].header("authorization"), "Bearer fresh")
        await XCTAssertEqualAsync(await tokens.observedRefreshCount(), 1)
    }

    /// A second 401 after a refresh means the session is genuinely gone; another
    /// attempt would only turn that into a loop.
    func testASecondRejectionIsNotRetriedAgain() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 401, code: "ACCESS_TOKEN_EXPIRED"),
            for: "getAppConfig"
        )
        let tokens = StubTokenProvider(initialToken: "expired", refreshedToken: "fresh")
        let client = APITestClient.make(transport: transport, tokens: tokens)

        do {
            _ = try await client.getAppConfig(APITestClient.appConfigInput())
            XCTFail("a rejected session must surface as unauthorized")
        } catch {
            guard case .unauthorized = APIError.from(error) else {
                return XCTFail("unexpected error: \(error)")
            }
        }
        let attempts = await transport.requests(for: "getAppConfig").count
        XCTAssertEqual(attempts, 2)
        await XCTAssertEqualAsync(await tokens.observedRefreshCount(), 1)
    }

    func testFailedRefreshSurfacesTheOriginalRejection() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 401, code: "ACCESS_TOKEN_EXPIRED"),
            for: "getAppConfig"
        )
        // A nil refreshed token makes the provider throw.
        let tokens = StubTokenProvider(initialToken: "expired", refreshedToken: nil)
        let client = APITestClient.make(transport: transport, tokens: tokens)

        do {
            _ = try await client.getAppConfig(APITestClient.appConfigInput())
            XCTFail("a failed refresh must not be reported as success")
        } catch {
            guard case .unauthorized(let details) = APIError.from(error) else {
                return XCTFail("unexpected error: \(error)")
            }
            XCTAssertEqual(details.code, "ACCESS_TOKEN_EXPIRED")
        }
        // The request was not repeated: there was no fresh token to repeat with.
        let attempts = await transport.requests(for: "getAppConfig").count
        XCTAssertEqual(attempts, 1)
    }

    /// Every request that meets a 401 at the same time must share one refresh.
    /// A second refresh would present an already rotated refresh token and the
    /// backend would reject it, logging everyone out.
    func testConcurrentRejectionsTriggerASingleRefresh() async throws {
        let parallelRequests = 8
        let transport = MockClientTransport()
        for _ in 0..<parallelRequests {
            await transport.enqueue(
                .errorEnvelope(statusCode: 401, code: "ACCESS_TOKEN_EXPIRED"),
                for: "getAppConfig"
            )
        }
        await transport.always(.json(TestFixtures.appConfigJSON), for: "getAppConfig")
        let tokens = StubTokenProvider(
            initialToken: "expired",
            refreshedToken: "fresh",
            // A slow refresh guarantees the requests overlap instead of
            // finishing one after another by accident.
            delay: .milliseconds(50)
        )
        let client = APITestClient.make(transport: transport, tokens: tokens)

        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<parallelRequests {
                group.addTask {
                    _ = try await client.getAppConfig(APITestClient.appConfigInput())
                }
            }
            try await group.waitForAll()
        }

        await XCTAssertEqualAsync(await tokens.observedRefreshCount(), 1)
        let requests = await transport.requests(for: "getAppConfig")
        // Each request was sent once with the stale token and once with the
        // fresh one; nothing was sent a third time.
        XCTAssertEqual(requests.count, parallelRequests * 2)
        XCTAssertEqual(
            requests.filter { $0.header("authorization") == "Bearer fresh" }.count,
            parallelRequests
        )
    }
}

/// `XCTAssertEqual` cannot await its arguments, and inlining the await would
/// hide which value failed.
func XCTAssertEqualAsync<T: Equatable>(
    _ actual: @autoclosure () async throws -> T,
    _ expected: T,
    file: StaticString = #filePath,
    line: UInt = #line
) async rethrows {
    let value = try await actual()
    XCTAssertEqual(value, expected, file: file, line: line)
}
