import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Turns a failed response into a stable domain error.
///
/// Mapping happens once, here, instead of at every call site: a feature never
/// sees a status code, and a new endpoint cannot forget to translate one.
struct ErrorMappingMiddleware: ClientMiddleware {
    /// The envelope is small by contract; anything larger is not one.
    private static let maximumEnvelopeBytes = 64 * 1024

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        guard response.status.code >= 400 else {
            return (response, responseBody)
        }

        let envelope = await Self.decodeEnvelope(responseBody)
        let details = APIErrorDetails(
            statusCode: response.status.code,
            code: envelope?.code ?? "UNKNOWN",
            message: envelope?.message ?? response.status.reasonPhrase,
            // The response header is the fallback: a proxy can fail a request
            // before the application ever writes an envelope.
            requestID: envelope?.requestID ?? response.header(ClientHeader.requestID)
        )
        throw APIError.status(details, retryAfter: RetryMiddleware.retryAfter(in: response))
    }

    private struct Envelope: Decodable {
        struct Payload: Decodable {
            let code: String
            let message: String
            let requestId: String?
        }

        let error: Payload
    }

    private struct DecodedEnvelope {
        let code: String
        let message: String
        let requestID: String?
    }

    private static func decodeEnvelope(_ body: HTTPBody?) async -> DecodedEnvelope? {
        guard let body else { return nil }
        guard
            let bytes = try? await ArraySlice(collecting: body, upTo: maximumEnvelopeBytes),
            let envelope = try? JSONDecoder().decode(Envelope.self, from: Data(bytes))
        else {
            return nil
        }
        return DecodedEnvelope(
            code: envelope.error.code,
            message: envelope.error.message,
            requestID: envelope.error.requestId
        )
    }
}
