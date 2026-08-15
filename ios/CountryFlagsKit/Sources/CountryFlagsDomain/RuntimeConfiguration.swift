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
    /// The Google OAuth clients, absent until the console credentials exist.
    /// An absent pair simply hides the Google button: the identifiers are
    /// public, but a button that cannot finish must not be offered.
    public let googleClientID: String?
    /// The backend's own client, which the identity token is minted for: the
    /// backend verifies the audience, and the audience is the backend.
    public let googleServerClientID: String?

    public init(
        environment: AppEnvironment,
        apiBaseURL: URL?,
        deepLinkScheme: String,
        googleClientID: String? = nil,
        googleServerClientID: String? = nil
    ) {
        self.environment = environment
        self.apiBaseURL = apiBaseURL
        self.deepLinkScheme = deepLinkScheme
        self.googleClientID = googleClientID
        self.googleServerClientID = googleServerClientID
    }
}
