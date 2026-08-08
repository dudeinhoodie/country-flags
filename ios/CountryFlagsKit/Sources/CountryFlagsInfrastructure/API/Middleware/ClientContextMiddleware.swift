import Foundation
import HTTPTypes
import OpenAPIRuntime

import CountryFlagsDomain

/// Adds the client context every request carries.
///
/// The identifier is generated once per logical request, before any retry: the
/// backend accepts a valid UUID and echoes it back, so a user handing that one
/// value to support finds every attempt the client made.
struct ClientContextMiddleware: ClientMiddleware {
    let configuration: APIClientConfiguration
    let identifiers: any IdentifierProviding

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.setHeader(ClientHeader.requestID, identifiers.next().uuidString.lowercased())
        request.setHeader(ClientHeader.platform, configuration.platform)
        request.setHeader(ClientHeader.appVersion, configuration.appVersion)
        request.setHeader(ClientHeader.locale, configuration.locale)
        request.setHeader(
            ClientHeader.templateSchemaVersions,
            configuration.supportedTemplateSchemaVersions
                .map(String.init)
                .joined(separator: ",")
        )
        request.headerFields[.acceptLanguage] = configuration.locale
        return try await next(request, body, baseURL)
    }
}

extension HTTPRequest {
    mutating func setHeader(_ name: String, _ value: String) {
        guard let field = HTTPField.Name(name) else { return }
        headerFields[field] = value
    }
}

extension HTTPResponse {
    func header(_ name: String) -> String? {
        guard let field = HTTPField.Name(name) else { return nil }
        return headerFields[field]
    }
}
