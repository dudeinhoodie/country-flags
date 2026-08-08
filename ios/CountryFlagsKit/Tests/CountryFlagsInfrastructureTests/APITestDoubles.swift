import Foundation
import OpenAPIRuntime

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// Records the requested delays instead of spending them, so a backoff test
/// runs in microseconds and asserts on the schedule itself.
actor RecordingBackoffScheduler: BackoffScheduling {
    private(set) var delays: [Duration] = []
    /// Signals that the middleware reached the wait, which lets a cancellation
    /// test cancel at a deterministic point.
    private var onSleep: (@Sendable () -> Void)?
    /// Parks inside the wait instead of returning at once. A returning
    /// scheduler would let the retry loop finish before a test could cancel it,
    /// which would prove nothing about cancellation.
    private let parksUntilCancelled: Bool

    init(parksUntilCancelled: Bool = false) {
        self.parksUntilCancelled = parksUntilCancelled
    }

    func setOnSleep(_ handler: @escaping @Sendable () -> Void) {
        onSleep = handler
    }

    func sleep(for duration: Duration) async throws {
        delays.append(duration)
        onSleep?()
        try Task.checkCancellation()
        if parksUntilCancelled {
            // Cancelling the task makes this throw, which is exactly what the
            // production scheduler does.
            try await Task.sleep(for: .seconds(60))
        }
    }

    func recordedDelays() -> [Duration] {
        delays
    }
}

struct ZeroJitterProvider: JitterProviding {
    func jitter(upTo limit: Duration) -> Duration { .zero }
}

/// Captures log entries so a test can prove what was and was not recorded.
final class RecordingAPILogger: APIRequestLogging, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [APIRequestLogEntry] = []

    func record(_ entry: APIRequestLogEntry) {
        lock.lock()
        defer { lock.unlock() }
        storage.append(entry)
    }

    var entries: [APIRequestLogEntry] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    /// Everything the logger was given, flattened, for a redaction assertion.
    var renderedText: String {
        entries
            .map { entry in
                [
                    entry.operationID, entry.method, entry.path,
                    entry.statusCode.map(String.init) ?? "",
                    entry.errorCode ?? "", entry.requestID ?? "",
                ].joined(separator: " ")
            }
            .joined(separator: "\n")
    }
}

/// A token provider whose refresh can be counted, delayed and made to fail.
actor StubTokenProvider: AuthorizationTokenProviding {
    private(set) var refreshCount = 0
    private var token: String?
    private let refreshedToken: String?
    private let delay: Duration?

    init(initialToken: String?, refreshedToken: String?, delay: Duration? = nil) {
        self.token = initialToken
        self.refreshedToken = refreshedToken
        self.delay = delay
    }

    func currentAccessToken() async -> String? {
        token
    }

    func refreshAccessToken() async throws -> String {
        refreshCount += 1
        if let delay {
            try await Task.sleep(for: delay)
        }
        guard let refreshedToken else {
            throw APIError.unauthorized(
                APIErrorDetails(
                    statusCode: 401,
                    code: "REFRESH_REJECTED",
                    message: "The refresh token was rejected",
                    requestID: nil
                )
            )
        }
        token = refreshedToken
        return refreshedToken
    }

    func observedRefreshCount() -> Int {
        refreshCount
    }
}

struct SequentialIdentifierProvider: IdentifierProviding {
    func next() -> UUID {
        UUID()
    }
}

/// Builds a client wired to the mock transport with deterministic policies.
enum APITestClient {
    static let configuration = APIClientConfiguration(
        baseURL: URL(string: "https://api.test.invalid")!,
        appVersion: "1.2.3",
        locale: "ru-RU",
        supportedTemplateSchemaVersions: [1, 2]
    )

    static func make(
        transport: MockClientTransport,
        tokens: any AuthorizationTokenProviding = GuestTokenProvider(),
        logger: any APIRequestLogging = NoOpAPIRequestLogger(),
        retryPolicy: RetryPolicy = RetryPolicy(maximumAttempts: 3),
        scheduler: any BackoffScheduling = RecordingBackoffScheduler()
    ) -> Client {
        APIClientFactory(
            configuration: configuration,
            transport: transport,
            tokens: tokens,
            identifiers: SequentialIdentifierProvider(),
            logger: logger,
            retryPolicy: retryPolicy,
            scheduler: scheduler,
            jitter: ZeroJitterProvider()
        )
        .makeClient()
    }

    static func appConfigInput() -> Operations.getAppConfig.Input {
        .init(query: .init(platform: .ios, appVersion: "1.2.3", locale: "ru"))
    }

    static func completeSessionInput() -> Operations.completeStudySession.Input {
        .init(
            path: .init(sessionId: "90000000-0000-4000-8000-000000000001"),
            body: .json(.init(completedAt: Date(timeIntervalSince1970: 1_760_000_000)))
        )
    }
}
