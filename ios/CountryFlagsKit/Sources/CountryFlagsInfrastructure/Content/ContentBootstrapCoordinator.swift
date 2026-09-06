import Foundation

import CountryFlagsDomain

/// Remembers the entity tag of the manifest this device applied, so an
/// unchanged release costs a 304 and no body — and the locale its text was
/// imported in, so a language change is a reason to import again. Device
/// bookkeeping, not release data: it lives beside the store, not in it.
public protocol ContentManifestTagStoring: Sendable {
    func entityTag(forVersion contentVersion: String) -> String?
    func store(entityTag: String, forVersion contentVersion: String)
    func importedLocale(forVersion contentVersion: String) -> String?
    func store(importedLocale: String, forVersion contentVersion: String)
}

public struct UserDefaultsContentManifestTagStore: ContentManifestTagStoring, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func entityTag(forVersion contentVersion: String) -> String? {
        defaults.string(forKey: Self.key(contentVersion))
    }

    public func store(entityTag: String, forVersion contentVersion: String) {
        defaults.set(entityTag, forKey: Self.key(contentVersion))
    }

    public func importedLocale(forVersion contentVersion: String) -> String? {
        defaults.string(forKey: Self.localeKey(contentVersion))
    }

    public func store(importedLocale: String, forVersion contentVersion: String) {
        defaults.set(importedLocale, forKey: Self.localeKey(contentVersion))
    }

    private static func key(_ contentVersion: String) -> String {
        "content.manifest.etag.\(contentVersion)"
    }

    private static func localeKey(_ contentVersion: String) -> String {
        "content.manifest.locale.\(contentVersion)"
    }
}

public struct InMemoryContentManifestTagStore: ContentManifestTagStoring, @unchecked Sendable {
    private final class Box: @unchecked Sendable {
        var tags: [String: String] = [:]
        var locales: [String: String] = [:]
    }

    private let box = Box()

    public init() {}

    public func entityTag(forVersion contentVersion: String) -> String? {
        box.tags[contentVersion]
    }

    public func store(entityTag: String, forVersion contentVersion: String) {
        box.tags[contentVersion] = entityTag
    }

    public func importedLocale(forVersion contentVersion: String) -> String? {
        box.locales[contentVersion]
    }

    public func store(importedLocale: String, forVersion contentVersion: String) {
        box.locales[contentVersion] = importedLocale
    }
}

/// Brings the device's content up to the release the backend publishes.
///
/// One actor owns the whole sequence so two triggers — a launch and a
/// pull-to-refresh landing together — cannot page the same feed twice and
/// write conflicting cursors. A second caller joins the run in progress
/// instead of starting its own.
public actor ContentBootstrapCoordinator: ContentSynchronizing {
    private let service: ContentService
    private let repository: any ContentRepository
    private let tags: any ContentManifestTagStoring
    private let dates: any DateProviding
    private let logger: any AppLogging
    private let appVersion: String
    private let pageLimit: Int
    /// What this account may open, asked when the deck list is being staged.
    ///
    /// A deck sold rather than published is skipped rather than fetched: its
    /// cards are behind an entitlement guard, and asking for them would spend
    /// a request to be told so. The default answers "nothing", which is a
    /// catalogue of free decks — the only kind a build without commerce has.
    private let entitlementKeys: @Sendable () async -> Set<String>

    private var status = ContentSyncStatus()
    private var running: Task<ContentSyncStatus, Never>?

    public init(
        service: ContentService,
        repository: any ContentRepository,
        tags: any ContentManifestTagStoring = InMemoryContentManifestTagStore(),
        dates: any DateProviding = SystemDateProvider(),
        logger: any AppLogging = NoOpLogger(),
        appVersion: String,
        pageLimit: Int = 100,
        entitlementKeys: @escaping @Sendable () async -> Set<String> = { [] }
    ) {
        self.service = service
        self.repository = repository
        self.tags = tags
        self.dates = dates
        self.logger = logger
        self.appVersion = appVersion
        self.pageLimit = pageLimit
        self.entitlementKeys = entitlementKeys
    }

    /// Downloads the cards of one deck that has just become openable.
    ///
    /// A purchase does not need the whole release again: the metadata of every
    /// deck is already stored, and what is missing is the cards of exactly one
    /// of them. So this pages that deck alone and writes it into the release
    /// that is current, the way the change feed writes an entity it fetched.
    ///
    /// - Returns: whether the deck's cards are on the device afterwards.
    @discardableResult
    public func loadCards(inDeck deckID: UUID, locale: String) async -> Bool {
        guard let manifest = try? await repository.currentManifest() else { return false }
        var cursor: String?
        var applied = 0
        repeat {
            let page: ContentCardPage
            do {
                page = try await service.cards(
                    inDeck: deckID,
                    locale: locale,
                    cursor: cursor,
                    limit: pageLimit,
                    sortOffset: applied,
                    supportedTemplateSchemaVersions: manifest.supportedTemplateSchemaVersions
                )
            } catch {
                // Including the guard's own refusal: a deck the server does not
                // agree is ours stays without cards, and the screen that asked
                // says so rather than showing an empty deck.
                logger.log(
                    .notice,
                    .content,
                    "Could not download the cards of a deck that had just been opened",
                    ["deckId": .safe(deckID.uuidString)]
                )
                return false
            }
            do {
                try await repository.applyStagedPage(
                    ContentPage(
                        cards: page.cards,
                        deckCards: page.deckCards,
                        assets: page.assets
                    ),
                    staging: ContentStagingState(
                        contentVersion: manifest.contentVersion,
                        stage: .ready,
                        cursor: nil,
                        pendingDeckIDs: [],
                        updatedAt: dates.now()
                    )
                )
            } catch {
                return false
            }
            applied += page.cards.count
            cursor = page.hasMore ? page.nextCursor : nil
        } while cursor != nil
        return true
    }

    public func currentStatus() -> ContentSyncStatus { status }

    /// Restores the status a screen should show before any network call.
    ///
    /// Without it a relaunch with a full store would render the loading state
    /// until the first sync answered, which is exactly the case the offline
    /// requirement is about.
    public func restoreStatus() async {
        guard let manifest = try? await repository.currentManifest() else { return }
        status = ContentSyncStatus(
            phase: .idle,
            lastSuccessAt: manifest.appliedAt,
            lastFailure: status.lastFailure,
            contentVersion: manifest.contentVersion
        )
    }

    /// Runs, or joins, a synchronisation.
    @discardableResult
    public func synchronize(locale: String) async -> ContentSyncStatus {
        if let running {
            return await running.value
        }

        let task = Task<ContentSyncStatus, Never> { [self] in
            await run(locale: locale)
        }
        running = task
        let result = await task.value
        running = nil
        return result
    }

    // MARK: - The sequence

    private func run(locale: String) async -> ContentSyncStatus {
        let stored = try? await repository.currentManifest()
        status = ContentSyncStatus(
            phase: stored == nil ? .bootstrapping : .refreshing,
            lastSuccessAt: stored?.appliedAt,
            lastFailure: status.lastFailure,
            contentVersion: stored?.contentVersion
        )

        do {
            // The tag says "these bytes are unchanged", but the words on the
            // device are in the language the release was imported in — after
            // a language change a 304 would be the wrong answer, so the tag
            // stays home and the manifest is fetched for real. A release from
            // a build that never recorded its locale reads as unknown and
            // heals with one re-import.
            let storedLocale = stored.flatMap { tags.importedLocale(forVersion: $0.contentVersion) }
            // A half-finished re-import of the current release is a second
            // reason the tag must stay home: half the records are not on the
            // device in any one language, and a 304 — or the delta path —
            // would freeze them that way forever. The manifest is fetched for
            // real and the bootstrap below finishes the job.
            var incompleteStaging: ContentStagingState?
            if let stored,
                let staging = try await repository.stagingState(
                    forVersion: stored.contentVersion
                ),
                staging.stage != .ready
            {
                incompleteStaging = staging
            }
            let entityTag =
                storedLocale == locale && incompleteStaging == nil
                ? stored.flatMap { tags.entityTag(forVersion: $0.contentVersion) }
                : nil
            switch try await service.manifest(locale: locale, entityTag: entityTag) {
            case .notModified:
                guard let stored else {
                    // A 304 with nothing stored means the tag outlived the
                    // records it described. Asking again without it is the only
                    // way out, and it happens at most once.
                    throw APIError.decoding("The manifest is unchanged but no release is stored")
                }
                try await applyChanges(after: stored.changeCursor, manifest: stored, locale: locale)
            case .updated(let fetch):
                guard Self.isClientSupported(appVersion: appVersion, minimum: fetch.minimumClientVersion)
                else {
                    return finish(failure: .clientTooOld(minimumVersion: fetch.minimumClientVersion))
                }
                if let entityTag = fetch.entityTag {
                    tags.store(entityTag: entityTag, forVersion: fetch.manifest.contentVersion)
                }

                if stored?.contentVersion == fetch.manifest.contentVersion,
                    storedLocale == locale,
                    incompleteStaging == nil
                {
                    try await applyChanges(
                        after: stored?.changeCursor ?? fetch.manifest.changeCursor,
                        manifest: fetch.manifest,
                        locale: locale
                    )
                } else {
                    try await bootstrap(manifest: fetch.manifest, locale: locale)
                }
            }

            let applied = try? await repository.currentManifest()
            if let applied {
                // Recorded only after the words are actually on the device.
                tags.store(importedLocale: locale, forVersion: applied.contentVersion)
            }
            status = ContentSyncStatus(
                phase: .idle,
                lastSuccessAt: applied?.appliedAt ?? dates.now(),
                lastFailure: nil,
                contentVersion: applied?.contentVersion
            )
            return status
        } catch {
            return finish(failure: Self.failure(from: error))
        }
    }

    /// Downloads a release page by page and makes it current only at the end.
    private func bootstrap(manifest: ContentManifestRecord, locale: String) async throws {
        let current = try? await repository.currentManifest()
        var staging: ContentStagingState
        if current?.contentVersion == manifest.contentVersion {
            // A re-import of the release that is already current — a locale
            // change, or a half-import left by one. The staging row cannot
            // say which language its pages arrived in, so resuming it could
            // stitch two locales into one catalog; it starts over instead.
            // The pages land in live rows either way, so an interruption
            // leaves mixed text on screen — but only until this run's
            // successor finishes, because the incomplete staging row keeps
            // routing back here.
            staging = .initial(contentVersion: manifest.contentVersion, at: dates.now())
        } else {
            staging = try await repository.stagingState(forVersion: manifest.contentVersion)
                ?? .initial(contentVersion: manifest.contentVersion, at: dates.now())
        }

        while staging.stage != .ready {
            staging = try await applyNextPage(of: manifest, staging: staging, locale: locale)
        }

        try await repository.commitRelease(manifest: manifest)
        logger.log(
            .info,
            .content,
            "Applied a content release",
            ["contentVersion": .safe(manifest.contentVersion)]
        )
    }

    /// Applies exactly one page and returns where the next one starts.
    ///
    /// The page and the resume point are handed to the store together, so an
    /// interruption anywhere in here leaves the device on the last cursor whose
    /// page really landed. Replaying that page upserts and changes nothing.
    private func applyNextPage(
        of manifest: ContentManifestRecord,
        staging: ContentStagingState,
        locale: String
    ) async throws -> ContentStagingState {
        switch staging.stage {
        case .decks:
            let page = try await service.decks(
                locale: locale,
                cursor: staging.cursor,
                limit: pageLimit,
                sortOffset: staging.appliedInStage
            )
            // A deck that has to be bought and has not been is staged with its
            // metadata and without its cards: the catalogue, the search and
            // the paywall are all built from what arrived here, and the cards
            // arrive the moment the account holds the right to them.
            let openable = await entitlementKeys()
            let pending =
                staging.pendingDeckIDs
                + page.items.filter { $0.isOpen(given: openable) }.map(\.id)
            let applied = staging.appliedInStage + page.items.count
            let next: ContentStagingState
            if page.hasMore, let cursor = page.nextCursor {
                next = ContentStagingState(
                    contentVersion: manifest.contentVersion,
                    stage: .decks,
                    cursor: cursor,
                    pendingDeckIDs: pending,
                    appliedInStage: applied,
                    updatedAt: dates.now()
                )
            } else {
                next = ContentStagingState(
                    contentVersion: manifest.contentVersion,
                    stage: pending.isEmpty ? .ready : .cards,
                    cursor: nil,
                    // The counter belongs to whatever is being paged, so it
                    // restarts with the first deck's cards.
                    pendingDeckIDs: pending,
                    appliedInStage: 0,
                    updatedAt: dates.now()
                )
            }
            // The preview cards go in without a deck membership. That is the
            // whole of the public preview: three drawable cards for the fan,
            // and no card list, no progress and no session a locked deck could
            // be studied through.
            try await repository.applyStagedPage(
                ContentPage(
                    decks: page.items,
                    cards: page.previewCards,
                    assets: page.previewAssets
                ),
                staging: next
            )
            return next

        case .cards:
            guard let deckID = staging.pendingDeckIDs.first else {
                let next = ContentStagingState(
                    contentVersion: manifest.contentVersion,
                    stage: .ready,
                    cursor: nil,
                    pendingDeckIDs: [],
                    appliedInStage: 0,
                    updatedAt: dates.now()
                )
                try await repository.applyStagedPage(ContentPage(), staging: next)
                return next
            }

            let page: ContentCardPage
            do {
                page = try await service.cards(
                    inDeck: deckID,
                    locale: locale,
                    cursor: staging.cursor,
                    limit: pageLimit,
                    sortOffset: staging.appliedInStage,
                    supportedTemplateSchemaVersions: manifest.supportedTemplateSchemaVersions
                )
            } catch let error as APIError where error.details?.statusCode == 403 {
                // The guard refused one deck, not the release. Its metadata is
                // already stored, so the catalogue, the search and the paywall
                // all work; only its cards are missing, and they are what the
                // purchase is for. Failing the run here would leave a guest
                // with no catalogue at all because one deck is for sale.
                logger.log(
                    .info,
                    .content,
                    "A deck this account does not hold was staged without its cards",
                    ["deckId": .safe(deckID.uuidString)]
                )
                return try await skipDeck(deckID, of: manifest, staging: staging)
            }
            if !page.unsupportedCardIDs.isEmpty {
                // A template this build cannot draw costs the cards that use
                // it, not the deck. The count is logged so a release that
                // silently halved a deck is visible.
                logger.log(
                    .notice,
                    .content,
                    "Skipped cards built on an unsupported template",
                    [
                        "deckId": .safe(deckID.uuidString),
                        "skipped": .count(page.unsupportedCardIDs.count),
                    ]
                )
            }

            let hasNextPage = page.hasMore && page.nextCursor != nil
            let remaining = hasNextPage ? staging.pendingDeckIDs : Array(staging.pendingDeckIDs.dropFirst())
            let next = ContentStagingState(
                contentVersion: manifest.contentVersion,
                stage: remaining.isEmpty ? .ready : .cards,
                cursor: hasNextPage ? page.nextCursor : nil,
                pendingDeckIDs: remaining,
                // Counting the cards the page carried rather than the ones it
                // delivered would leave a gap in the order wherever an
                // unsupported card was skipped.
                appliedInStage: hasNextPage ? staging.appliedInStage + page.cards.count : 0,
                updatedAt: dates.now()
            )
            try await repository.applyStagedPage(
                ContentPage(cards: page.cards, deckCards: page.deckCards, assets: page.assets),
                staging: next
            )
            return next

        case .ready:
            return staging
        }
    }

    /// Moves the cards stage past a deck whose cards this device may not have.
    private func skipDeck(
        _ deckID: UUID,
        of manifest: ContentManifestRecord,
        staging: ContentStagingState
    ) async throws -> ContentStagingState {
        let remaining = Array(staging.pendingDeckIDs.drop { $0 == deckID })
        let next = ContentStagingState(
            contentVersion: manifest.contentVersion,
            stage: remaining.isEmpty ? .ready : .cards,
            cursor: nil,
            pendingDeckIDs: remaining,
            appliedInStage: 0,
            updatedAt: dates.now()
        )
        try await repository.applyStagedPage(ContentPage(), staging: next)
        return next
    }

    /// Applies the change feed onto the release that is already current.
    private func applyChanges(
        after cursor: String,
        manifest: ContentManifestRecord,
        locale: String
    ) async throws {
        var cursor = cursor
        var applied = manifest

        while true {
            let batch = try await service.changes(after: cursor, locale: locale, limit: pageLimit)

            if !batch.retiredCardIDs.isEmpty || !batch.retiredEntityIDs.isEmpty {
                try await repository.retire(
                    cardIDs: batch.retiredCardIDs,
                    entityIDs: batch.retiredEntityIDs
                )
            }

            var entities: [GeoEntityRecord] = []
            for id in batch.upsertedEntityIDs {
                // A miss is the contract's way of saying the entity is hidden
                // from the catalog; the tombstone that follows removes it.
                if let entity = try await service.entity(id: id, locale: locale) {
                    entities.append(entity)
                }
            }
            if !entities.isEmpty {
                try await repository.applyStagedPage(
                    ContentPage(entities: entities),
                    staging: ContentStagingState(
                        contentVersion: applied.contentVersion,
                        stage: .ready,
                        cursor: nil,
                        pendingDeckIDs: [],
                        updatedAt: dates.now()
                    )
                )
            }

            if !batch.ignoredResourceTypes.isEmpty {
                logger.log(
                    .debug,
                    .content,
                    "Ignored change feed resources this build does not apply",
                    ["count": .count(batch.ignoredResourceTypes.count)]
                )
            }

            cursor = batch.nextCursor
            // The cursor advances with the manifest so a relaunch resumes where
            // the feed stopped rather than replaying it from the release.
            applied = ContentManifestRecord(
                contentVersion: applied.contentVersion,
                defaultLocale: applied.defaultLocale,
                supportedLocales: applied.supportedLocales,
                supportedTemplateSchemaVersions: applied.supportedTemplateSchemaVersions,
                assetBaseURL: applied.assetBaseURL,
                changeCursor: cursor,
                checksum: applied.checksum,
                appliedAt: dates.now()
            )
            try await repository.commitRelease(manifest: applied)

            guard batch.hasMore else { break }
        }
    }

    // MARK: - Helpers

    private func finish(failure: ContentSyncFailure) -> ContentSyncStatus {
        status = ContentSyncStatus(
            phase: .idle,
            lastSuccessAt: status.lastSuccessAt,
            lastFailure: failure,
            contentVersion: status.contentVersion
        )
        logger.log(
            .error,
            .content,
            "A content sync did not finish",
            ["reason": .safe(String(describing: failure))]
        )
        return status
    }

    private static func failure(from error: any Error) -> ContentSyncFailure {
        guard let apiError = error as? APIError else {
            return .recoverable(code: "UNKNOWN")
        }
        switch apiError {
        case .transport, .cancelled:
            return .offline
        case .decoding:
            return .recoverable(code: "DECODING")
        default:
            return .recoverable(code: apiError.details?.code ?? "UNKNOWN")
        }
    }

    /// Compares dotted release versions numerically.
    ///
    /// A string comparison would call "1.10.0" older than "1.9.0" and lock a
    /// current build out of its own content.
    static func isClientSupported(appVersion: String, minimum: String) -> Bool {
        let left = appVersion.split(separator: ".").map { Int($0) ?? 0 }
        let right = minimum.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(left.count, right.count) {
            let lhs = index < left.count ? left[index] : 0
            let rhs = index < right.count ? right[index] : 0
            if lhs != rhs { return lhs > rhs }
        }
        return true
    }
}
