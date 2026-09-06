import CryptoKit
import Foundation
import CountryFlagsInfrastructure

/// The content the Mock build answers with: one published release, served whole.
///
/// The Mock scheme runs without a backend, and it is the only configuration of
/// this app that runs at all until one is deployed — so it decides what the app
/// is to anyone who launches it. It answers with the real release for two
/// reasons. A catalogue of six flags written out as lists of colours showed
/// nothing of the product; and a checksum computed from synthesised bytes can
/// never match the flags the app bundles, which left the ADR-011 baseline
/// undrawn in every build anyone could run.
///
/// The documents are generated from `content/generated/fixture-v1` by
/// `ios/Scripts/sync-mock-content.mjs` and read back here. Deriving them keeps
/// the mock from becoming a second definition of the content that drifts from
/// the real one, and `--check` fails the build when it has.
public enum MockContent {
    /// The release this build serves, and the one it bundles its flags from.
    /// Every checksum these documents publish is in the bundled index, so a
    /// Mock run draws the whole catalogue without a single download.
    public static let contentVersion = "fixture-v1"

    // MARK: - Documents

    /// - Returns: the bytes of a generated document. A missing one is a broken
    ///   build rather than a state to recover from: the resources are committed
    ///   next to the code that reads them.
    private static func document(_ name: String) -> Data {
        guard
            let url = Bundle.module.url(
                forResource: name,
                withExtension: "json",
                subdirectory: "MockContent"
            ),
            let data = try? Data(contentsOf: url)
        else {
            preconditionFailure("The Mock build is missing MockContent/\(name).json")
        }
        return data
    }

    /// The manifest is what a release is identified by, so its tag is the
    /// checksum of the document itself, as the backend computes it.
    private static func entityTag(of document: Data) -> String {
        let digest = SHA256.hash(data: document).map { String(format: "%02x", $0) }.joined()
        return "\"\(digest)\""
    }

    private struct DeckPage: Decodable {
        struct Item: Decodable {
            let id: String
            let code: String
        }

        let items: [Item]
    }

    /// Cards are served per deck, so the transport has to know which deck an
    /// identifier belongs to. A deck answering with another deck's cards would
    /// contradict the size it just reported.
    /// Keyed in lower case: the client parses an identifier into `UUID` and
    /// asks with `uuidString`, which is upper case, so matching the document
    /// verbatim would miss every deck.
    private static let deckCodesByID: [String: String] = {
        guard let page = try? JSONDecoder().decode(DeckPage.self, from: document("decks")) else {
            preconditionFailure("The generated deck page cannot be read")
        }
        return Dictionary(
            page.items.map { ($0.id.lowercased(), $0.code) },
            uniquingKeysWith: { first, _ in first }
        )
    }()

    /// The deck identifier out of `/v1/decks/{deckId}/cards`.
    private static func deckID(in path: String) -> String? {
        let components = path.split(separator: "/")
        guard let index = components.firstIndex(of: "decks"), index + 1 < components.count else {
            return nil
        }
        return String(components[index + 1])
    }

    // MARK: - Registration

    /// - Parameter commerce: what the mock backend says about access. The
    ///   release itself carries none: which deck costs money is a backend
    ///   fact, so it is projected onto the deck list here rather than written
    ///   into the generated documents, which stay exactly what
    ///   `sync-mock-content.mjs --check` produced.
    public static func responses(
        commerce: MockCommerce? = nil
    ) -> [String: MockClientTransport.Response] {
        let manifest = document("manifest")
        return [
            "getContentManifest": .json(manifest, headerFields: ["etag": entityTag(of: manifest)]),
            "listDecks": .json(decks(commerce: commerce)),
            // The mock release never changes under the app, so a refresh is a
            // no-op rather than a second bootstrap.
            "getContentChanges": .json(document("changes")),
        ]
    }

    public static func handlers(
        commerce: MockCommerce? = nil
    ) -> [String: MockClientTransport.Handler] {
        [
            "listDeckCards": { request in
                guard let id = deckID(in: request.path),
                    let code = deckCodesByID[id.lowercased()]
                else {
                    return .errorEnvelope(
                        statusCode: 404,
                        code: "NOT_FOUND",
                        message: "The mock release publishes no such deck"
                    )
                }
                guard commerce?.allowsCards(inDeckCoded: code) ?? true else {
                    // The guard, as the real one answers it: a paid deck
                    // refuses its cards rather than serving a shorter list,
                    // so the client can tell "not bought" from "empty deck".
                    return .errorEnvelope(
                        statusCode: 403,
                        code: "ENTITLEMENT_REQUIRED",
                        message: "This deck requires a purchase"
                    )
                }
                return .json(document("deck-cards-\(code)"))
            }
        ]
    }

    /// The generated deck list with the backend's own facts folded in: the
    /// access block of the deck that is for sale, and the three cards it
    /// publishes as a public preview.
    ///
    /// The preview is the deck's own first three cards, which is what the
    /// publisher would project: a preview invented here would draw flags the
    /// deck does not contain.
    private static func decks(commerce: MockCommerce?) -> Data {
        let stored = document("decks")
        guard let commerce,
            var page = try? JSONSerialization.jsonObject(with: stored) as? [String: Any],
            var items = page["items"] as? [[String: Any]]
        else {
            return stored
        }
        for index in items.indices {
            guard let code = items[index]["code"] as? String,
                let access = commerce.access(forDeckCoded: code)
            else {
                continue
            }
            items[index]["access"] = access
            if let cards = try? JSONSerialization.jsonObject(
                with: document("deck-cards-\(code)")
            ) as? [String: Any],
                let all = cards["items"] as? [[String: Any]] {
                items[index]["previewCards"] = Array(all.prefix(3))
            }
        }
        page["items"] = items
        return (try? JSONSerialization.data(withJSONObject: page)) ?? stored
    }
}

/// Refuses every asset download, because the Mock build should never need one.
///
/// The release it serves is the release the app bundles, so every flag resolves
/// out of the asset catalog before the cache is consulted. A request reaching
/// here means the bundled baseline missed, and saying so is more useful than
/// quietly serving bytes that would hide it.
public struct MockAssetFetcher: AssetDataFetching {
    public init() {}

    public func data(from url: URL) async throws -> Data {
        throw APIError.transport(
            "The Mock build bundles its flags and hosts none: \(url.lastPathComponent) was expected in the app"
        )
    }
}
