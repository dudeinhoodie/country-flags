import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Restores the entity tags the generated client percent-encodes.
///
/// The generator emits `setHeaderFieldAsURI` for every header parameter, which
/// escapes the quotes an entity tag is required to carry: `"config-1"` leaves
/// as `%22config-1%22` and no server matches it against the tag it issued. The
/// conditional request then always answers `200` with a full body, so the
/// caching the contract asks for silently never happens.
///
/// Decoding is the exact inverse of what the converter did, so a tag that
/// really contains a percent sign survives it.
///
/// It runs outside the retry middleware: once per logical request, not once per
/// attempt.
struct ConditionalRequestMiddleware: ClientMiddleware {
    /// The headers whose value is an entity tag.
    private static let headerNames = ["If-None-Match", "If-Match"]

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        for name in Self.headerNames {
            guard let field = HTTPField.Name(name),
                let value = request.headerFields[field],
                let decoded = value.removingPercentEncoding,
                decoded != value
            else {
                continue
            }
            request.headerFields[field] = decoded
        }
        return try await next(request, body, baseURL)
    }
}
