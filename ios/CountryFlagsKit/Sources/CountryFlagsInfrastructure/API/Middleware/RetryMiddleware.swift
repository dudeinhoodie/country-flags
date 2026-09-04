import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Repeats a request that failed for a reason worth repeating.
///
/// Only operations whose contract makes a repeat safe are eligible, so an
/// arbitrary POST is sent exactly once even when the server is unhealthy.
struct RetryMiddleware: ClientMiddleware {
    let policy: RetryPolicy
    let scheduler: any BackoffScheduling
    let jitter: any JitterProviding

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let method = request.method.rawValue
        guard policy.allowsRetry(operationID: operationID, method: method) else {
            return try await next(request, body, baseURL)
        }

        let buffered = try await BufferedBody.collect(body)
        var attempt = 1
        while true {
            try Task.checkCancellation()
            let response: HTTPResponse
            let responseBody: HTTPBody?
            do {
                (response, responseBody) = try await next(
                    request,
                    buffered.makeBody(),
                    baseURL
                )
            } catch {
                // A connection the radio dropped is the one failure a second
                // attempt cures, and it is what the first request after the
                // phone wakes usually meets. Repeated on the same terms as a
                // 503: only requests that may be repeated, only so many times.
                guard attempt < policy.maximumAttempts, policy.isRetryable(error: error) else {
                    throw error
                }
                try await scheduler.sleep(
                    for: policy.delay(forAttempt: attempt, retryAfter: nil, jitter: jitter)
                )
                attempt += 1
                continue
            }
            guard
                attempt < policy.maximumAttempts,
                policy.isRetryable(statusCode: response.status.code)
            else {
                return (response, responseBody)
            }

            let delay = policy.delay(
                forAttempt: attempt,
                retryAfter: Self.retryAfter(in: response),
                jitter: jitter
            )
            // A cancelled task must stop waiting instead of finishing the
            // backoff it no longer needs.
            try await scheduler.sleep(for: delay)
            attempt += 1
        }
    }

    /// The server states when it is willing to talk again; that beats any
    /// client-side guess.
    static func retryAfter(in response: HTTPResponse) -> Duration? {
        guard
            let value = response.headerFields[.retryAfter],
            let seconds = Int(value.trimmingCharacters(in: .whitespaces)),
            seconds >= 0
        else {
            return nil
        }
        return .seconds(seconds)
    }
}
