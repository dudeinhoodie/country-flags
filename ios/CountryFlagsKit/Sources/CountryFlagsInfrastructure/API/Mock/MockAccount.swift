import Foundation

import CountryFlagsDomain

/// The account surface of the Mock build.
///
/// The whole of IOS-011 is unreachable without a backend — identities, devices,
/// an export that has to become ready, a deletion that has to be accepted — so
/// the mock answers all of it deterministically and offline. The shapes are the
/// contract's, so the same decoding runs as against the real thing.
public enum MockAccount {
    public static let deviceID = "9f000000-0000-4000-8000-0000000000d1"
    public static let exportID = "9f000000-0000-4000-8000-0000000000e1"

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    /// `GET /v1/me/identities`: the account signed in with Apple, which is
    /// what the mock sign-in does.
    public static func identities(now: Date) -> MockClientTransport.Response {
        .json(
            """
            {"items":[{"id":"9f000000-0000-4000-8000-0000000000a1",\
            "provider":"APPLE","createdAt":"\(timestamp(now))",\
            "lastLoginAt":"\(timestamp(now))"}]}
            """
        )
    }

    /// `GET /v1/me/devices`: this one, and one the account was signed in on
    /// elsewhere — a list with nothing to revoke would prove nothing.
    public static func devices(now: Date) -> MockClientTransport.Response {
        .json(
            """
            {"items":[{"id":"\(deviceID)","platform":"IOS","appVersion":"1.0.0",\
            "locale":"en","timezone":"UTC","lastSeenAt":"\(timestamp(now))",\
            "current":true},\
            {"id":"9f000000-0000-4000-8000-0000000000d2","platform":"IOS",\
            "appVersion":"1.0.0","locale":"en","timezone":"UTC",\
            "lastSeenAt":"\(timestamp(now.addingTimeInterval(-86_400)))",\
            "current":false}]}
            """
        )
    }

    /// `POST /v1/me/data-exports`: accepted and already being prepared.
    public static func exportRequested(now: Date) -> MockClientTransport.Response {
        .json(
            """
            {"id":"\(exportID)","status":"PROCESSING","downloadUrl":null,\
            "sha256":null,"expiresAt":null,"createdAt":"\(timestamp(now))",\
            "completedAt":null}
            """,
            statusCode: 202
        )
    }

    /// `GET /v1/me/data-exports/{id}`: ready, with a URL that carries its own
    /// short-lived proof exactly as the real one does.
    public static func exportReady(now: Date) -> MockClientTransport.Response {
        .json(
            """
            {"id":"\(exportID)","status":"READY",\
            "downloadUrl":"https:/\("/")mock.invalid/v1/data-exports/\(exportID)/download?token=\
            mock-export-token-0123456789abcdef0123456789",\
            "sha256":"\(String(repeating: "a", count: 64))",\
            "expiresAt":"\(timestamp(now.addingTimeInterval(900)))",\
            "createdAt":"\(timestamp(now))","completedAt":"\(timestamp(now))"}
            """
        )
    }

    /// `DELETE /v1/me`: accepted, completing in a week — long enough that the
    /// notice is worth showing rather than a formality.
    public static func deletionAccepted(now: Date) -> MockClientTransport.Response {
        .json(
            """
            {"status":"DELETION_PENDING","requestedAt":"\(timestamp(now))",\
            "expectedCompletionAt":"\(timestamp(now.addingTimeInterval(7 * 86_400)))"}
            """,
            statusCode: 202
        )
    }

    public static let unlinked = MockClientTransport.Response(statusCode: 204)
    public static let deviceRevoked = MockClientTransport.Response(statusCode: 204)
}

/// The archive the Mock build hands over.
///
/// It is the shape of an export rather than a real one: the point is that the
/// flow reaches a file the share sheet can take, without a socket.
public struct MockExportArchiveFetcher: DataExportArchiveFetching {
    public init() {}

    public func archive(at url: URL) async throws -> Data {
        Data(
            """
            {"account":{"displayName":"Mock Learner"},"reviews":[],"sessions":[]}
            """.utf8
        )
    }
}
