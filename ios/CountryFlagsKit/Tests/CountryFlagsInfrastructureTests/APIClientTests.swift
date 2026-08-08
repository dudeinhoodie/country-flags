import XCTest

@testable import CountryFlagsInfrastructure

final class APIClientHeaderTests: XCTestCase {
    func testEveryRequestCarriesTheClientContext() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(appConfigJSON), for: "getAppConfig")
        let client = APITestClient.make(transport: transport)

        _ = try await client.getAppConfig(APITestClient.appConfigInput())

        let recorded = await transport.requests(for: "getAppConfig")
        let request = try XCTUnwrap(recorded.first)
        XCTAssertEqual(request.header("x-client-platform"), "ios")
        XCTAssertEqual(request.header("x-client-app-version"), "1.2.3")
        XCTAssertEqual(request.header("x-client-locale"), "ru-RU")
        XCTAssertEqual(request.header("x-client-template-schema-versions"), "1,2")
        XCTAssertEqual(request.header("accept-language"), "ru-RU")

        // The backend accepts a valid UUID and echoes it back, which is what
        // makes the identifier usable in a support report.
        let requestID = try XCTUnwrap(request.header("x-request-id"))
        XCTAssertNotNil(UUID(uuidString: requestID))
    }

    func testGuestRequestsCarryNoAuthorization() async throws {
        let transport = MockClientTransport()
        await transport.always(.json(appConfigJSON), for: "getAppConfig")
        let client = APITestClient.make(transport: transport)

        _ = try await client.getAppConfig(APITestClient.appConfigInput())

        let recorded = await transport.requests(for: "getAppConfig")
        let request = try XCTUnwrap(recorded.first)
        XCTAssertNil(request.header("authorization"))
    }
}

final class APIErrorMappingTests: XCTestCase {
    /// Every documented failure has to arrive as one stable domain error.
    func testMapsStatusCodesToDomainErrors() async throws {
        let expectations: [(Int, String, (APIError) -> Bool)] = [
            (401, "UNAUTHORIZED", { if case .unauthorized = $0 { true } else { false } }),
            (403, "FORBIDDEN", { if case .forbidden = $0 { true } else { false } }),
            (404, "RESOURCE_NOT_FOUND", { if case .notFound = $0 { true } else { false } }),
            (409, "IDEMPOTENCY_CONFLICT", { if case .conflict = $0 { true } else { false } }),
            (422, "VALIDATION_FAILED", { if case .validationFailed = $0 { true } else { false } }),
            (500, "INTERNAL_ERROR", { if case .server = $0 { true } else { false } }),
        ]

        for (statusCode, code, matches) in expectations {
            let transport = MockClientTransport()
            await transport.always(
                .errorEnvelope(statusCode: statusCode, code: code),
                for: "getAppConfig"
            )
            // A single attempt keeps the assertion about mapping only.
            let client = APITestClient.make(
                transport: transport,
                retryPolicy: RetryPolicy(maximumAttempts: 1)
            )

            do {
                _ = try await client.getAppConfig(APITestClient.appConfigInput())
                XCTFail("\(statusCode) must not be reported as success")
            } catch {
                let apiError = APIError.from(error)
                XCTAssertTrue(matches(apiError), "\(statusCode) produced \(apiError)")
                XCTAssertEqual(apiError.details?.statusCode, statusCode)
                XCTAssertEqual(apiError.details?.code, code)
                XCTAssertEqual(
                    apiError.supportRequestID,
                    "00000000-0000-4000-8000-000000000000"
                )
            }
        }
    }

    func testRateLimitCarriesTheServerRetryDelay() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(
                statusCode: 429,
                code: "RATE_LIMIT_EXCEEDED",
                headerFields: ["retry-after": "7"]
            ),
            for: "getAppConfig"
        )
        let client = APITestClient.make(
            transport: transport,
            retryPolicy: RetryPolicy(maximumAttempts: 1)
        )

        do {
            _ = try await client.getAppConfig(APITestClient.appConfigInput())
            XCTFail("429 must not be reported as success")
        } catch {
            guard case .rateLimited(let details, let retryAfter) = APIError.from(error) else {
                return XCTFail("unexpected error: \(error)")
            }
            XCTAssertEqual(details.code, "RATE_LIMIT_EXCEEDED")
            XCTAssertEqual(retryAfter, .seconds(7))
        }
    }

    /// A gateway can fail a request before the application writes an envelope.
    func testFallsBackToTheResponseHeaderForTheRequestIdentifier() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .init(
                statusCode: 502,
                headerFields: ["x-request-id": "11111111-1111-4111-8111-111111111111"],
                body: Data("<html>gateway</html>".utf8)
            ),
            for: "getAppConfig"
        )
        let client = APITestClient.make(
            transport: transport,
            retryPolicy: RetryPolicy(maximumAttempts: 1)
        )

        do {
            _ = try await client.getAppConfig(APITestClient.appConfigInput())
            XCTFail("502 must not be reported as success")
        } catch {
            let apiError = APIError.from(error)
            XCTAssertEqual(apiError.details?.code, "UNKNOWN")
            XCTAssertEqual(
                apiError.supportRequestID,
                "11111111-1111-4111-8111-111111111111"
            )
        }
    }
}

final class APIRedactionTests: XCTestCase {
    /// The log type has no field for a header or a body, and this proves the
    /// values that do reach it carry no secret.
    func testLogsCarryNoTokenAndNoBody() async throws {
        let secretToken = "super-secret-access-token-value"
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 409, code: "IDEMPOTENCY_CONFLICT"),
            for: "completeStudySession"
        )
        let logger = RecordingAPILogger()
        let client = APITestClient.make(
            transport: transport,
            tokens: StubTokenProvider(initialToken: secretToken, refreshedToken: nil),
            logger: logger,
            retryPolicy: RetryPolicy(maximumAttempts: 1)
        )

        _ = try? await client.completeStudySession(APITestClient.completeSessionInput())

        let text = logger.renderedText
        XCTAssertFalse(text.isEmpty, "the request was not logged at all")
        XCTAssertFalse(text.contains(secretToken))
        XCTAssertFalse(text.contains("Bearer"))
        XCTAssertFalse(text.contains("completedAt"))

        let entry = try XCTUnwrap(logger.entries.first)
        XCTAssertEqual(entry.operationID, "completeStudySession")
        XCTAssertEqual(entry.statusCode, 409)
        XCTAssertEqual(entry.errorCode, "IDEMPOTENCY_CONFLICT")
        XCTAssertNotNil(entry.requestID)
        // The path identifies the endpoint; a query string never reaches here.
        XCTAssertFalse(entry.path.contains("?"))
    }
}

private let appConfigJSON = TestFixtures.appConfigJSON
