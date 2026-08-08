import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Restores the literal form of a conditional request validator.
///
/// The generated client writes header parameters through the URI encoder, which
/// escapes the quotation marks an entity tag is defined to carry: the tag
/// `"config-1"` would leave the device as `%22config-1%22`. A server comparing
/// that against the tag it issued never matches, so every revalidation answers
/// `200` and the device downloads a snapshot it already has. The tag is opaque
/// and is sent back exactly as it arrived.
struct ConditionalRequestMiddleware: ClientMiddleware {
    private static let ifNoneMatch = HTTPField.Name("If-None-Match")!

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let encoded = request.headerFields[Self.ifNoneMatch],
            let decoded = encoded.removingPercentEncoding,
            decoded != encoded
        {
            request.headerFields[Self.ifNoneMatch] = decoded
        }
        return try await next(request, body, baseURL)
    }
}
