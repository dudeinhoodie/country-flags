import Foundation

import CountryFlagsDomain

/// The catalogue this build ships, ready to be stored.
///
/// ADR-011 put the drawings of one pinned release in the binary and left the
/// catalogue they belong to on the network, so a first launch with no network
/// waited out a request timeout and then said "you are offline" over three
/// empty tabs with 250 flags sitting unused beside it (#301). This is the
/// other half: the decks, cards, entities and assets of the same release, as a
/// document `ios/Scripts/sync-bundled-catalog.mjs` generates and CI checks for
/// drift. See docs/adr/ADR-021-bundled-catalogue-snapshot.md.
///
/// Two things it deliberately is not:
///
/// - a second content API. Nothing reads it after the store has a release; it
///   is what an empty store is filled from once, and the first successful sync
///   replaces it whole.
/// - a source of truth. It is stored under a content version of its own —
///   `bundled:<release>` — and under identifiers of its own, because a server
///   allocates identifiers this build cannot predict. Under the release's own
///   version the two sets would answer every read at once and every deck would
///   appear twice; under the publisher's own identifiers an arriving release
///   would rewrite these rows rather than land beside them, and the catalogue
///   would read empty for as long as the download took.
struct BundledCatalog: Sendable {
    private let document: Document

    init(data: Data) throws {
        document = try JSONDecoder().decode(Document.self, from: data)
    }

    /// The release the app was built with, or nil when the resource is missing
    /// or unreadable.
    ///
    /// A build with no catalogue is the app as it behaved before this existed —
    /// worse, not broken — so a decoding failure costs the seed and nothing
    /// else. It cannot cost the launch.
    static func shipped() -> BundledCatalog? {
        guard
            let url = Bundle.module.url(forResource: "BundledCatalog", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let catalog = try? BundledCatalog(data: data)
        else {
            return nil
        }
        return catalog
    }

    /// The records to store, in the language this device reads and at the scale
    /// this screen draws.
    ///
    /// The locale is resolved the way every content request resolves it, and
    /// the representation is chosen the way `ContentService` chooses one from a
    /// response — so what is seeded is what would have been downloaded, not a
    /// second interpretation of the release.
    func seed(
        preferredLanguages: [String],
        displayScale: Double,
        at date: Date
    ) -> BundledContentSeed? {
        guard let assetBaseURL = URL(string: document.manifest.assetBaseUrl) else {
            return nil
        }
        let locale = ContentLocaleResolver(preferredLanguages: preferredLanguages)
            .resolve(
                supported: document.manifest.supportedLocales,
                default: document.manifest.defaultLocale
            )
            .locale
        let version = document.contentVersion

        var assets: [UUID: AssetRecord] = [:]
        for asset in document.assets {
            guard
                let index = RenderableRepresentation.choose(
                    from: asset.representations.map {
                        RenderableRepresentation.Candidate(
                            mimeType: $0.mimeType,
                            scale: $0.scale.map(Double.init)
                        )
                    },
                    displayScale: displayScale
                ),
                let url = URL(string: asset.representations[index].url)
            else {
                // Nothing here this platform can draw. The card that prompts
                // with it is dropped below rather than shown as an empty frame.
                continue
            }
            let chosen = asset.representations[index]
            assets[asset.id] = AssetRecord(
                id: asset.id,
                type: asset.type,
                url: url,
                mimeType: chosen.mimeType,
                sha256: chosen.sha256,
                contentVersion: version,
                variant: asset.variant
            )
        }

        let entities = document.entities.map { entity in
            GeoEntityRecord(
                id: entity.id,
                kind: entity.kind,
                status: entity.status,
                recognitionStatus: entity.recognitionStatus,
                contentVersion: version,
                names: Self.names(entity.names, locale: locale),
                assets: (entity.assetIds ?? []).compactMap { assets[$0] },
                facts: Self.facts(entity.facts?[locale] ?? []),
                parent: entity.parent.map {
                    GeoEntityParentRecord(
                        id: $0.id,
                        kind: $0.kind,
                        name: $0.names[locale] ?? ""
                    )
                },
                identifiers: GeoEntityIdentifiersRecord(
                    isoSubdivision: entity.identifiers?.isoSubdivision,
                    localCode: entity.identifiers?.localCode,
                    fipsCode: entity.identifiers?.fipsCode
                )
            )
        }
        // The back of a card is the subject's facts, which is where the read
        // path gets them too — so they are carried once and read twice rather
        // than written into the document under both.
        let factsByEntity = Dictionary(
            document.entities.map { ($0.id, Self.facts($0.facts?[locale] ?? [])) },
            uniquingKeysWith: { first, _ in first }
        )

        var cards: [UUID: LearningCardRecord] = [:]
        for card in document.cards {
            guard let asset = assets[card.assetId] else { continue }
            let answer = card.answers[locale]
            cards[card.id] = LearningCardRecord(
                id: card.id,
                subjectEntityID: card.entityId,
                templateCode: card.templateCode,
                templateSchemaVersion: card.templateSchemaVersion,
                semanticVersion: card.semanticVersion,
                revision: card.revision,
                answerMode: card.answerMode,
                promptAssetID: asset.id,
                displayName: answer?.displayName ?? "",
                aliases: answer?.aliases ?? [],
                contentVersion: version,
                backSideFacts: factsByEntity[card.entityId] ?? []
            )
        }

        var decks: [DeckRecord] = []
        var memberships: [DeckCardRecord] = []
        for (index, deck) in document.decks.enumerated() {
            let text = deck.names[locale]
            decks.append(
                DeckRecord(
                    id: deck.id,
                    code: deck.code,
                    kind: deck.kind,
                    name: text?.name ?? deck.code,
                    deckDescription: text?.description ?? "",
                    cardCount: deck.cardCount,
                    contentVersion: version,
                    // The order the release lists them in, which is the order
                    // the deck list is served in.
                    sortOrder: index,
                    accessModel: deck.access.model,
                    requiredEntitlementKey: deck.access.requiredEntitlementKey,
                    offerCodes: deck.access.offerCodes ?? [],
                    contentKinds: deck.contentKinds ?? [],
                    previewCardIDs: deck.previewCardIds ?? []
                )
            )
            for (order, cardID) in (deck.cardIds ?? []).enumerated() where cards[cardID] != nil {
                memberships.append(
                    DeckCardRecord(deckID: deck.id, learningCardID: cardID, sortOrder: order)
                )
            }
        }

        return BundledContentSeed(
            manifest: ContentManifestRecord(
                contentVersion: version,
                defaultLocale: document.manifest.defaultLocale,
                supportedLocales: document.manifest.supportedLocales,
                supportedTemplateSchemaVersions:
                    document.manifest.supportedTemplateSchemaVersions,
                assetBaseURL: assetBaseURL,
                changeCursor: document.manifest.changeCursor,
                // A release the device did not fetch over the wire carries no
                // signature to record. What identifies these bytes is the
                // manifest of the publication they were projected from, and
                // the generator writes its checksum here.
                checksum: document.releaseChecksum,
                appliedAt: date
            ),
            page: ContentPage(
                entities: entities,
                decks: decks,
                cards: Array(cards.values),
                deckCards: memberships,
                assets: Array(assets.values)
            )
        )
    }

    /// The names one locale reads, as the entity read path builds them: the
    /// short name, and the official one when the release publishes a different
    /// one.
    private static func names(
        _ names: [String: Document.Name],
        locale: String
    ) -> [GeoNameRecord] {
        guard let name = names[locale] else { return [] }
        var records = [GeoNameRecord(locale: locale, value: name.short, isPrimary: true)]
        if let official = name.official, official != name.short {
            records.append(GeoNameRecord(locale: locale, value: official, isPrimary: false))
        }
        return records
    }

    private static func facts(_ facts: [Document.Fact]) -> [FactRecord] {
        facts.map {
            FactRecord(
                type: $0.type,
                displayValue: $0.displayValue,
                sourceName: $0.source,
                details: $0.details?.record
            )
        }
    }
}

extension BundledCatalog {
    /// The document as it is written, which is the shape of the generator's
    /// output and nothing else.
    ///
    /// It is not the contract's shape: a response localizes for one request
    /// while this carries every language the release published, so the device
    /// picks after the fact rather than the build guessing which one to ship.
    fileprivate struct Document: Decodable, Sendable {
        let contentVersion: String
        let releaseVersion: String
        let releaseChecksum: String
        let manifest: Manifest
        let assets: [Asset]
        let entities: [Entity]
        let cards: [Card]
        let decks: [Deck]

        struct Manifest: Decodable, Sendable {
            let defaultLocale: String
            let supportedLocales: [String]
            let supportedTemplateSchemaVersions: [Int]
            let assetBaseUrl: String
            let changeCursor: String
        }

        struct Asset: Decodable, Sendable {
            let id: UUID
            let type: String
            let variant: String
            let representations: [Representation]

            struct Representation: Decodable, Sendable {
                let url: String
                let mimeType: String
                let sha256: String
                let scale: Int?
            }
        }

        struct Name: Decodable, Sendable {
            let short: String
            let official: String?
        }

        struct Entity: Decodable, Sendable {
            let id: UUID
            let kind: String
            let status: String
            let recognitionStatus: String
            let names: [String: Name]
            /// Absent from the document wherever the release publishes none:
            /// the generator writes no empty lists and no nulls, which is a
            /// tenth of a megabyte of binary across 250 entities.
            let assetIds: [UUID]?
            let facts: [String: [Fact]]?
            let parent: Parent?
            let identifiers: Identifiers?

            struct Parent: Decodable, Sendable {
                let id: UUID
                let kind: String
                let names: [String: String]
            }

            struct Identifiers: Decodable, Sendable {
                let isoSubdivision: String?
                let localCode: String?
                let fipsCode: String?
            }
        }

        struct Fact: Decodable, Sendable {
            let type: String
            let displayValue: String
            /// The name of the source, which is all the record keeps.
            let source: String
            let details: Details?

            /// The parts, in the shape the contract sends them — a `kind`
            /// discriminator rather than Swift's synthesised enum encoding, so
            /// this is decoded by hand and handed over as the domain value.
            struct Details: Decodable, Sendable {
                let record: FactDetails?

                private enum CodingKeys: String, CodingKey {
                    case kind, seats, tenders, languages, value, year
                }

                init(from decoder: any Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    switch try container.decode(String.self, forKey: .kind) {
                    case "capital":
                        record = .capital(
                            seats: try container.decode([Seat].self, forKey: .seats)
                                .map { .init(name: $0.name, role: $0.role) }
                        )
                    case "currency":
                        record = .currency(
                            tenders: try container.decode([Tender].self, forKey: .tenders)
                                .map { .init(code: $0.code, name: $0.name, role: $0.role) }
                        )
                    case "language":
                        record = .language(
                            languages: try container.decode([Language].self, forKey: .languages)
                                .map { .init(code: $0.code, name: $0.name) }
                        )
                    case "population":
                        record = .population(
                            value: try container.decode(Int.self, forKey: .value),
                            year: try container.decodeIfPresent(Int.self, forKey: .year)
                        )
                    default:
                        // A shape published after this build. The composed line
                        // is what the reader sees then, exactly as it arrived.
                        record = nil
                    }
                }

                private struct Seat: Decodable { let name: String; let role: String? }
                private struct Tender: Decodable {
                    let code: String
                    let name: String
                    let role: String?
                }
                private struct Language: Decodable { let code: String?; let name: String }
            }
        }

        struct Card: Decodable, Sendable {
            let id: UUID
            let entityId: UUID
            let assetId: UUID
            let templateCode: String
            let templateSchemaVersion: Int
            let semanticVersion: Int
            let revision: Int
            let answerMode: String
            let answers: [String: Answer]

            struct Answer: Decodable, Sendable {
                let displayName: String
                let aliases: [String]?
            }
        }

        struct Deck: Decodable, Sendable {
            let id: UUID
            let code: String
            let kind: String
            let names: [String: Text]
            let cardCount: Int
            let contentKinds: [String]?
            let access: Access
            let cardIds: [UUID]?
            let previewCardIds: [UUID]?

            struct Text: Decodable, Sendable {
                let name: String
                let description: String
            }

            struct Access: Decodable, Sendable {
                let model: String
                let requiredEntitlementKey: String?
                let offerCodes: [String]?
            }
        }
    }
}
