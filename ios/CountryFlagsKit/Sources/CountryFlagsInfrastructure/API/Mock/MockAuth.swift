import Foundation

/// The sessions the Mock build signs into.
///
/// The Mock scheme has no backend, and an auth flow that could not complete
/// there would leave the whole account surface untestable: the exchange, the
/// migration and the sign-out all answer from here, deterministic and
/// offline. The values satisfy the contract's shapes — token lengths, the
/// settings envelope — so the same decoding runs as against the real thing.
public enum MockAuth {
    /// The one account the mock backend knows.
    public static let userID = "9f000000-0000-4000-8000-000000000001"

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func settingsJSON(now: Date) -> String {
        """
        {"sessionSize":10,"contentLocale":"en","defaultAnswerMode":"SELF_RATED",\
        "extraFactTypes":[],"soundEnabled":true,"hapticsEnabled":true,\
        "remindersEnabled":false,"desiredRetention":0.9,"timezone":"UTC",\
        "version":1,"updatedAt":"\(timestamp(now))"}
        """
    }

    /// `POST /v1/auth/apple` and `/google`.
    public static func session(now: Date) -> MockClientTransport.Response {
        .json(
            """
            {"tokens":{"accessToken":"mock-access-token-0123456789abcdef0123",\
            "refreshToken":"mock-refresh-token-0123456789abcdef012",\
            "accessTokenExpiresAt":"\(timestamp(now.addingTimeInterval(900)))"},\
            "user":{"id":"\(userID)","displayName":"Mock Learner",\
            "preferredLocale":"en","status":"ACTIVE",\
            "createdAt":"\(timestamp(now))","updatedAt":"\(timestamp(now))"},\
            "settings":\(settingsJSON(now: now)),\
            "serverTime":"\(timestamp(now))"}
            """
        )
    }

    /// `POST /v1/auth/refresh`.
    public static func refreshedTokens(now: Date) -> MockClientTransport.Response {
        .json(
            """
            {"accessToken":"mock-access-token-rotated-0123456789abc",\
            "refreshToken":"mock-refresh-token-rotated-0123456789ab",\
            "accessTokenExpiresAt":"\(timestamp(now.addingTimeInterval(900)))"}
            """
        )
    }

    /// `POST /v1/me/guest-imports`: the archive is taken whole.
    public static func importResult(
        now: Date,
        migrationID: String = "00000000-0000-4000-8000-00000000f00d",
        statusCode: Int = 202
    ) -> MockClientTransport.Response {
        .json(
            """
            {"migrationId":"\(migrationID)","status":"APPLIED",\
            "acceptedEventCount":2,"duplicateEventCount":0,"rejectedEventCount":0,\
            "createdAt":"\(timestamp(now))","completedAt":"\(timestamp(now))"}
            """,
            statusCode: statusCode
        )
    }

    public static let loggedOut = MockClientTransport.Response(statusCode: 204)
}
