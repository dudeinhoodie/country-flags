import SwiftData
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The upgrade that lets a deck be bought.
///
/// The store holds two things an update must never destroy: reviews the device
/// has not uploaded, and a session the user is in the middle of. Both are
/// written here through the schema version five really wrote, and both have to
/// be there after the plan has run — a failing migration is not something to
/// cure by deleting the store.
final class SchemaV6MigrationTests: XCTestCase {
    private let deckID = UUID(uuidString: "70000000-0000-4000-8000-0000000000a1")!
    private let cardID = UUID(uuidString: "50000000-0000-4000-8000-0000000000a1")!
    private let entityID = UUID(uuidString: "30000000-0000-4000-8000-0000000000a1")!
    private let assetID = UUID(uuidString: "40000000-0000-4000-8000-0000000000a1")!
    private let sessionID = UUID(uuidString: "90000000-0000-4000-8000-0000000000a1")!
    private let operationID = UUID(uuidString: "b0000000-0000-4000-8000-0000000000a1")!
    private let instant = Date(timeIntervalSince1970: 1_760_000_000)

    /// The whole point of the plan, with both things at stake present at once.
    func testAStoreWrittenByVersionFiveKeepsItsOutboxAndItsOpenSession() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let scope = PersistenceFixtures.guestScope

        try writeVersionFiveStore(at: temporary.fileURL, scope: scope)

        let migrated = try temporary.open()

        // The queue: three answers the backend has never seen.
        let pending = try await migrated.makeOutboxRepository().pendingOperations(for: scope)
        XCTAssertEqual(pending.count, 3)
        XCTAssertEqual(pending.first?.state, .pending)

        // The session the user was in the middle of, with the card it was
        // showing.
        let session = try await migrated.makeLearningRepository().activeSession(for: scope)
        XCTAssertEqual(session?.id, sessionID)
        XCTAssertEqual(session?.status, "ACTIVE")
        XCTAssertEqual(session?.cards.map(\.learningCardID), [cardID])

        // The answers already given in it.
        let reviews = try await migrated.makeLearningRepository()
            .reviews(inSession: sessionID, for: scope)
        XCTAssertEqual(reviews.count, 1)
    }

    /// A deck that existed before anything was for sale is free, and reads that
    /// way without anything having to rewrite it.
    func testADeckWrittenByVersionFiveMigratesAsFree() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }

        try writeVersionFiveStore(at: temporary.fileURL, scope: PersistenceFixtures.guestScope)

        let migrated = try temporary.open()
        let decks = try await migrated.makeContentRepository().decks()

        XCTAssertEqual(decks.map(\.id), [deckID])
        XCTAssertEqual(decks.first?.accessModel, "FREE")
        XCTAssertEqual(decks.first?.access, .free)
        XCTAssertTrue(decks.first?.isFree == true)
        XCTAssertNil(decks.first?.requiredEntitlementKey)
        XCTAssertEqual(decks.first?.offerCodes, [])
        XCTAssertEqual(decks.first?.contentKinds, [])
        XCTAssertEqual(decks.first?.previewCardIDs, [])
    }

    /// An asset written before variants existed is the current one, and keeps
    /// the bytes it had.
    func testAnAssetWrittenByVersionFiveReadsAsTheCurrentVariant() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }

        try writeVersionFiveStore(at: temporary.fileURL, scope: PersistenceFixtures.guestScope)

        let migrated = try temporary.open()
        let asset = try await migrated.makeContentRepository().asset(id: assetID)

        XCTAssertEqual(asset?.variant, AssetRecord.baselineVariant)
        XCTAssertEqual(asset?.type, "FLAG")
        XCTAssertNil(asset?.displayName)
        XCTAssertEqual(asset?.sha256, String(repeating: "b", count: 64))
    }

    /// Every version in the plan still has to describe its own store, and the
    /// two the plan now ends with have to differ by exactly what version 6
    /// added.
    func testVersionSixDescribesItsOwnStore() {
        func properties(_ schema: Schema, _ entity: String) -> Set<String> {
            let described = schema.entities.first { $0.name == entity }
            return Set((described?.properties ?? []).map(\.name))
        }

        let five = Schema(versionedSchema: LocalSchemaV5.self)
        let six = Schema(versionedSchema: LocalSchemaV6.self)

        XCTAssertEqual(
            properties(six, "StoredDeck").subtracting(properties(five, "StoredDeck")),
            [
                "accessModel", "requiredEntitlementKey", "offerCodes", "contentKinds",
                "previewCardIDs",
            ]
        )
        XCTAssertEqual(
            properties(six, "StoredAsset").subtracting(properties(five, "StoredAsset")),
            ["variant", "displayName", "assetDescription"]
        )
        XCTAssertEqual(
            properties(six, "StoredGeoEntity").subtracting(properties(five, "StoredGeoEntity")),
            ["parent", "isoSubdivision", "localCode", "fipsCode"]
        )
        // The three models the purchase needs, which version 5 had nowhere for.
        let entities = Set(six.entities.map(\.name))
            .subtracting(five.entities.map(\.name))
        XCTAssertEqual(
            entities,
            ["StoredEntitlement", "StoredPurchaseDelivery", "StoredCommerceOffer"]
        )
    }

    /// Progress is keyed by the card, not by the entity behind it. One Germany
    /// has a flag card and a coat card, and answering one must not move the
    /// other.
    func testCardProgressStaysKeyedByTheLearningCard() {
        let six = Schema(versionedSchema: LocalSchemaV6.self)
        let state = six.entities.first { $0.name == "StoredCardState" }
        let names = Set((state?.properties ?? []).map(\.name))

        XCTAssertTrue(names.contains("learningCardID"))
        XCTAssertFalse(names.contains("subjectEntityID"))
    }

    // MARK: - Writing a version five store

    /// A store as version 5 really wrote it: the frozen deck, the frozen entity
    /// graph, and the account-scoped records that were never version 5's to
    /// change.
    private func writeVersionFiveStore(at url: URL, scope: AccountScope) throws {
        let schema = Schema(versionedSchema: LocalSchemaV5.self)
        let container = try ModelContainer(
            for: schema,
            configurations: ModelConfiguration(schema: schema, url: url)
        )
        let context = ModelContext(container)

        context.insert(
            StoredContentManifest(
                contentVersion: "v5",
                defaultLocale: "ru",
                supportedLocales: ["ru", "en"],
                supportedTemplateSchemaVersions: [1],
                assetBaseURL: URL(string: "https://cdn.test.invalid/")!,
                changeCursor: "cursor-5",
                checksum: String(repeating: "a", count: 64),
                appliedAt: instant,
                isCurrent: true
            )
        )
        context.insert(
            LocalSchemaV5.StoredDeck(
                id: deckID,
                code: "ALL_COUNTRIES",
                kind: "CURATED",
                name: "Все страны",
                deckDescription: "Полный каталог",
                cardCount: 1,
                contentVersion: "v5",
                sortOrder: 0
            )
        )
        let entity = LocalSchemaV5.StoredGeoEntity(
            id: entityID,
            kind: "COUNTRY",
            status: "ACTIVE",
            recognitionStatus: "UN_MEMBER",
            contentVersion: "v5"
        )
        context.insert(entity)
        let asset = LocalSchemaV5.StoredAsset(
            id: assetID,
            type: "FLAG",
            url: URL(string: "https://cdn.test.invalid/belgium.svg")!,
            mimeType: "image/svg+xml",
            sha256: String(repeating: "b", count: 64),
            contentVersion: "v5"
        )
        asset.entity = entity
        context.insert(asset)

        // The session the user is in the middle of.
        let session = StoredStudySession(
            scopeKey: scope.key,
            id: sessionID,
            deckID: deckID,
            mode: "SELF_RATED",
            selectionOrigin: "CLIENT_OFFLINE",
            requestedUniqueCount: 5,
            status: "ACTIVE",
            contentVersion: "v5",
            startedAt: instant,
            completedAt: nil
        )
        context.insert(session)
        let sessionCard = StoredStudySessionCard(
            id: UUID(uuidString: "a0000000-0000-4000-8000-0000000000a1")!,
            learningCardID: cardID,
            initialOrder: 0,
            selectionReason: "NEW",
            displayName: "Бельгия",
            promptAssetID: assetID,
            revision: 1,
            optionIDs: [],
            optionNames: []
        )
        sessionCard.session = session
        context.insert(sessionCard)
        context.insert(
            StoredReviewEvent(
                scopeKey: scope.key,
                id: UUID(uuidString: "92000000-0000-4000-8000-0000000000a1")!,
                sessionID: sessionID,
                learningCardID: cardID,
                rating: "GOOD",
                answerMode: "SELF_RATED",
                selectedOptionID: nil,
                responseTimeMilliseconds: 3_200,
                clientOccurredAt: instant,
                estimatedServerOccurredAt: instant,
                clientSequence: 1,
                baseStateVersion: 0
            )
        )

        // The answers nobody has uploaded.
        for index in 0..<3 {
            context.insert(
                StoredOutboxOperation(
                    scopeKey: scope.key,
                    id: UUID(
                        uuidString:
                            "b0000000-0000-4000-8000-0000000000a\(index + 1)"
                    ) ?? operationID,
                    kind: OutboxOperationKind.reviewBatch.rawValue,
                    dependencyID: sessionID,
                    payload: Data(#"{"payloadVersion":1}"#.utf8),
                    state: OutboxState.pending.rawValue,
                    attemptCount: 0,
                    lastFailureCode: nil,
                    createdAt: instant.addingTimeInterval(TimeInterval(index)),
                    updatedAt: instant
                )
            )
        }

        try context.save()
    }
}

/// What version 6 exists for, once the store is on it.
final class PaidDeckPersistenceTests: XCTestCase {
    private let deckID = UUID(uuidString: "70000000-0000-4000-8000-0000000000b1")!
    private let previewCardID = UUID(uuidString: "50000000-0000-4000-8000-0000000000b1")!
    private let instant = Date(timeIntervalSince1970: 1_760_000_000)

    /// What opens a deck has to survive the round trip, or the client would
    /// have to ask the backend again before it could draw a padlock.
    func testADeckKeepsWhatOpensIt() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()

        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [],
            decks: [
                DeckRecord(
                    id: deckID,
                    code: "EUROPEAN_COATS",
                    kind: "CURATED",
                    name: "Гербы Европы",
                    deckDescription: "",
                    cardCount: 44,
                    contentVersion: "test-only-fixture-v1",
                    sortOrder: 0,
                    accessModel: "ENTITLEMENT",
                    requiredEntitlementKey: "deck.european_coats",
                    offerCodes: ["EUROPEAN_COATS", "SYMBOLS_BUNDLE"],
                    contentKinds: ["COAT_OF_ARMS"],
                    previewCardIDs: [previewCardID]
                )
            ],
            cards: [],
            deckCards: []
        )

        let deck = try await content.decks().first
        XCTAssertEqual(deck?.access, .entitlement)
        XCTAssertFalse(deck?.isFree == true)
        XCTAssertEqual(deck?.requiredEntitlementKey, "deck.european_coats")
        XCTAssertEqual(deck?.offerCodes, ["EUROPEAN_COATS", "SYMBOLS_BUNDLE"])
        XCTAssertEqual(deck?.contentKinds, ["COAT_OF_ARMS"])
        XCTAssertEqual(deck?.previewCardIDs, [previewCardID])
    }

    /// An access model published after this release is not free. Reading an
    /// unknown value as "open" would hand out paid content on a release that
    /// cannot even name the rule.
    func testAnUnknownAccessModelIsNotTreatedAsFree() {
        let unknown = DeckAccessModel(rawValue: "SUBSCRIPTION")

        XCTAssertEqual(unknown, .unknown("SUBSCRIPTION"))
        XCTAssertEqual(unknown.rawValue, "SUBSCRIPTION")
        XCTAssertFalse(
            DeckRecord(
                id: deckID,
                code: "X",
                kind: "CURATED",
                name: "X",
                deckDescription: "",
                cardCount: 0,
                contentVersion: "v1",
                sortOrder: 0,
                accessModel: "SUBSCRIPTION"
            ).isFree
        )
    }

    /// One country, two symbols, both in the store at once — which is the
    /// whole reason the asset had to grow a type it is addressed by.
    func testOneEntityHoldsAFlagAndACoatAtOnce() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()
        let entityID = UUID(uuidString: "30000000-0000-4000-8000-0000000000b1")!
        let flagID = UUID(uuidString: "40000000-0000-4000-8000-0000000000b1")!
        let coatID = UUID(uuidString: "40000000-0000-4000-8000-0000000000b2")!

        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [
                GeoEntityRecord(
                    id: entityID,
                    kind: "COUNTRY",
                    status: "ACTIVE",
                    recognitionStatus: "UN_MEMBER",
                    contentVersion: "test-only-fixture-v1",
                    names: [GeoNameRecord(locale: "ru", value: "Германия", isPrimary: true)],
                    assets: [
                        AssetRecord(
                            id: flagID,
                            type: "FLAG",
                            url: URL(string: "https://cdn.test.invalid/de-flag.svg")!,
                            mimeType: "image/svg+xml",
                            sha256: String(repeating: "c", count: 64),
                            contentVersion: "test-only-fixture-v1"
                        ),
                        AssetRecord(
                            id: coatID,
                            type: "COAT_OF_ARMS",
                            url: URL(string: "https://cdn.test.invalid/de-coat.svg")!,
                            mimeType: "image/svg+xml",
                            sha256: String(repeating: "d", count: 64),
                            contentVersion: "test-only-fixture-v1",
                            displayName: "Федеральный орёл",
                            assetDescription: "Герб Германии с 1950 года"
                        ),
                    ],
                    facts: []
                )
            ],
            decks: [],
            cards: [],
            deckCards: []
        )

        let entity = try await content.entity(id: entityID)
        let byType = Dictionary(
            uniqueKeysWithValues: (entity?.assets ?? []).map { ($0.type, $0) }
        )
        XCTAssertEqual(byType.count, 2)
        XCTAssertEqual(byType["FLAG"]?.id, flagID)
        XCTAssertEqual(byType["FLAG"]?.assetType, .flag)
        XCTAssertEqual(byType["COAT_OF_ARMS"]?.id, coatID)
        XCTAssertEqual(byType["COAT_OF_ARMS"]?.assetType, .coatOfArms)
        XCTAssertEqual(byType["COAT_OF_ARMS"]?.displayName, "Федеральный орёл")
        XCTAssertEqual(byType["COAT_OF_ARMS"]?.assetDescription, "Герб Германии с 1950 года")
        // Each is still addressable on its own, which is what a card's prompt
        // resolves through.
        let coat = try await content.asset(id: coatID)
        XCTAssertEqual(coat?.type, "COAT_OF_ARMS")
        XCTAssertEqual(coat?.variant, AssetRecord.baselineVariant)
    }

    /// A state is stored as a subdivision with the country it belongs to, so a
    /// screen can name "California, United States" without downloading the
    /// United States.
    func testASubdivisionRoundTripsWithItsParentSummary() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()
        let californiaID = UUID(uuidString: "30000000-0000-4000-8000-0000000000c1")!
        let unitedStatesID = UUID(uuidString: "30000000-0000-4000-8000-0000000000c2")!

        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [
                GeoEntityRecord(
                    id: californiaID,
                    kind: "SUBDIVISION",
                    status: "ACTIVE",
                    recognitionStatus: "NOT_APPLICABLE",
                    contentVersion: "test-only-fixture-v1",
                    names: [GeoNameRecord(locale: "en", value: "California", isPrimary: true)],
                    assets: [],
                    facts: [],
                    parent: GeoEntityParentRecord(
                        id: unitedStatesID,
                        kind: "COUNTRY",
                        name: "United States"
                    ),
                    identifiers: GeoEntityIdentifiersRecord(
                        isoSubdivision: "US-CA",
                        localCode: "CA",
                        fipsCode: "06"
                    )
                )
            ],
            decks: [],
            cards: [],
            deckCards: []
        )

        let stored = try await content.entity(id: californiaID)
        XCTAssertEqual(stored?.entityKind, .subdivision)
        XCTAssertEqual(stored?.parent?.id, unitedStatesID)
        XCTAssertEqual(stored?.parent?.kind, "COUNTRY")
        XCTAssertEqual(stored?.parent?.name, "United States")
        XCTAssertEqual(stored?.identifiers.isoSubdivision, "US-CA")
        XCTAssertEqual(stored?.identifiers.localCode, "CA")
        XCTAssertEqual(stored?.identifiers.fipsCode, "06")
    }

    /// A country has no parent either, so the absence of one is not what tells
    /// a subdivision apart — the kind is.
    func testACountryStoresNoParentAndNoSubdivisionCodes() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()

        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [PersistenceFixtures.entity()],
            decks: [],
            cards: [],
            deckCards: []
        )

        let stored = try await content.entity(id: PersistenceFixtures.entityID)
        XCTAssertEqual(stored?.entityKind, .country)
        XCTAssertNil(stored?.parent)
        XCTAssertTrue(stored?.identifiers.isEmpty == true)
    }

    /// A kind published after this release is carried rather than rejected, so
    /// one unknown entity cannot empty a catalogue.
    func testAnUnknownEntityKindSurvivesTheRoundTrip() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()
        let identifier = UUID(uuidString: "30000000-0000-4000-8000-0000000000d1")!

        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [
                GeoEntityRecord(
                    id: identifier,
                    kind: "MUNICIPALITY",
                    status: "ACTIVE",
                    recognitionStatus: "NOT_APPLICABLE",
                    contentVersion: "test-only-fixture-v1",
                    names: [],
                    assets: [],
                    facts: []
                )
            ],
            decks: [],
            cards: [],
            deckCards: []
        )

        let stored = try await content.entity(id: identifier)
        XCTAssertEqual(stored?.entityKind, .unknown("MUNICIPALITY"))
        XCTAssertEqual(stored?.kind, "MUNICIPALITY")
    }
}

/// The account-scoped half: what the customer may open, and what they paid for
/// that nobody has recorded yet.
final class CommerceStoreTests: XCTestCase {
    private let instant = Date(timeIntervalSince1970: 1_760_000_000)

    func testAnEntitlementSnapshotIsReplacedWholeAndScopedToItsAccount() async throws {
        let store = try LocalStore(location: .inMemory)
        let commerce = store.makeCommerceRepository()
        let first = PersistenceFixtures.firstUserScope
        let second = PersistenceFixtures.secondUserScope

        // Never asked is not the same as owns nothing.
        let unknown = try await commerce.entitlementSnapshot(for: first)
        XCTAssertNil(unknown)

        try await commerce.replaceEntitlementSnapshot(
            EntitlementSnapshotRecord(
                entitlementKeys: ["deck.european_coats", "deck.us_states"],
                checkedAt: instant
            ),
            for: first
        )
        // The refund: the answer arrives whole, and the previous one goes with
        // it rather than being merged into.
        try await commerce.replaceEntitlementSnapshot(
            EntitlementSnapshotRecord(
                entitlementKeys: ["deck.us_states"],
                checkedAt: instant.addingTimeInterval(60)
            ),
            for: first
        )

        let snapshot = try await commerce.entitlementSnapshot(for: first)
        XCTAssertEqual(snapshot?.entitlementKeys, ["deck.us_states"])
        XCTAssertEqual(snapshot?.checkedAt, instant.addingTimeInterval(60))
        XCTAssertTrue(snapshot?.grants("deck.us_states") == true)
        XCTAssertFalse(snapshot?.grants("deck.european_coats") == true)
        // The other account on this device owns nothing of it.
        let other = try await commerce.entitlementSnapshot(for: second)
        XCTAssertNil(other)
    }

    /// Signing out takes the paid payload with it.
    func testErasingAnAccountTakesItsEntitlementsAndItsUndeliveredPurchases() async throws {
        let store = try LocalStore(location: .inMemory)
        let commerce = store.makeCommerceRepository()
        let scope = PersistenceFixtures.firstUserScope

        try await commerce.replaceEntitlementSnapshot(
            EntitlementSnapshotRecord(entitlementKeys: ["deck.us_states"], checkedAt: instant),
            for: scope
        )
        try await commerce.enqueuePurchaseDelivery(delivery(), for: scope)

        try await store.makeAccountScopeCleaner().erase(scope: scope)

        let snapshot = try await commerce.entitlementSnapshot(for: scope)
        let pending = try await commerce.pendingPurchaseDeliveries(for: scope)
        XCTAssertNil(snapshot)
        XCTAssertTrue(pending.isEmpty)
    }

    /// The purchase has to be on disk before the transaction is finished with
    /// the store, so it has to survive the process that made it.
    func testAPendingPurchaseDeliverySurvivesRelaunch() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let scope = PersistenceFixtures.firstUserScope

        do {
            let store = try temporary.open()
            try await store.makeCommerceRepository().enqueuePurchaseDelivery(
                delivery(),
                for: scope
            )
        }

        let reopened = try temporary.open()
        let pending = try await reopened.makeCommerceRepository()
            .pendingPurchaseDeliveries(for: scope)

        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.transactionID, "2000000123456789")
        XCTAssertEqual(pending.first?.signedTransaction, "header.payload.signature")
        XCTAssertEqual(pending.first?.state, .pending)
    }

    /// The listener, the purchase and a restore all hand over the same receipt.
    /// The backend is asked about it once.
    func testTheSameTransactionIsQueuedOnlyOnce() async throws {
        let store = try LocalStore(location: .inMemory)
        let commerce = store.makeCommerceRepository()
        let scope = PersistenceFixtures.firstUserScope

        try await commerce.enqueuePurchaseDelivery(delivery(), for: scope)
        try await commerce.enqueuePurchaseDelivery(
            delivery(id: UUID(), signed: "header.payload.resigned"),
            for: scope
        )

        let pending = try await commerce.pendingPurchaseDeliveries(for: scope)
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.signedTransaction, "header.payload.resigned")
    }

    /// A crash mid-upload leaves a receipt claimed. It belongs back in the
    /// queue: nobody else is going to send it.
    func testAnInterruptedDeliveryIsRequeued() async throws {
        let store = try LocalStore(location: .inMemory)
        let commerce = store.makeCommerceRepository()
        let scope = PersistenceFixtures.firstUserScope
        let identifier = UUID(uuidString: "c0000000-0000-4000-8000-0000000000a1")!
        try await commerce.enqueuePurchaseDelivery(delivery(id: identifier), for: scope)
        try await commerce.updatePurchaseDeliveryState(
            of: identifier,
            to: .inFlight,
            failureCode: nil,
            for: scope
        )

        let requeued = try await commerce.requeueInterruptedPurchaseDeliveries(for: scope)

        XCTAssertEqual(requeued, 1)
        let pending = try await commerce.pendingPurchaseDeliveries(for: scope)
        XCTAssertEqual(pending.first?.state, .pending)
        XCTAssertEqual(pending.first?.attemptCount, 1)
    }

    /// A receipt the backend refused for good leaves the queue and stays on
    /// disk. It is money the customer spent; deleting it quietly would leave
    /// nothing to show support.
    func testAPermanentlyRefusedDeliveryLeavesTheQueueButStaysStored() async throws {
        let store = try LocalStore(location: .inMemory)
        let commerce = store.makeCommerceRepository()
        let scope = PersistenceFixtures.firstUserScope
        let identifier = UUID(uuidString: "c0000000-0000-4000-8000-0000000000a2")!
        try await commerce.enqueuePurchaseDelivery(delivery(id: identifier), for: scope)

        try await commerce.updatePurchaseDeliveryState(
            of: identifier,
            to: .permanentFailure,
            failureCode: "UNKNOWN_PRODUCT",
            for: scope
        )

        let afterRefusal = try await commerce.pendingPurchaseDeliveries(for: scope)
        XCTAssertTrue(afterRefusal.isEmpty)
        // Enqueuing the same transaction again does not resurrect it as a
        // second row.
        try await commerce.enqueuePurchaseDelivery(delivery(id: UUID()), for: scope)
        let afterResubmission = try await commerce.pendingPurchaseDeliveries(for: scope)
        XCTAssertTrue(afterResubmission.isEmpty)
    }

    /// An offer withdrawn from the catalogue stops being shown: sending a
    /// customer to a product the store no longer sells is a dead end.
    func testReplacingTheOfferCatalogueDropsWhatIsGone() async throws {
        let store = try LocalStore(location: .inMemory)
        let commerce = store.makeCommerceRepository()

        try await commerce.replaceOffers([
            offer(code: "EUROPEAN_COATS", productID: "com.test.european_coats"),
            offer(code: "SYMBOLS_BUNDLE", productID: "com.test.symbols_bundle"),
        ])
        try await commerce.replaceOffers([
            offer(code: "EUROPEAN_COATS", productID: "com.test.european_coats")
        ])

        let offers = try await commerce.offers()
        XCTAssertEqual(offers.map(\.code), ["EUROPEAN_COATS"])
        XCTAssertEqual(offers.first?.storeProduct?.productID, "com.test.european_coats")
        XCTAssertEqual(offers.first?.storeProduct?.provider, "APPLE_APP_STORE")
        XCTAssertEqual(offers.first?.grants, ["deck.european_coats"])
        XCTAssertEqual(offers.first?.title, "Гербы Европы")
    }

    /// An offer the store has no product for is still an offer: the catalogue
    /// describes it, and the client simply has nothing to sell it with.
    func testAnOfferWithoutAStoreProductIsStoredWithoutOne() async throws {
        let store = try LocalStore(location: .inMemory)
        let commerce = store.makeCommerceRepository()

        try await commerce.replaceOffers([offer(code: "EUROPEAN_COATS", productID: nil)])

        let offers = try await commerce.offers()
        XCTAssertNil(offers.first?.storeProduct)
    }

    private func delivery(
        id: UUID = UUID(uuidString: "c0000000-0000-4000-8000-0000000000a1")!,
        signed: String = "header.payload.signature"
    ) -> PurchaseDeliveryRecord {
        PurchaseDeliveryRecord(
            id: id,
            transactionID: "2000000123456789",
            signedTransaction: signed,
            productID: "com.test.european_coats",
            createdAt: instant,
            updatedAt: instant
        )
    }

    private func offer(code: String, productID: String?) -> CommerceOfferRecord {
        CommerceOfferRecord(
            code: code,
            kind: "ONE_TIME",
            storeProduct: productID.map {
                StoreProductRecord(provider: "APPLE_APP_STORE", productID: $0)
            },
            grants: ["deck.european_coats"],
            title: "Гербы Европы",
            offerDescription: "44 герба",
            updatedAt: instant
        )
    }
}
