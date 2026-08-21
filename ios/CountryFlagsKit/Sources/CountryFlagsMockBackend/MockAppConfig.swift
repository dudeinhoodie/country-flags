import Foundation

/// The configuration the Mock build answers with.
///
/// The Mock scheme runs without a backend, and a client that could not fetch a
/// snapshot there would exercise only the fallback path. This payload keeps the
/// whole chain — request, decode, accept, cache — under test offline, with the
/// bundled defaults of the registry so the mock run and a cold launch agree.
public enum MockAppConfig {
    public static let entityTag = "\"mock-app-config-1\""

    /// - Parameter now: the instant the snapshot claims to have been generated.
    ///   Passing it keeps the response valid for the run that registered it
    ///   instead of expiring at a date fixed in the source.
    public static func response(
        now: Date,
        lifetime: TimeInterval = 15 * 60
    ) -> MockClientTransport.Response {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let generatedAt = formatter.string(from: now)
        let expiresAt = formatter.string(from: now.addingTimeInterval(lifetime))

        return .json(
            """
            {"configVersion":"mock-config-1",\
            "generatedAt":"\(generatedAt)","expiresAt":"\(expiresAt)",\
            "minimumClientVersions":{"ios":{"minimumSupported":"1.0.0",\
            "latest":"1.0.0","updateMode":"NONE"}},\
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
