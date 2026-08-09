import CryptoKit
import Foundation

/// The content the Mock build answers with.
///
/// The Mock scheme runs without a backend, and a catalog that could not be
/// bootstrapped there would leave every content screen on its loading state.
/// This payload keeps the whole chain — manifest, paged decks, paged cards,
/// asset download and checksum — exercised offline.
///
/// The flags are generated here rather than shipped as files so their checksums
/// are computed from the very bytes the fetcher serves: a mock that declared a
/// checksum it did not honour would only prove the verification is skipped.
public enum MockContent {
    public static let contentVersion = "mock-content-1"
    public static let changeCursor = "mock-cursor-0"
    public static let entityTag = "\"mock-content-manifest-1\""

    public struct Flag: Sendable {
        public let deckCode: String
        public let cardID: String
        public let assetID: String
        public let entityID: String
        public let name: String
        public let aliases: [String]
        public let colors: [String]

        var svg: String {
            let stripes = colors.enumerated().map { index, color in
                let y = index * (60 / max(colors.count, 1))
                let height = 60 / max(colors.count, 1)
                return "<rect y=\"\(y)\" width=\"90\" height=\"\(height)\" fill=\"\(color)\"/>"
            }
            .joined()
            return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 90 60\">\(stripes)</svg>"
        }

        var data: Data { Data(svg.utf8) }

        var sha256: String {
            SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }

        var url: URL {
            URL(string: "\(MockContent.assetBaseURL)flags/\(deckCode.lowercased())-\(name.lowercased()).svg")!
        }
    }

    static let assetBaseURL = "https://cdn.country-flags.mock/mock-content-1/"

    /// Two decks so the catalog has more than one section, and enough cards to
    /// need a second page at the limit the tests use.
    public static let flags: [Flag] = [
        Flag(
            deckCode: "EUROPE",
            cardID: "50000000-0000-4000-8000-0000000000a1",
            assetID: "40000000-0000-4000-8000-0000000000a1",
            entityID: "30000000-0000-4000-8000-0000000000a1",
            name: "France",
            aliases: ["Франция"],
            colors: ["#0055A4", "#FFFFFF", "#EF4135"]
        ),
        Flag(
            deckCode: "EUROPE",
            cardID: "50000000-0000-4000-8000-0000000000a2",
            assetID: "40000000-0000-4000-8000-0000000000a2",
            entityID: "30000000-0000-4000-8000-0000000000a2",
            name: "Germany",
            aliases: ["Германия"],
            colors: ["#000000", "#DD0000", "#FFCE00"]
        ),
        Flag(
            deckCode: "EUROPE",
            cardID: "50000000-0000-4000-8000-0000000000a3",
            assetID: "40000000-0000-4000-8000-0000000000a3",
            entityID: "30000000-0000-4000-8000-0000000000a3",
            name: "Italy",
            aliases: ["Италия"],
            colors: ["#008C45", "#F4F5F0", "#CD212A"]
        ),
    ]

    public static let europeDeckID = "70000000-0000-4000-8000-0000000000b1"
    public static let allDeckID = "70000000-0000-4000-8000-0000000000b2"

    // MARK: - Payloads

    public static func manifestResponse(now: Date) -> MockClientTransport.Response {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return .json(
            """
            {"schemaVersion":1,"contentVersion":"\(contentVersion)",\
            "createdAt":"\(formatter.string(from: now))",\
            "defaultLocale":"en","supportedLocales":["en","ru"],\
            "minimumClientVersion":"1.0.0","supportedTemplateSchemaVersions":[1],\
            "assetBaseUrl":"\(assetBaseURL)","changeCursor":"\(changeCursor)",\
            "files":[{"path":"catalog.json","bytes":1024,\
            "sha256":"0000000000000000000000000000000000000000000000000000000000000000",\
            "schemaId":"https://country-flags.app/content/v1/catalog.schema.json"}],\
            "signature":{"algorithm":"Ed25519","keyId":"mock-key-1","value":"bW9jaw=="}}
            """,
            headerFields: ["etag": entityTag]
        )
    }

    public static func decksResponse() -> MockClientTransport.Response {
        .json(
            """
            {"items":[\
            {"id":"\(allDeckID)","code":"ALL_COUNTRIES","kind":"CURATED",\
            "name":"All countries","description":"Every flag in the release",\
            "cardCount":\(flags.count),"dueCount":null,"contentVersion":"\(contentVersion)"},\
            {"id":"\(europeDeckID)","code":"EUROPE","kind":"TAXONOMY",\
            "name":"Europe","description":"European countries",\
            "cardCount":\(flags.count),"dueCount":null,"contentVersion":"\(contentVersion)"}\
            ],"page":{"nextCursor":null,"hasMore":false}}
            """
        )
    }

    public static func deckCardsResponse() -> MockClientTransport.Response {
        let items = flags.map { flag in
            """
            {"id":"\(flag.cardID)","templateCode":"FLAG_TO_COUNTRY",\
            "templateSchemaVersion":1,"semanticVersion":1,"revision":1,\
            "answerMode":"SELF_RATED",\
            "prompt":{"asset":{"id":"\(flag.assetID)","type":"FLAG",\
            "url":"\(flag.url.absoluteString)","mimeType":"image/svg+xml",\
            "sha256":"\(flag.sha256)","width":90,"height":60,"aspectRatio":1.5,\
            "licenseName":"CC0-1.0","attribution":null}},\
            "answer":{"entityId":"\(flag.entityID)","displayName":"\(flag.name)",\
            "aliases":[\(flag.aliases.map { "\"\($0)\"" }.joined(separator: ","))]},\
            "backSideFacts":[],"contentVersion":"\(contentVersion)"}
            """
        }
        .joined(separator: ",")

        return .json("""
            {"items":[\(items)],"page":{"nextCursor":null,"hasMore":false}}
            """)
    }

    /// An empty feed: the mock release never changes under the app, so a
    /// refresh is a no-op rather than a second bootstrap.
    public static func changesResponse() -> MockClientTransport.Response {
        .json(
            """
            {"items":[],"nextCursor":"\(changeCursor)","hasMore":false,\
            "contentVersion":"\(contentVersion)"}
            """
        )
    }

    public static func responses(now: Date) -> [String: MockClientTransport.Response] {
        [
            "getContentManifest": manifestResponse(now: now),
            "listDecks": decksResponse(),
            "listDeckCards": deckCardsResponse(),
            "getContentChanges": changesResponse(),
        ]
    }
}

/// Serves the Mock build's flags without a socket.
public struct MockAssetFetcher: AssetDataFetching {
    private let bytes: [URL: Data]

    public init(flags: [MockContent.Flag] = MockContent.flags) {
        bytes = Dictionary(flags.map { ($0.url, $0.data) }, uniquingKeysWith: { first, _ in first })
    }

    public func data(from url: URL) async throws -> Data {
        guard let data = bytes[url] else {
            throw APIError.transport("No mock asset is registered for this URL")
        }
        return data
    }
}
