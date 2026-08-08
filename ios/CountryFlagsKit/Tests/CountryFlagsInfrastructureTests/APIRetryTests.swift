import XCTest

@testable import CountryFlagsInfrastructure

final class APIRetryTests: XCTestCase {
    func testIdempotentRequestIsRetriedUntilItSucceeds() async throws {
        let transport = MockClientTransport()
        await transport.enqueue(
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            .errorEnvelope(statusCode: 500, code: "INTERNAL_ERROR"),
            .json(appConfigJSON),
            for: "getAppConfig"
        )
        let scheduler = RecordingBackoffScheduler()
        let client = APITestClient.make(transport: transport, scheduler: scheduler)

        _ = try await client.getAppConfig(APITestClient.appConfigInput())

        let attempts = await transport.requests(for: "getAppConfig").count
        XCTAssertEqual(attempts, 3)
        // Bounded exponential growth: 300ms then 600ms, jitter pinned to zero.
        let delays = await scheduler.recordedDelays()
        XCTAssertEqual(delays, [.milliseconds(300), .milliseconds(600)])
    }

    func testRetryStopsAtTheAttemptLimit() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 500, code: "INTERNAL_ERROR"),
            for: "getAppConfig"
        )
        let client = APITestClient.make(
            transport: transport,
            retryPolicy: RetryPolicy(maximumAttempts: 2)
        )

        do {
            _ = try await client.getAppConfig(APITestClient.appConfigInput())
            XCTFail("an exhausted retry must surface the failure")
        } catch {
            guard case .server = APIError.from(error) else {
                return XCTFail("unexpected error: \(error)")
            }
        }
        let attempts = await transport.requests(for: "getAppConfig").count
        XCTAssertEqual(attempts, 2)
    }

    /// Repeating a write the contract does not deduplicate could create a
    /// second export the user never asked for.
    func testWriteWithoutAnIdempotencyContractIsSentOnce() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            for: "createDataExport"
        )
        let scheduler = RecordingBackoffScheduler()
        let client = APITestClient.make(transport: transport, scheduler: scheduler)

        _ = try? await client.createDataExport(.init())

        let attempts = await transport.requests(for: "createDataExport").count
        XCTAssertEqual(attempts, 1)
        let delays = await scheduler.recordedDelays()
        XCTAssertTrue(delays.isEmpty)
    }

    /// The same status is retried when the contract makes the call repeatable.
    func testWriteWithAnIdempotencyContractIsRetried() async throws {
        let transport = MockClientTransport()
        await transport.enqueue(
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            .json(completedSessionJSON),
            for: "completeStudySession"
        )
        let client = APITestClient.make(transport: transport)

        _ = try await client.completeStudySession(APITestClient.completeSessionInput())

        let requests = await transport.requests(for: "completeStudySession")
        XCTAssertEqual(requests.count, 2)
        // A retried write has to carry its body again; a consumed stream would
        // have sent an empty second request.
        XCTAssertEqual(requests[0].body, requests[1].body)
        XCTAssertNotNil(requests[1].body)
    }

    func testServerRetryDelayWinsOverTheClientSchedule() async throws {
        let transport = MockClientTransport()
        await transport.enqueue(
            .errorEnvelope(
                statusCode: 429,
                code: "RATE_LIMIT_EXCEEDED",
                headerFields: ["retry-after": "2"]
            ),
            .json(appConfigJSON),
            for: "getAppConfig"
        )
        let scheduler = RecordingBackoffScheduler()
        let client = APITestClient.make(transport: transport, scheduler: scheduler)

        _ = try await client.getAppConfig(APITestClient.appConfigInput())

        let delays = await scheduler.recordedDelays()
        XCTAssertEqual(delays, [.seconds(2)])
    }

    func testCancellationStopsTheRetryLoop() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 503, code: "SERVICE_UNAVAILABLE"),
            for: "getAppConfig"
        )
        let scheduler = RecordingBackoffScheduler(parksUntilCancelled: true)
        let client = APITestClient.make(transport: transport, scheduler: scheduler)

        let reachedBackoff = expectation(description: "the middleware waits before retrying")
        await scheduler.setOnSleep { reachedBackoff.fulfill() }

        let task = Task {
            try await client.getAppConfig(APITestClient.appConfigInput())
        }
        await fulfillment(of: [reachedBackoff], timeout: 5)
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("a cancelled request must not resolve")
        } catch {
            XCTAssertEqual(APIError.from(error), .cancelled)
        }
        // The wait was abandoned instead of being spent on a request nobody
        // is waiting for any more.
        let attempts = await transport.requests(for: "getAppConfig").count
        XCTAssertEqual(attempts, 1)
    }
}

final class RetryPolicyTests: XCTestCase {
    func testOnlyContractuallyRepeatableWritesAreEligible() {
        let policy = RetryPolicy()

        XCTAssertTrue(policy.allowsRetry(operationID: "getAppConfig", method: "GET"))
        XCTAssertTrue(policy.allowsRetry(operationID: "deleteDevice", method: "DELETE"))
        XCTAssertTrue(policy.allowsRetry(operationID: "createReviewBatch", method: "POST"))
        XCTAssertTrue(policy.allowsRetry(operationID: "createStudySession", method: "POST"))

        XCTAssertFalse(policy.allowsRetry(operationID: "createDataExport", method: "POST"))
        XCTAssertFalse(policy.allowsRetry(operationID: "authenticateWithApple", method: "POST"))
        XCTAssertFalse(policy.allowsRetry(operationID: "updateSettings", method: "PATCH"))
    }

    func testOnlyTransientStatusesAreRetried() {
        let policy = RetryPolicy()

        for statusCode in [429, 500, 502, 503, 504] {
            XCTAssertTrue(policy.isRetryable(statusCode: statusCode))
        }
        for statusCode in [200, 304, 400, 401, 404, 409, 422] {
            XCTAssertFalse(policy.isRetryable(statusCode: statusCode))
        }
    }

    func testBackoffGrowsAndStaysBounded() {
        let policy = RetryPolicy(
            maximumAttempts: 8,
            baseDelay: .milliseconds(100),
            maximumDelay: .seconds(1)
        )
        let jitter = ZeroJitterProvider()
        let delays = (1...6).map {
            policy.delay(forAttempt: $0, retryAfter: nil, jitter: jitter)
        }

        XCTAssertEqual(
            delays,
            [
                .milliseconds(100), .milliseconds(200), .milliseconds(400),
                .milliseconds(800), .seconds(1), .seconds(1),
            ]
        )
    }
}

private let appConfigJSON = TestFixtures.appConfigJSON
private let completedSessionJSON = TestFixtures.completedSessionJSON
