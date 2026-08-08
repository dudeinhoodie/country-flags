import Foundation
import SwiftData

import CountryFlagsDomain

/// Content is shared by every account, so nothing here filters by scope.
@ModelActor
actor SwiftDataContentRepository: ContentRepository {
    func currentManifest() async throws -> ContentManifestRecord? {
        var descriptor = FetchDescriptor<StoredContentManifest>(
            predicate: #Predicate { $0.isCurrent }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first.map(Self.record)
    }

    /// The manifest becomes current only after its records are in place, in one
    /// transaction: a release that failed halfway must not be readable as the
    /// current one, and the previous release stays usable meanwhile.
    func applyContent(
        manifest: ContentManifestRecord,
        entities: [GeoEntityRecord],
        decks: [DeckRecord],
        cards: [LearningCardRecord],
        deckCards: [DeckCardRecord]
    ) async throws {
        try transaction {
            for entity in entities {
                let stored = StoredGeoEntity(
                    id: entity.id,
                    kind: entity.kind,
                    status: entity.status,
                    recognitionStatus: entity.recognitionStatus,
                    contentVersion: entity.contentVersion
                )
                modelContext.insert(stored)
                stored.names = entity.names.map {
                    StoredGeoName(locale: $0.locale, value: $0.value, isPrimary: $0.isPrimary)
                }
                stored.assets = entity.assets.map {
                    StoredAsset(
                        id: $0.id,
                        type: $0.type,
                        url: $0.url,
                        mimeType: $0.mimeType,
                        sha256: $0.sha256,
                        contentVersion: $0.contentVersion
                    )
                }
                stored.facts = entity.facts.map {
                    StoredFact(
                        type: $0.type,
                        displayValue: $0.displayValue,
                        sourceName: $0.sourceName
                    )
                }
            }

            for deck in decks {
                modelContext.insert(
                    StoredDeck(
                        id: deck.id,
                        code: deck.code,
                        kind: deck.kind,
                        name: deck.name,
                        deckDescription: deck.deckDescription,
                        cardCount: deck.cardCount,
                        contentVersion: deck.contentVersion,
                        sortOrder: deck.sortOrder
                    )
                )
            }

            for card in cards {
                modelContext.insert(
                    StoredLearningCard(
                        id: card.id,
                        subjectEntityID: card.subjectEntityID,
                        templateCode: card.templateCode,
                        templateSchemaVersion: card.templateSchemaVersion,
                        semanticVersion: card.semanticVersion,
                        revision: card.revision,
                        answerMode: card.answerMode,
                        promptAssetID: card.promptAssetID,
                        displayName: card.displayName,
                        aliases: card.aliases,
                        contentVersion: card.contentVersion,
                        isRetired: card.isRetired
                    )
                )
            }

            for membership in deckCards {
                modelContext.insert(
                    StoredDeckCard(
                        deckID: membership.deckID,
                        learningCardID: membership.learningCardID,
                        sortOrder: membership.sortOrder
                    )
                )
            }

            for previous in try modelContext.fetch(
                FetchDescriptor<StoredContentManifest>(predicate: #Predicate { $0.isCurrent })
            ) {
                previous.isCurrent = false
            }
            modelContext.insert(
                StoredContentManifest(
                    contentVersion: manifest.contentVersion,
                    defaultLocale: manifest.defaultLocale,
                    supportedLocales: manifest.supportedLocales,
                    supportedTemplateSchemaVersions: manifest.supportedTemplateSchemaVersions,
                    assetBaseURL: manifest.assetBaseURL,
                    changeCursor: manifest.changeCursor,
                    checksum: manifest.checksum,
                    appliedAt: manifest.appliedAt,
                    isCurrent: true
                )
            )
        }
    }

    func decks() async throws -> [DeckRecord] {
        let descriptor = FetchDescriptor<StoredDeck>(
            sortBy: [SortDescriptor(\.sortOrder), SortDescriptor(\.code)]
        )
        return try modelContext.fetch(descriptor).map(Self.record)
    }

    func cards(inDeck deckID: UUID) async throws -> [LearningCardRecord] {
        let memberships = try modelContext.fetch(
            FetchDescriptor<StoredDeckCard>(predicate: #Predicate { $0.deckID == deckID })
        )
        // A retired card is excluded from selection but stays readable through
        // the snapshot a running session already holds.
        let identifiers = Set(memberships.map(\.learningCardID))
        let cards = try modelContext.fetch(
            FetchDescriptor<StoredLearningCard>(predicate: #Predicate { !$0.isRetired })
        )
        let order = Dictionary(
            memberships.map { ($0.learningCardID, $0.sortOrder ?? Int.max) },
            uniquingKeysWith: { first, _ in first }
        )
        return cards
            .filter { identifiers.contains($0.id) }
            .sorted {
                (order[$0.id] ?? .max, $0.displayName) < (order[$1.id] ?? .max, $1.displayName)
            }
            .map(Self.record)
    }

    func entity(id: UUID) async throws -> GeoEntityRecord? {
        var descriptor = FetchDescriptor<StoredGeoEntity>(
            predicate: #Predicate { $0.id == id && !$0.isRetired }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first.map(Self.record)
    }

    /// A tombstone from the change feed retires the record instead of deleting
    /// it: an unfinished session still needs to render the card it started
    /// with.
    func retire(cardIDs: [UUID], entityIDs: [UUID]) async throws {
        try transaction {
            let cards = try modelContext.fetch(FetchDescriptor<StoredLearningCard>())
            for card in cards where cardIDs.contains(card.id) {
                card.isRetired = true
            }
            let entities = try modelContext.fetch(FetchDescriptor<StoredGeoEntity>())
            for entity in entities where entityIDs.contains(entity.id) {
                entity.isRetired = true
            }
        }
    }

    // MARK: - Mapping

    private static func record(_ stored: StoredContentManifest) -> ContentManifestRecord {
        ContentManifestRecord(
            contentVersion: stored.contentVersion,
            defaultLocale: stored.defaultLocale,
            supportedLocales: stored.supportedLocales,
            supportedTemplateSchemaVersions: stored.supportedTemplateSchemaVersions,
            assetBaseURL: stored.assetBaseURL,
            changeCursor: stored.changeCursor,
            checksum: stored.checksum,
            appliedAt: stored.appliedAt
        )
    }

    private static func record(_ stored: StoredDeck) -> DeckRecord {
        DeckRecord(
            id: stored.id,
            code: stored.code,
            kind: stored.kind,
            name: stored.name,
            deckDescription: stored.deckDescription,
            cardCount: stored.cardCount,
            contentVersion: stored.contentVersion,
            sortOrder: stored.sortOrder
        )
    }

    private static func record(_ stored: StoredLearningCard) -> LearningCardRecord {
        LearningCardRecord(
            id: stored.id,
            subjectEntityID: stored.subjectEntityID,
            templateCode: stored.templateCode,
            templateSchemaVersion: stored.templateSchemaVersion,
            semanticVersion: stored.semanticVersion,
            revision: stored.revision,
            answerMode: stored.answerMode,
            promptAssetID: stored.promptAssetID,
            displayName: stored.displayName,
            aliases: stored.aliases,
            contentVersion: stored.contentVersion,
            isRetired: stored.isRetired
        )
    }

    private static func record(_ stored: StoredGeoEntity) -> GeoEntityRecord {
        GeoEntityRecord(
            id: stored.id,
            kind: stored.kind,
            status: stored.status,
            recognitionStatus: stored.recognitionStatus,
            contentVersion: stored.contentVersion,
            names: (stored.names ?? []).map {
                GeoNameRecord(locale: $0.locale, value: $0.value, isPrimary: $0.isPrimary)
            },
            assets: (stored.assets ?? []).map {
                AssetRecord(
                    id: $0.id,
                    type: $0.type,
                    url: $0.url,
                    mimeType: $0.mimeType,
                    sha256: $0.sha256,
                    contentVersion: $0.contentVersion
                )
            },
            facts: (stored.facts ?? []).map {
                FactRecord(
                    type: $0.type,
                    displayValue: $0.displayValue,
                    sourceName: $0.sourceName
                )
            }
        )
    }
}
