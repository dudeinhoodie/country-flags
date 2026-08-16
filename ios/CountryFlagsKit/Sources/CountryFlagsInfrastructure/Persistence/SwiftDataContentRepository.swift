import Foundation
import SwiftData

import CountryFlagsDomain

/// Content is shared by every account, so nothing here filters by scope.
///
/// Reads answer from the release the current manifest names. Records of a
/// version that is still downloading are already in the store but invisible,
/// which is how the previous catalog stays usable while the next one arrives
/// and how a half-applied release is never something the user can open.
@ModelActor
actor SwiftDataContentRepository: ContentRepository {
    func currentManifest() async throws -> ContentManifestRecord? {
        try currentStoredManifest().map(Self.record)
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
            try upsert(
                ContentPage(entities: entities, decks: decks, cards: cards, deckCards: deckCards)
            )
            try makeCurrent(manifest)
            try clearStagingState(forVersion: manifest.contentVersion)
        }
    }

    func applyStagedPage(_ page: ContentPage, staging: ContentStagingState) async throws {
        try transaction {
            try upsert(page)
            try write(staging)
        }
    }

    func stagingState(forVersion contentVersion: String) async throws -> ContentStagingState? {
        try storedStagingState(forVersion: contentVersion).map(Self.record)
    }

    func commitRelease(manifest: ContentManifestRecord) async throws {
        try transaction {
            try makeCurrent(manifest)
            try clearStagingState(forVersion: manifest.contentVersion)
        }
    }

    func decks() async throws -> [DeckRecord] {
        guard let version = try currentStoredManifest()?.contentVersion else { return [] }
        let descriptor = FetchDescriptor<StoredDeck>(
            predicate: #Predicate { $0.contentVersion == version },
            sortBy: [SortDescriptor(\.sortOrder), SortDescriptor(\.code)]
        )
        return try modelContext.fetch(descriptor).map(Self.record)
    }

    func cards(inDeck deckID: UUID) async throws -> [LearningCardRecord] {
        guard let version = try currentStoredManifest()?.contentVersion else { return [] }
        let memberships = try modelContext.fetch(
            FetchDescriptor<StoredDeckCard>(predicate: #Predicate { $0.deckID == deckID })
        )
        // A retired card is excluded from selection but stays readable through
        // the snapshot a running session already holds.
        let identifiers = Set(memberships.map(\.learningCardID))
        let cards = try modelContext.fetch(
            FetchDescriptor<StoredLearningCard>(
                predicate: #Predicate { !$0.isRetired && $0.contentVersion == version }
            )
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

    func cardIdentifiersByDeck() async throws -> [UUID: [UUID]] {
        guard let version = try currentStoredManifest()?.contentVersion else { return [:] }
        // One pass over the memberships and one over the cards, whatever the
        // number of decks: the per-deck query would read the whole catalogue
        // again for each of them.
        let live = Set(
            try modelContext.fetch(
                FetchDescriptor<StoredLearningCard>(
                    predicate: #Predicate { !$0.isRetired && $0.contentVersion == version }
                )
            ).map(\.id)
        )
        var identifiers: [UUID: [UUID]] = [:]
        for membership in try modelContext.fetch(FetchDescriptor<StoredDeckCard>())
        where live.contains(membership.learningCardID) {
            identifiers[membership.deckID, default: []].append(membership.learningCardID)
        }
        return identifiers
    }

    func card(id: UUID) async throws -> LearningCardRecord? {
        var descriptor = FetchDescriptor<StoredLearningCard>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first.map(Self.record)
    }

    /// Resolving one entity is deliberately not filtered by the current
    /// release, unlike the two listings above.
    ///
    /// A listing has to be coherent: a catalog that mixed a finished release
    /// with one still downloading would show decks that lead nowhere. Resolving
    /// an identifier is the opposite case — a session that started on the
    /// previous release holds identifiers from it and still has to render them,
    /// which is why a superseded record stays readable and only a tombstone
    /// takes it out.
    func entity(id: UUID) async throws -> GeoEntityRecord? {
        var descriptor = FetchDescriptor<StoredGeoEntity>(
            predicate: #Predicate { $0.id == id && !$0.isRetired }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first.map(Self.record)
    }

    func asset(id: UUID) async throws -> AssetRecord? {
        var descriptor = FetchDescriptor<StoredAsset>(predicate: #Predicate { $0.id == id })
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

    // MARK: - Writing

    /// Writes a page over whatever is already stored for the same identifiers.
    ///
    /// The schema states uniqueness through the repository rather than through
    /// `#Unique`, which needs a deployment target this app does not have, so
    /// every write reads first. Without it a replayed page — the normal outcome
    /// of a download interrupted between the request and the commit — would
    /// duplicate every record it carries.
    private func upsert(_ page: ContentPage) throws {
        for entity in page.entities {
            let stored = try existingEntity(id: entity.id) ?? insertEntity(id: entity.id)
            stored.kind = entity.kind
            stored.status = entity.status
            stored.recognitionStatus = entity.recognitionStatus
            stored.contentVersion = entity.contentVersion
            // The children are owned by the entity and cascade-deleted with it,
            // so replacing the arrays is what keeps a renamed or withdrawn name
            // from surviving its release.
            stored.names = entity.names.map {
                StoredGeoName(locale: $0.locale, value: $0.value, isPrimary: $0.isPrimary)
            }
            stored.facts = entity.facts.map {
                StoredFact(type: $0.type, displayValue: $0.displayValue, sourceName: $0.sourceName)
            }
            // Assets are upserted by identifier rather than rebuilt with the
            // rest of the children, because a card refers to one directly and
            // cascade-deleting it here would break a snapshot that is still in
            // use. Names and facts have no such reference and are replaced.
            for asset in entity.assets {
                try upsertAsset(asset, attachedTo: stored)
            }
        }

        for asset in page.assets {
            try upsertAsset(asset, attachedTo: nil)
        }

        for deck in page.decks {
            let stored = try existingDeck(id: deck.id) ?? insertDeck(id: deck.id)
            stored.code = deck.code
            stored.kind = deck.kind
            stored.name = deck.name
            stored.deckDescription = deck.deckDescription
            stored.cardCount = deck.cardCount
            stored.contentVersion = deck.contentVersion
            stored.sortOrder = deck.sortOrder
        }

        for card in page.cards {
            let stored = try existingCard(id: card.id) ?? insertCard(id: card.id)
            stored.subjectEntityID = card.subjectEntityID
            stored.templateCode = card.templateCode
            stored.templateSchemaVersion = card.templateSchemaVersion
            stored.semanticVersion = card.semanticVersion
            stored.revision = card.revision
            stored.answerMode = card.answerMode
            stored.promptAssetID = card.promptAssetID
            stored.displayName = card.displayName
            stored.aliases = card.aliases
            stored.contentVersion = card.contentVersion
            stored.isRetired = card.isRetired
            stored.backSideFacts = card.backSideFacts.map {
                StoredCardFact(
                    type: $0.type,
                    displayValue: $0.displayValue,
                    sourceName: $0.sourceName
                )
            }
        }

        for membership in page.deckCards {
            let deckID = membership.deckID
            let cardID = membership.learningCardID
            var descriptor = FetchDescriptor<StoredDeckCard>(
                predicate: #Predicate { $0.deckID == deckID && $0.learningCardID == cardID }
            )
            descriptor.fetchLimit = 1
            let stored: StoredDeckCard
            if let found = try modelContext.fetch(descriptor).first {
                stored = found
            } else {
                stored = StoredDeckCard(deckID: deckID, learningCardID: cardID, sortOrder: nil)
                modelContext.insert(stored)
            }
            stored.sortOrder = membership.sortOrder
        }
    }

    private func makeCurrent(_ manifest: ContentManifestRecord) throws {
        for previous in try modelContext.fetch(
            FetchDescriptor<StoredContentManifest>(predicate: #Predicate { $0.isCurrent })
        ) {
            previous.isCurrent = false
        }

        let version = manifest.contentVersion
        var descriptor = FetchDescriptor<StoredContentManifest>(
            predicate: #Predicate { $0.contentVersion == version }
        )
        descriptor.fetchLimit = 1

        let stored: StoredContentManifest
        if let found = try modelContext.fetch(descriptor).first {
            stored = found
        } else {
            stored = StoredContentManifest(
                contentVersion: version,
                defaultLocale: manifest.defaultLocale,
                supportedLocales: manifest.supportedLocales,
                supportedTemplateSchemaVersions: manifest.supportedTemplateSchemaVersions,
                assetBaseURL: manifest.assetBaseURL,
                changeCursor: manifest.changeCursor,
                checksum: manifest.checksum,
                appliedAt: manifest.appliedAt,
                isCurrent: false
            )
            modelContext.insert(stored)
        }
        stored.defaultLocale = manifest.defaultLocale
        stored.importedLocale = manifest.importedLocale
        stored.supportedLocales = manifest.supportedLocales
        stored.supportedTemplateSchemaVersions = manifest.supportedTemplateSchemaVersions
        stored.assetBaseURL = manifest.assetBaseURL
        stored.changeCursor = manifest.changeCursor
        stored.checksum = manifest.checksum
        stored.appliedAt = manifest.appliedAt
        stored.isCurrent = true
    }

    private func write(_ staging: ContentStagingState) throws {
        let stored = try storedStagingState(forVersion: staging.contentVersion)
            ?? {
                let created = StoredContentStagingState(
                    contentVersion: staging.contentVersion,
                    stage: staging.stage.rawValue,
                    cursor: staging.cursor,
                    pendingDeckIDs: staging.pendingDeckIDs,
                    appliedInStage: staging.appliedInStage,
                    updatedAt: staging.updatedAt
                )
                modelContext.insert(created)
                return created
            }()
        stored.stage = staging.stage.rawValue
        stored.cursor = staging.cursor
        stored.pendingDeckIDs = staging.pendingDeckIDs
        stored.appliedInStage = staging.appliedInStage
        stored.updatedAt = staging.updatedAt
    }

    private func clearStagingState(forVersion contentVersion: String) throws {
        if let stored = try storedStagingState(forVersion: contentVersion) {
            modelContext.delete(stored)
        }
    }

    // MARK: - Reading

    private func currentStoredManifest() throws -> StoredContentManifest? {
        var descriptor = FetchDescriptor<StoredContentManifest>(
            predicate: #Predicate { $0.isCurrent }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }

    private func storedStagingState(forVersion contentVersion: String) throws
        -> StoredContentStagingState?
    {
        var descriptor = FetchDescriptor<StoredContentStagingState>(
            predicate: #Predicate { $0.contentVersion == contentVersion }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }

    /// - Parameter entity: the owner to attach to, or nil to leave the asset
    ///   standalone. An asset that arrived with a card has no entity payload
    ///   behind it yet, and waiting for one would mean a card page could not be
    ///   rendered until the whole entity feed had been walked.
    private func upsertAsset(_ asset: AssetRecord, attachedTo entity: StoredGeoEntity?) throws {
        let id = asset.id
        var descriptor = FetchDescriptor<StoredAsset>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1

        let stored: StoredAsset
        if let found = try modelContext.fetch(descriptor).first {
            stored = found
        } else {
            stored = StoredAsset(
                id: id,
                type: asset.type,
                url: asset.url,
                mimeType: asset.mimeType,
                sha256: asset.sha256,
                contentVersion: asset.contentVersion
            )
            modelContext.insert(stored)
        }
        stored.type = asset.type
        stored.url = asset.url
        stored.mimeType = asset.mimeType
        stored.sha256 = asset.sha256
        stored.contentVersion = asset.contentVersion
        if let entity {
            stored.entity = entity
        }
    }

    private func existingEntity(id: UUID) throws -> StoredGeoEntity? {
        var descriptor = FetchDescriptor<StoredGeoEntity>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }

    private func insertEntity(id: UUID) -> StoredGeoEntity {
        let stored = StoredGeoEntity(
            id: id,
            kind: "",
            status: "",
            recognitionStatus: "",
            contentVersion: ""
        )
        modelContext.insert(stored)
        return stored
    }

    private func existingDeck(id: UUID) throws -> StoredDeck? {
        var descriptor = FetchDescriptor<StoredDeck>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }

    private func insertDeck(id: UUID) -> StoredDeck {
        let stored = StoredDeck(
            id: id,
            code: "",
            kind: "",
            name: "",
            deckDescription: "",
            cardCount: 0,
            contentVersion: "",
            sortOrder: 0
        )
        modelContext.insert(stored)
        return stored
    }

    private func existingCard(id: UUID) throws -> StoredLearningCard? {
        var descriptor = FetchDescriptor<StoredLearningCard>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }

    private func insertCard(id: UUID) -> StoredLearningCard {
        let stored = StoredLearningCard(
            id: id,
            subjectEntityID: UUID(),
            templateCode: "",
            templateSchemaVersion: 0,
            semanticVersion: 0,
            revision: 0,
            answerMode: "",
            promptAssetID: UUID(),
            displayName: "",
            aliases: [],
            contentVersion: "",
            isRetired: false
        )
        modelContext.insert(stored)
        return stored
    }

    // MARK: - Mapping

    private static func record(_ stored: StoredContentManifest) -> ContentManifestRecord {
        ContentManifestRecord(
            contentVersion: stored.contentVersion,
            defaultLocale: stored.defaultLocale,
            importedLocale: stored.importedLocale,
            supportedLocales: stored.supportedLocales,
            supportedTemplateSchemaVersions: stored.supportedTemplateSchemaVersions,
            assetBaseURL: stored.assetBaseURL,
            changeCursor: stored.changeCursor,
            checksum: stored.checksum,
            appliedAt: stored.appliedAt
        )
    }

    private static func record(_ stored: StoredContentStagingState) -> ContentStagingState {
        ContentStagingState(
            contentVersion: stored.contentVersion,
            // An unreadable stage means the row was written by a build that
            // knew a step this one does not. Restarting the download is correct
            // and cheap; guessing which step it meant is neither.
            stage: ContentStagingState.Stage(rawValue: stored.stage) ?? .decks,
            cursor: stored.cursor,
            pendingDeckIDs: stored.pendingDeckIDs,
            appliedInStage: stored.appliedInStage,
            updatedAt: stored.updatedAt
        )
    }

    private static func record(_ stored: StoredAsset) -> AssetRecord {
        AssetRecord(
            id: stored.id,
            type: stored.type,
            url: stored.url,
            mimeType: stored.mimeType,
            sha256: stored.sha256,
            contentVersion: stored.contentVersion
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
            isRetired: stored.isRetired,
            backSideFacts: stored.backSideFacts.map {
                FactRecord(
                    type: $0.type,
                    displayValue: $0.displayValue,
                    sourceName: $0.sourceName
                )
            }
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
