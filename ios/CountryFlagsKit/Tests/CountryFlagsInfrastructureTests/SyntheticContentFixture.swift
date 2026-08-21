import CryptoKit
import Foundation
import UIKit

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// A small content release invented for the tests, with flags whose bytes exist.
///
/// The Mock build serves the real published release, which is hosted nowhere
/// and does not need to be: the app bundles those flags. The tests that prove
/// the *download* works — that bytes arrive, match the checksum they were
/// published with, and decode into a picture — need the opposite, an asset
/// somebody actually serves. That is what this is.
///
/// The flags are drawn here rather than shipped as files so their checksums are
/// computed from the very bytes the fetcher serves: a fixture that declared a
/// checksum it did not honour would only prove the verification is skipped.
enum SyntheticContent {
    public static let contentVersion = "mock-content-1"
    public static let changeCursor = "mock-cursor-0"
    public static let entityTag = "\"mock-content-manifest-1\""
    /// The mock release must never gate the build it ships with: a Mock scheme
    /// that told itself to update would exercise nothing but the update screen.
    public static let minimumClientVersion = "0.0.0"

    public struct Flag: Sendable {
        public let deckCode: String
        public let cardID: String
        public let assetID: String
        public let entityID: String
        public let name: String
        public let aliases: [String]
        public let colors: [String]

        /// The flag as PNG bytes, which is the representation a client on this
        /// platform picks: `UIImage(data:)` cannot decode SVG, so a mock that
        /// offered vectors alone would exercise only the placeholder branch and
        /// never prove that an asset becomes an image.
        var data: Data {
            let size = CGSize(width: 90, height: 60)
            let renderer = UIGraphicsImageRenderer(size: size)
            return renderer.pngData { context in
                let bandHeight = size.height / CGFloat(max(colors.count, 1))
                for (index, color) in colors.enumerated() {
                    UIColor(hex: color).setFill()
                    context.fill(
                        CGRect(
                            x: 0,
                            y: CGFloat(index) * bandHeight,
                            width: size.width,
                            height: bandHeight
                        )
                    )
                }
            }
        }

        /// The same flag as the vector original a release leads with. The mock
        /// serves it because the release does; a client that can draw it is
        /// welcome to, and this one skips it.
        var vectorData: Data {
            let bandHeight = 60 / max(colors.count, 1)
            let bands = colors.enumerated()
                .map { index, color in
                    """
                    <rect x="0" y="\(index * bandHeight)" width="90" \
                    height="\(bandHeight)" fill="\(color)"/>
                    """
                }
                .joined()
            return Data(
                """
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 60">\(bands)</svg>
                """.utf8
            )
        }

        var sha256: String { Self.digest(of: data) }

        var vectorSHA256: String { Self.digest(of: vectorData) }

        var url: URL { assetURL(extension: "png") }

        var vectorURL: URL { assetURL(extension: "svg") }

        private func assetURL(extension pathExtension: String) -> URL {
            URL(
                string:
                    "\(SyntheticContent.assetBaseURL)flags/\(deckCode.lowercased())-\(name.lowercased()).\(pathExtension)"
            )!
        }

        private static func digest(of data: Data) -> String {
            SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }
    }

    static let assetBaseURL = "https://cdn.country-flags.mock/mock-content-1/"

    /// Two decks so the catalog has more than one section, and at least six
    /// distinctly named countries: the quiz mode needs four different answers
    /// per question, so a smaller mock would only ever exercise its refusal
    /// path.
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
        Flag(
            deckCode: "EUROPE",
            cardID: "50000000-0000-4000-8000-0000000000a4",
            assetID: "40000000-0000-4000-8000-0000000000a4",
            entityID: "30000000-0000-4000-8000-0000000000a4",
            name: "Belgium",
            aliases: ["Бельгия"],
            colors: ["#000000", "#FDDA24", "#EF3340"]
        ),
        Flag(
            deckCode: "EUROPE",
            cardID: "50000000-0000-4000-8000-0000000000a5",
            assetID: "40000000-0000-4000-8000-0000000000a5",
            entityID: "30000000-0000-4000-8000-0000000000a5",
            name: "Ireland",
            aliases: ["Ирландия"],
            colors: ["#169B62", "#FFFFFF", "#FF883E"]
        ),
        Flag(
            deckCode: "EUROPE",
            cardID: "50000000-0000-4000-8000-0000000000a6",
            assetID: "40000000-0000-4000-8000-0000000000a6",
            entityID: "30000000-0000-4000-8000-0000000000a6",
            name: "Austria",
            aliases: ["Австрия"],
            colors: ["#ED2939", "#FFFFFF", "#ED2939"]
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
            "minimumClientVersion":"\(minimumClientVersion)",\
            "supportedTemplateSchemaVersions":[1],\
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

    /// A release leads with the vector original and follows it with the raster,
    /// and the mock says the same thing so the build actually exercises the
    /// choice the client makes rather than being handed the answer.
    private static func representations(of flag: Flag) -> String {
        """
        [{"url":"\(flag.vectorURL.absoluteString)","mimeType":"image/svg+xml",\
        "sha256":"\(flag.vectorSHA256)","scale":null,"widthPx":null,"heightPx":null},\
        {"url":"\(flag.url.absoluteString)","mimeType":"image/png",\
        "sha256":"\(flag.sha256)","scale":2,"widthPx":90,"heightPx":60}]
        """
    }

    /// - Parameter facts: whether the payload carries a back side fact, which
    ///   only the mapping test needs; every other caller wants the shape a card
    ///   has when the release publishes nothing about the country.
    public static func deckCardsResponse(facts: Bool = false) -> MockClientTransport.Response {
        let backSideFacts =
            facts
            ? """
            {"type":"CAPITAL","displayValue":"Paris","observedAt":null,\
            "source":{"name":"annexare/Countries","url":"https://example.invalid"}}
            """
            : ""
        let items = flags.map { flag in
            """
            {"id":"\(flag.cardID)","templateCode":"FLAG_TO_COUNTRY",\
            "templateSchemaVersion":1,"semanticVersion":1,"revision":1,\
            "answerMode":"SELF_RATED",\
            "prompt":{"asset":{"id":"\(flag.assetID)","type":"FLAG",\
            "representations":\(representations(of: flag)),\
            "width":90,"height":60,"aspectRatio":1.5,\
            "licenseName":"CC0-1.0","attribution":null}},\
            "answer":{"entityId":"\(flag.entityID)","displayName":"\(flag.name)",\
            "aliases":[\(flag.aliases.map { "\"\($0)\"" }.joined(separator: ","))]},\
            "backSideFacts":[\(backSideFacts)],"contentVersion":"\(contentVersion)"}
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

/// Serves this fixture's flags without a socket.
struct SyntheticAssetFetcher: AssetDataFetching {
    private let bytes: [URL: Data]

    public init(flags: [SyntheticContent.Flag] = SyntheticContent.flags) {
        // Both encodings are served because the release serves both. Only the
        // raster is ever asked for, and that is the client's choice to make.
        bytes = Dictionary(
            flags.flatMap { [($0.url, $0.data), ($0.vectorURL, $0.vectorData)] },
            uniquingKeysWith: { first, _ in first }
        )
    }

    public func data(from url: URL) async throws -> Data {
        guard let data = bytes[url] else {
            throw APIError.transport("No mock asset is registered for this URL")
        }
        return data
    }
}

extension UIColor {
    /// Parses the `#RRGGBB` form the mock flags are written in. It is only ever
    /// given literals from this file, so a malformed value is a programming
    /// error rather than input to defend against — it falls back to grey and
    /// the flag still renders.
    fileprivate convenience init(hex: String) {
        let digits = hex.dropFirst()
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self.init(white: 0.5, alpha: 1)
            return
        }
        self.init(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
