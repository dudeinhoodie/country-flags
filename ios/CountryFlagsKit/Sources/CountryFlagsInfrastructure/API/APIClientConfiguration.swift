import Foundation

import CountryFlagsDomain

/// Everything the transport needs that is not a secret.
public struct APIClientConfiguration: Equatable, Sendable {
    public let baseURL: URL
    /// Sent to the backend for compatibility decisions and flag evaluation.
    public let platform: String
    public let appVersion: String
    public let locale: String
    /// Card template schema versions this build can render. A card that needs a
    /// newer one is skipped instead of rendered wrong.
    public let supportedTemplateSchemaVersions: [Int]
    public let requestTimeout: Duration

    public init(
        baseURL: URL,
        platform: String = "ios",
        appVersion: String,
        locale: String,
        supportedTemplateSchemaVersions: [Int] = [1],
        requestTimeout: Duration = .seconds(30)
    ) {
        self.baseURL = baseURL
        self.platform = platform
        self.appVersion = appVersion
        self.locale = locale
        self.supportedTemplateSchemaVersions = supportedTemplateSchemaVersions
        self.requestTimeout = requestTimeout
    }
}

/// Header names the client adds to every request.
enum ClientHeader {
    static let requestID = "X-Request-ID"
    static let platform = "X-Client-Platform"
    static let appVersion = "X-Client-App-Version"
    static let locale = "X-Client-Locale"
    static let templateSchemaVersions = "X-Client-Template-Schema-Versions"
}
