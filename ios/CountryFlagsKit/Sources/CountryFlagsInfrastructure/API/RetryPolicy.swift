import Foundation

/// Waits between retry attempts. A test substitutes an implementation that
/// records the requested delays instead of spending them.
public protocol BackoffScheduling: Sendable {
    func sleep(for duration: Duration) async throws
}

/// Adds randomness to a backoff delay so retries from many devices do not
/// arrive in the same instant.
public protocol JitterProviding: Sendable {
    func jitter(upTo limit: Duration) -> Duration
}

public struct TaskBackoffScheduler: BackoffScheduling {
    public init() {}

    public func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}

public struct RandomJitterProvider: JitterProviding {
    public init() {}

    public func jitter(upTo limit: Duration) -> Duration {
        let attoseconds = limit.components.seconds * 1_000_000_000
            + limit.components.attoseconds / 1_000_000_000
        guard attoseconds > 0 else { return .zero }
        return .nanoseconds(Int64.random(in: 0...attoseconds))
    }
}

/// Decides what may be retried and how long to wait.
public struct RetryPolicy: Sendable {
    public let maximumAttempts: Int
    public let baseDelay: Duration
    public let maximumDelay: Duration

    /// Operations whose contract makes a repeated call safe.
    ///
    /// Every entry carries a client-generated identifier that the backend
    /// deduplicates, so a retry cannot create a second session, a second review
    /// or a second import. An arbitrary POST is absent on purpose: retrying it
    /// could duplicate work the caller never agreed to repeat.
    public let idempotentOperationIDs: Set<String>

    public static let retryableStatusCodes: Set<Int> = [429, 500, 502, 503, 504]

    public init(
        maximumAttempts: Int = 3,
        baseDelay: Duration = .milliseconds(300),
        maximumDelay: Duration = .seconds(8),
        idempotentOperationIDs: Set<String> = RetryPolicy.defaultIdempotentOperationIDs
    ) {
        self.maximumAttempts = maximumAttempts
        self.baseDelay = baseDelay
        self.maximumDelay = maximumDelay
        self.idempotentOperationIDs = idempotentOperationIDs
    }

    public static let defaultIdempotentOperationIDs: Set<String> = [
        // Client-generated session id plus a request hash.
        "createStudySession",
        // The first accepted call fixes the summary; later calls return it.
        "completeStudySession",
        // Every event carries a client-generated id the backend deduplicates.
        "createReviewBatch",
        // Deduplicated by the stable migration id.
        "createGuestImport",
        // Deduplicated by event id.
        "createAnalyticsBatch",
        // Deduplicated by report id.
        "createMetricKitReport",
        // Deduplicated by the `Idempotency-Key` the client derives from the
        // very payload it is sending, so a retry after a timeout is the same
        // submission rather than a second claim on the same purchase.
        "submitAppleTransactions",
    ]

    /// Read-only methods are safe by definition; a write is safe only when the
    /// contract says so.
    public func allowsRetry(operationID: String, method: String) -> Bool {
        switch method.uppercased() {
        case "GET", "HEAD", "OPTIONS", "PUT", "DELETE":
            return true
        default:
            return idempotentOperationIDs.contains(operationID)
        }
    }

    public func isRetryable(statusCode: Int) -> Bool {
        RetryPolicy.retryableStatusCodes.contains(statusCode)
    }

    /// The transport failures a second attempt can cure: the connection the
    /// radio dropped as the phone woke, a host that did not answer in time, a
    /// lookup that came back empty. Not the ones that say the request itself
    /// is wrong, and not a cancellation, which is the caller changing its mind.
    public static let transientTransportCodes: Set<URLError.Code> = [
        .networkConnectionLost,
        .timedOut,
        .cannotConnectToHost,
        .cannotFindHost,
        .dnsLookupFailed,
        .notConnectedToInternet,
    ]

    public func isRetryable(error: any Error) -> Bool {
        guard let urlError = Self.urlError(in: error) else { return false }
        return Self.transientTransportCodes.contains(urlError.code)
    }

    /// The runtime wraps what the transport threw; the cause is one level
    /// down, under the same label `APIError.from` unwraps.
    private static func urlError(in error: any Error) -> URLError? {
        if let urlError = error as? URLError { return urlError }
        let mirror = Mirror(reflecting: error)
        for child in mirror.children where child.label == "underlyingError" {
            if let underlying = child.value as? any Error {
                return urlError(in: underlying)
            }
        }
        return nil
    }

    /// Exponential backoff, capped, with jitter on top. A `Retry-After` header
    /// wins: the server knows better than the client when to come back.
    public func delay(
        forAttempt attempt: Int,
        retryAfter: Duration?,
        jitter: any JitterProviding
    ) -> Duration {
        if let retryAfter {
            return min(retryAfter, maximumDelay)
        }
        let exponent = max(0, attempt - 1)
        let multiplier = Int64(truncatingIfNeeded: 1 << min(exponent, 16))
        let scaled = baseDelay * Double(multiplier)
        let capped = min(scaled, maximumDelay)
        return capped + jitter.jitter(upTo: capped)
    }
}
