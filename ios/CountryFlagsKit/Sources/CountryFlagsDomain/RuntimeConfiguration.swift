import Foundation

/// The build environment of the app.
///
/// The value arrives from an xcconfig through Info.plist rather than from
/// `#if DEBUG`: there are three configurations and only two compilation
/// conditions.
public enum AppEnvironment: String, Hashable, Sendable, CaseIterable {
    case mock
    case dev
    case prod

    /// Debug affordances are allowed everywhere except production.
    public var allowsDebugAffordances: Bool {
        self != .prod
    }
}

/// The resolved configuration of the current run.
public struct RuntimeConfiguration: Hashable, Sendable {
    public let environment: AppEnvironment
    public let apiBaseURL: URL?
    public let deepLinkScheme: String

    public init(environment: AppEnvironment, apiBaseURL: URL?, deepLinkScheme: String) {
        self.environment = environment
        self.apiBaseURL = apiBaseURL
        self.deepLinkScheme = deepLinkScheme
    }
}
