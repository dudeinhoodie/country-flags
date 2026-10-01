import Foundation

/// The configuration the Mock build answers with.
///
/// The Mock scheme runs without a backend, and a client that could not fetch a
/// snapshot there would exercise only the fallback path. This payload keeps the
/// whole chain — request, decode, accept, cache — under test offline, with the
/// bundled defaults of the registry so the mock run and a cold launch agree.
public enum MockAppConfig {
    public static let entityTag = "\"mock-app-config-1\""

    /// What the version policy says about the running build (#447).
    public enum ClientUpdate: String, Sendable, CaseIterable {
        /// The steady state: no update asked for.
        case none
        /// A newer build exists; the backend suggests it.
        case recommended
        /// This build is below the minimum the backend supports.
        case required

        /// The launch argument that picks a scenario, followed by its name:
        /// `-client-update required`.
        public static let launchArgument = "-client-update"

        /// The scenario the launch asked for, or `none`.
        public static func fromLaunchArguments(_ arguments: [String]) -> Self {
            guard let index = arguments.firstIndex(of: launchArgument),
                index + 1 < arguments.count
            else { return .none }
            return Self(rawValue: arguments[index + 1]) ?? .none
        }

        /// The policy's JSON. The versions are far above any real build, so
        /// the scenario holds whatever version the Mock app carries.
        var policyJSON: String {
            switch self {
            case .none:
                #"{"minimumSupported":"0.1.0","latest":"0.1.0","updateMode":"NONE"}"#
            case .recommended:
                #"{"minimumSupported":"0.1.0","latest":"99.0.0","updateMode":"SOFT"}"#
            case .required:
                #"{"minimumSupported":"99.0.0","latest":"99.0.0","updateMode":"FORCED"}"#
            }
        }
    }

    /// - Parameters:
    ///   - now: the instant the snapshot claims to have been generated.
    ///     Passing it keeps the response valid for the run that registered it
    ///     instead of expiring at a date fixed in the source.
    ///   - update: what the version policy says about the running build.
    public static func response(
        now: Date,
        lifetime: TimeInterval = 15 * 60,
        update: ClientUpdate = .none
    ) -> MockClientTransport.Response {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let generatedAt = formatter.string(from: now)
        let expiresAt = formatter.string(from: now.addingTimeInterval(lifetime))

        return .json(
            """
            {"configVersion":"mock-config-1",\
            "generatedAt":"\(generatedAt)","expiresAt":"\(expiresAt)",\
            "minimumClientVersions":{"ios":\(update.policyJSON)},\
            "contentVersion":"mock-content-1","supportedTemplateSchemaVersions":[1],\
            "featureFlags":{\
            "study.review_submission.enabled":{"type":"boolean","value":true,\
            "variant":"enabled","activationPolicy":"immediate"},\
            "study.multiple_choice.enabled":{"type":"boolean","value":false,\
            "variant":"disabled","activationPolicy":"nextSession"},\
            "study.max_new_cards_per_session":{"type":"number","value":10,\
            "variant":"default","activationPolicy":"nextSession"},\
            "home.recommended_decks.variant":{"type":"string","value":"control",\
            "variant":"control","activationPolicy":"nextLaunch"}},\
            "advertising":{"policyVersion":"mock-ads-1","enabled":false,\
            "mode":"DISABLED","placements":{},"refreshAfter":"\(expiresAt)"}}
            """,
            headerFields: ["etag": entityTag]
        )
    }
}
