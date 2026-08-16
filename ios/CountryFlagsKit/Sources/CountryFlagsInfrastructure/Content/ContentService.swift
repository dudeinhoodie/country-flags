import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// One page of a cursor-paged content feed.
public struct ContentCursorPage<Element: Sendable>: Sendable {
    public let items: [Element]
    /// The cursor to send for the next page, or nil when the feed is exhausted.
    public let nextCursor: String?
    public let hasMore: Bool

    public init(items: [Element], nextCursor: String?, hasMore: Bool) {
        self.items = items
        self.nextCursor = nextCursor
        self.hasMore = hasMore
    }
}

/// What one page of a deck's cards yields.
public struct ContentCardPage: Sendable {
    public let cards: [LearningCardRecord]
    public let deckCards: [DeckCardRecord]
    public let assets: [AssetRecord]
    public let nextCursor: String?
    public let hasMore: Bool
    /// Cards this build cannot render, reported rather than dropped silently so
    /// the count can reach diagnostics.
    public let unsupportedCardIDs: [UUID]

    public init(
        cards: [LearningCardRecord],
        deckCards: [DeckCardRecord],
        assets: [AssetRecord],
        nextCursor: String?,
        hasMore: Bool,
        unsupportedCardIDs: [UUID]
    ) {
        self.cards = cards
        self.deckCards = deckCards
        self.assets = assets
        self.nextCursor = nextCursor
        self.hasMore = hasMore
        self.unsupportedCardIDs = unsupportedCardIDs
    }
}

/// The manifest plus the two facts about it that are not part of the stored
/// record: the tag that makes the next fetch cheap and the version gate.
public struct ContentManifestFetch: Sendable {
    public let manifest: ContentManifestRecord
    public let minimumClientVersion: String
    public let entityTag: String?

    public init(manifest: ContentManifestRecord, minimumClientVersion: String, entityTag: String?) {
        self.manifest = manifest
        self.minimumClientVersion = minimumClientVersion
        self.entityTag = entityTag
    }
}

public enum ContentManifestResult: Sendable {
    case updated(ContentManifestFetch)
    /// The entity tag still matches, so the stored manifest stands.
    case notModified
}

/// One page of the change feed, already sorted into what the store does with it.
public struct ContentChangeBatch: Sendable {
    public let upsertedEntityIDs: [UUID]
    public let retiredEntityIDs: [UUID]
    public let retiredCardIDs: [UUID]
    /// Resource types this build does not handle. They are counted rather than
    /// treated as an error: a feed that grew a new kind must not stop the ones
    /// this build does understand from being applied.
    public let ignoredResourceTypes: [String]
    public let nextCursor: String
    public let hasMore: Bool
    public let contentVersion: String
}

/// Reads content from the backend and hands back domain records.
///
/// The generated DTOs never leave this type. Everything above it works with the
/// records the store speaks, which is what keeps a contract change from
/// reaching a view model.
public struct ContentService: Sendable {
    private let clientFactory: APIClientFactory
    private let dates: any DateProviding

    public init(clientFactory: APIClientFactory, dates: any DateProviding = SystemDateProvider()) {
        self.clientFactory = clientFactory
        self.dates = dates
    }

    // MARK: - Manifest

    public func manifest(locale: String, entityTag: String? = nil) async throws -> ContentManifestResult {
        let client = clientFactory.makeClient()
        let output: Operations.getContentManifest.Output
        do {
            output = try await client.getContentManifest(
                query: .init(locale: locale),
                headers: .init(If_hyphen_None_hyphen_Match: entityTag)
            )
        } catch {
            throw APIError.from(error)
        }

        switch output {
        case .notModified:
            return .notModified
        case .ok(let response):
            let payload = try response.body.json
            guard let assetBaseURL = URL(string: payload.assetBaseUrl) else {
                throw APIError.decoding("The manifest asset base URL is not a URL")
            }
            return .updated(
                ContentManifestFetch(
                    manifest: ContentManifestRecord(
                        contentVersion: payload.contentVersion,
                        defaultLocale: payload.defaultLocale,
                        importedLocale: locale,
                        supportedLocales: payload.supportedLocales,
                        supportedTemplateSchemaVersions: payload.supportedTemplateSchemaVersions,
                        assetBaseURL: assetBaseURL,
                        changeCursor: payload.changeCursor,
                        // The signature is what the release is verified by, so
                        // it is the value worth storing as the integrity mark
                        // of the manifest this device applied.
                        checksum: Data(payload.signature.value.data).base64EncodedString(),
                        appliedAt: dates.now()
                    ),
                    minimumClientVersion: payload.minimumClientVersion,
                    entityTag: response.headers.ETag
                )
            )
        case .default(let statusCode, _):
            throw Self.unmapped(statusCode)
        }
    }

    // MARK: - Catalog

    /// - Parameter sortOffset: how many decks the caller has already applied.
    ///   The cursor is opaque, so the position cannot be read out of it, and
    ///   without an offset every page would number its records from zero and
    ///   the second page would sort into the first.
    public func decks(
        locale: String,
        cursor: String? = nil,
        limit: Int? = nil,
        sortOffset: Int = 0
    ) async throws -> ContentCursorPage<DeckRecord> {
        let client = clientFactory.makeClient()
        let output: Operations.listDecks.Output
        do {
            output = try await client.listDecks(query: .init(locale: locale, cursor: cursor, limit: limit))
        } catch {
            throw APIError.from(error)
        }

        switch output {
        case .ok(let response):
            let payload = try response.body.json
            // The list order is the backend's, and the offset is what makes it
            // stable across pages: a deck on page two must not sort above one
            // on page one.
            let offset = sortOffset
            let decks = payload.items.enumerated().compactMap { index, deck -> DeckRecord? in
                // The contract types an identifier as a string. One that is not
                // a UUID is a deck this build could never address again, so it
                // is dropped rather than stored under a fabricated identifier.
                guard let id = UUID(uuidString: deck.id) else { return nil }
                return DeckRecord(
                    id: id,
                    code: deck.code,
                    kind: deck.kind,
                    name: deck.name,
                    deckDescription: deck.description,
                    cardCount: deck.cardCount,
                    contentVersion: deck.contentVersion,
                    sortOrder: offset + index
                )
            }
            return ContentCursorPage(
                items: decks,
                nextCursor: payload.page.nextCursor,
                hasMore: payload.page.hasMore
            )
        case .default(let statusCode, _):
            throw Self.unmapped(statusCode)
        }
    }

    /// - Parameter supportedTemplateSchemaVersions: from the manifest being
    ///   applied. A card built on a template this release does not list is
    ///   skipped, which is what keeps one unknown card from emptying a deck.
    public func cards(
        inDeck deckID: UUID,
        locale: String,
        cursor: String? = nil,
        limit: Int? = nil,
        sortOffset: Int = 0,
        supportedTemplateSchemaVersions: [Int]
    ) async throws -> ContentCardPage {
        let client = clientFactory.makeClient()
        let output: Operations.listDeckCards.Output
        do {
            output = try await client.listDeckCards(
                path: .init(deckId: deckID.uuidString),
                query: .init(locale: locale, cursor: cursor, limit: limit)
            )
        } catch {
            throw APIError.from(error)
        }

        switch output {
        case .ok(let response):
            let payload = try response.body.json
            let supported = Set(supportedTemplateSchemaVersions)
            let offset = sortOffset

            var cards: [LearningCardRecord] = []
            var deckCards: [DeckCardRecord] = []
            var assets: [AssetRecord] = []
            var unsupported: [UUID] = []

            for (index, card) in payload.items.enumerated() {
                guard
                    let cardID = UUID(uuidString: card.id),
                    let entityID = UUID(uuidString: card.answer.entityId)
                else {
                    continue
                }
                guard supported.contains(card.templateSchemaVersion) else {
                    unsupported.append(cardID)
                    continue
                }
                guard
                    let asset = Self.assetRecord(
                        card.prompt.asset,
                        contentVersion: card.contentVersion
                    )
                else {
                    // A prompt with no usable URL is a card that would draw an
                    // empty frame, which is worse than one fewer country.
                    unsupported.append(cardID)
                    continue
                }

                assets.append(asset)
                cards.append(
                    LearningCardRecord(
                        id: cardID,
                        subjectEntityID: entityID,
                        templateCode: card.templateCode,
                        templateSchemaVersion: card.templateSchemaVersion,
                        semanticVersion: card.semanticVersion,
                        revision: card.revision,
                        answerMode: card.answerMode.rawValue,
                        promptAssetID: asset.id,
                        displayName: card.answer.displayName,
                        aliases: card.answer.aliases,
                        contentVersion: card.contentVersion,
                        backSideFacts: (card.backSideFacts ?? []).map {
                            FactRecord(
                                type: $0._type,
                                displayValue: $0.displayValue,
                                sourceName: $0.source.name
                            )
                        }
                    )
                )
                deckCards.append(
                    DeckCardRecord(
                        deckID: deckID,
                        learningCardID: cardID,
                        sortOrder: offset + index
                    )
                )
            }

            return ContentCardPage(
                cards: cards,
                deckCards: deckCards,
                assets: assets,
                nextCursor: payload.page.nextCursor,
                hasMore: payload.page.hasMore,
                unsupportedCardIDs: unsupported
            )
        case .notFound:
            throw APIError.status(
                APIErrorDetails(
                    statusCode: 404,
                    code: "NOT_FOUND",
                    message: "The deck is not published",
                    requestID: nil
                )
            )
        case .default(let statusCode, _):
            throw Self.unmapped(statusCode)
        }
    }

    // MARK: - Changes

    public func changes(after cursor: String, locale: String, limit: Int? = nil) async throws
        -> ContentChangeBatch
    {
        let client = clientFactory.makeClient()
        let output: Operations.getContentChanges.Output
        do {
            output = try await client.getContentChanges(
                query: .init(after: cursor, locale: locale, limit: limit)
            )
        } catch {
            throw APIError.from(error)
        }

        switch output {
        case .ok(let response):
            let payload = try response.body.json
            var upsertedEntities: [UUID] = []
            var retiredEntities: [UUID] = []
            var retiredCards: [UUID] = []
            var ignored: [String] = []

            for change in payload.items {
                guard let resourceID = UUID(uuidString: change.resourceId) else { continue }
                let isRetire = change.operation == .RETIRE
                switch change.resourceType {
                case "ENTITY":
                    if isRetire {
                        retiredEntities.append(resourceID)
                    } else {
                        upsertedEntities.append(resourceID)
                    }
                case "LEARNING_CARD":
                    // Only a tombstone is actionable here. An upserted card is
                    // picked up by the deck page it belongs to, which is where
                    // its membership and order come from.
                    if isRetire { retiredCards.append(resourceID) }
                default:
                    ignored.append(change.resourceType)
                }
            }

            return ContentChangeBatch(
                upsertedEntityIDs: upsertedEntities,
                retiredEntityIDs: retiredEntities,
                retiredCardIDs: retiredCards,
                ignoredResourceTypes: ignored,
                nextCursor: payload.nextCursor,
                hasMore: payload.hasMore,
                contentVersion: payload.contentVersion
            )
        case .default(let statusCode, _):
            throw Self.unmapped(statusCode)
        }
    }

    // MARK: - Entities

    /// - Returns: nil when the entity is not readable, which the contract uses
    ///   for content hidden from the catalog. The matching tombstone is what
    ///   removes it locally, so a miss here is not an error.
    public func entity(id: UUID, locale: String) async throws -> GeoEntityRecord? {
        let client = clientFactory.makeClient()
        let output: Operations.getEntity.Output
        do {
            output = try await client.getEntity(
                path: .init(entityId: id.uuidString),
                query: .init(locale: locale)
            )
        } catch {
            // The error mapping middleware turns a 404 into an `APIError`
            // before the generated client ever parses the response, so this is
            // where a hidden entity actually arrives — not the `.notFound`
            // case below.
            if case .notFound = APIError.from(error) { return nil }
            throw APIError.from(error)
        }

        switch output {
        case .ok(let response):
            let payload = try response.body.json
            guard let entityID = UUID(uuidString: payload.id) else {
                throw APIError.decoding("The entity identifier is not a UUID")
            }
            // The backend localizes per request, so an entity carries one name
            // for the locale that was asked for rather than every language.
            var names = [GeoNameRecord(locale: locale, value: payload.name.short, isPrimary: true)]
            if let official = payload.name.official, official != payload.name.short {
                names.append(GeoNameRecord(locale: locale, value: official, isPrimary: false))
            }

            return GeoEntityRecord(
                id: entityID,
                kind: payload.kind,
                status: payload.status.rawValue,
                recognitionStatus: payload.recognitionStatus,
                contentVersion: payload.contentVersion,
                names: names,
                assets: payload.assets.compactMap {
                    Self.assetRecord($0, contentVersion: payload.contentVersion)
                },
                facts: payload.facts.map {
                    FactRecord(
                        type: $0._type,
                        displayValue: $0.displayValue,
                        sourceName: $0.source.name
                    )
                }
            )
        case .notFound:
            return nil
        case .default(let statusCode, _):
            throw Self.unmapped(statusCode)
        }
    }

    // MARK: - Helpers

    /// The asset as this build will draw it: the first representation it can
    /// decode, carrying the checksum of those bytes rather than of the vector.
    ///
    /// The cache verifies and stores what it downloaded, so the record has to
    /// describe one encoding end to end — a vector URL paired with a raster
    /// checksum would fail every verification.
    ///
    /// - Returns: nil when the identifier or the URL is unusable. A release
    ///   that offers nothing renderable still yields a record, built from the
    ///   asset's own vector, and the placeholder is what it draws.
    private static func assetRecord(
        _ asset: Components.Schemas.Asset,
        contentVersion: String
    ) -> AssetRecord? {
        let chosen = asset.representations?.first {
            RenderableRepresentation.canRender($0.mimeType.rawValue)
        }
        // A release published before representations existed describes only the
        // vector, on the asset itself.
        guard
            let id = UUID(uuidString: asset.id),
            let url = URL(string: chosen?.url ?? asset.url)
        else {
            return nil
        }
        return AssetRecord(
            id: id,
            type: asset._type,
            url: url,
            mimeType: chosen?.mimeType.rawValue ?? asset.mimeType.rawValue,
            sha256: chosen?.sha256 ?? asset.sha256,
            contentVersion: contentVersion
        )
    }

    private static func unmapped(_ statusCode: Int) -> APIError {
        // Unreachable in practice: the error mapping middleware turns every
        // status at or above 400 into an `APIError` before the generated client
        // parses it. Handled rather than ignored so a contract change cannot
        // silently produce a success here.
        APIError.status(
            APIErrorDetails(
                statusCode: statusCode,
                code: "UNKNOWN",
                message: "Unmapped error response",
                requestID: nil
            )
        )
    }
}
