import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// What comes off the device when an entitlement goes.
///
/// The rule is document 17 §10.1: best-effort cleanup drops the memberships
/// and assets no free or accessible deck still needs. It is access control
/// rather than DRM — the backend refuses the cards of a deck an account does
/// not hold, and that refusal is what protects the content — so what is
/// proved here is that somebody else's purchase does not sit on the device,
/// and that nothing anybody still needs goes with it.
final class PaidContentCleanupTests: XCTestCase {
    private let paidDeckID = UUID(uuidString: "70000000-0000-4000-8000-0000000000a1")!
    private let freeDeckID = UUID(uuidString: "70000000-0000-4000-8000-0000000000a2")!
    private let paidCardID = UUID(uuidString: "50000000-0000-4000-8000-0000000000b1")!
    private let sharedCardID = UUID(uuidString: "50000000-0000-4000-8000-0000000000b2")!
    private let previewCardID = UUID(uuidString: "50000000-0000-4000-8000-0000000000b3")!
    private let paidAssetID = UUID(uuidString: "40000000-0000-4000-8000-0000000000c1")!
    private let sharedAssetID = UUID(uuidString: "40000000-0000-4000-8000-0000000000c2")!
    private let previewAssetID = UUID(uuidString: "40000000-0000-4000-8000-0000000000c3")!

    /// The deck stops holding anything, so it composes no session.
    func testTheDeckIsLeftHoldingNothing() async throws {
        let (repository, _) = try await makeStore()

        let removed = try await repository.removeContent(ofDecks: [paidDeckID])

        XCTAssertFalse(removed.isEmpty)
        let remaining = try await repository.cards(inDeck: paidDeckID)
        XCTAssertTrue(remaining.isEmpty, "A deck this account may not open still holds cards")
        // Its metadata stays: the catalogue, the search and the paywall are
        // all built from it, and the deck is still for sale.
        let decks = try await repository.decks()
        XCTAssertTrue(decks.contains { $0.id == paidDeckID })
    }

    /// A card the same release also puts in a free deck is not a paid card.
    /// Document 17 §10.1: paid access protects a deck, not a country.
    func testACardAFreeDeckAlsoHoldsSurvives() async throws {
        let (repository, _) = try await makeStore()

        try await repository.removeContent(ofDecks: [paidDeckID])

        let free = try await repository.cards(inDeck: freeDeckID)
        XCTAssertEqual(free.map(\.id), [sharedCardID])
        let sharedCard = try await repository.card(id: sharedCardID)
        XCTAssertNotNil(sharedCard)
        let sharedAsset = try await repository.asset(id: sharedAssetID)
        XCTAssertNotNil(sharedAsset, "A drawing another card still needs was deleted")
    }

    /// The public preview is published as public on purpose, and it is what
    /// the locked deck's fan is drawn from. It survives being locked out.
    func testThePublicPreviewSurvives() async throws {
        let (repository, _) = try await makeStore()

        try await repository.removeContent(ofDecks: [paidDeckID])

        let preview = try await repository.card(id: previewCardID)
        XCTAssertNotNil(preview, "The preview went, so the locked deck has no fan to draw")
        let previewAsset = try await repository.asset(id: previewAssetID)
        XCTAssertNotNil(previewAsset)
    }

    /// What is actually taken: the card nothing else holds, and its drawing.
    func testTheCardNobodyElseHoldsGoesWithItsDrawing() async throws {
        let (repository, _) = try await makeStore()

        let removed = try await repository.removeContent(ofDecks: [paidDeckID])

        let goneCard = try await repository.card(id: paidCardID)
        XCTAssertNil(goneCard)
        let goneAsset = try await repository.asset(id: paidAssetID)
        XCTAssertNil(goneAsset)
        XCTAssertEqual(removed.cardIDs, [paidCardID])
        // Whole records rather than identifiers, because the file cache is
        // keyed by the checksum too and cannot find the bytes without it.
        XCTAssertEqual(removed.assets.map(\.id), [paidAssetID])
    }

    /// §11.4: a refund does not take a sitting away halfway through. The cards
    /// an unfinished session is holding stay, so it can still be finished.
    func testACardAnUnfinishedSessionIsHoldingSurvives() async throws {
        let (repository, store) = try await makeStore()
        let learning = store.makeLearningRepository()
        try await learning.saveSession(
            StudySessionRecord(
                id: UUID(uuidString: "90000000-0000-4000-8000-0000000000d1")!,
                deckID: paidDeckID,
                mode: "SELF_RATED",
                selectionOrigin: "CLIENT_OFFLINE",
                requestedUniqueCount: 1,
                status: "ACTIVE",
                contentVersion: "cleanup-fixture-v1",
                startedAt: PersistenceFixtures.instant,
                completedAt: nil,
                cards: [
                    StudySessionCardRecord(
                        id: UUID(uuidString: "a0000000-0000-4000-8000-0000000000d1")!,
                        learningCardID: paidCardID,
                        initialOrder: 0,
                        selectionReason: "NEW",
                        displayName: "Coat",
                        promptAssetID: paidAssetID,
                        revision: 1
                    )
                ]
            ),
            for: PersistenceFixtures.firstUserScope
        )

        try await repository.removeContent(ofDecks: [paidDeckID])

        let pinned = try await repository.card(id: paidCardID)
        XCTAssertNotNil(pinned, "A sitting already open lost the card it was about to show")
        // The membership still goes, so no new session can be composed from
        // the deck. Blocking the next one and keeping the open one is exactly
        // what §11.4 asks for.
        let remaining = try await repository.cards(inDeck: paidDeckID)
        XCTAssertTrue(remaining.isEmpty)
    }

    /// A refund takes the deck away, never what somebody learned.
    func testProgressIsUntouched() async throws {
        let (repository, store) = try await makeStore()
        let learning = store.makeLearningRepository()
        let scope = PersistenceFixtures.firstUserScope
        try await learning.saveCardStates(
            [
                CardStateRecord(
                    learningCardID: paidCardID,
                    state: "REVIEW",
                    difficulty: 5,
                    stability: 3,
                    dueAt: PersistenceFixtures.instant,
                    repetitions: 4,
                    lapses: 0,
                    schedulerVersion: "fsrs-6-default-v1",
                    stateVersion: 1,
                    updatedAt: PersistenceFixtures.instant,
                    isLocalProjection: false
                )
            ],
            for: scope
        )

        try await repository.removeContent(ofDecks: [paidDeckID])

        let states = try await learning.cardStates(for: scope)
        XCTAssertEqual(states.map(\.learningCardID), [paidCardID])
        XCTAssertEqual(states.first?.repetitions, 4)
    }

    /// Asked about nothing, it does nothing — which is the shape of every
    /// launch of a device that owns no paid deck.
    func testAnEmptyRequestChangesNothing() async throws {
        let (repository, _) = try await makeStore()

        let removed = try await repository.removeContent(ofDecks: [])

        XCTAssertTrue(removed.isEmpty)
        let untouched = try await repository.cards(inDeck: paidDeckID)
        XCTAssertEqual(untouched.count, 2)
    }

    // MARK: - Harness

    /// A release with one free deck and one that is sold, sharing a card, and
    /// a preview card that belongs to no deck at all — which is exactly how a
    /// public preview is stored.
    private func makeStore() async throws -> (any ContentRepository, LocalStore) {
        let store = try LocalStore(location: .inMemory)
        let repository = store.makeContentRepository()
        let version = "cleanup-fixture-v1"
        try await repository.applyContent(
            manifest: PersistenceFixtures.manifest(version: version),
            entities: [PersistenceFixtures.entity(version: version)],
            decks: [
                DeckRecord(
                    id: paidDeckID,
                    code: "EUROPEAN_COATS",
                    kind: "CURATED",
                    name: "European Coats",
                    deckDescription: "",
                    cardCount: 2,
                    contentVersion: version,
                    sortOrder: 0,
                    accessModel: DeckAccessModel.entitlement.rawValue,
                    requiredEntitlementKey: "entitlement.european_coats",
                    offerCodes: ["EUROPEAN_COATS_LIFETIME"],
                    contentKinds: ["COAT_OF_ARMS"],
                    previewCardIDs: [previewCardID]
                ),
                DeckRecord(
                    id: freeDeckID,
                    code: "EUROPE",
                    kind: "TAXONOMY",
                    name: "Europe",
                    deckDescription: "",
                    cardCount: 1,
                    contentVersion: version,
                    sortOrder: 1
                ),
            ],
            cards: [
                card(id: paidCardID, assetID: paidAssetID, version: version),
                card(id: sharedCardID, assetID: sharedAssetID, version: version),
                card(id: previewCardID, assetID: previewAssetID, version: version),
            ],
            deckCards: [
                DeckCardRecord(deckID: paidDeckID, learningCardID: paidCardID, sortOrder: 0),
                DeckCardRecord(deckID: paidDeckID, learningCardID: sharedCardID, sortOrder: 1),
                DeckCardRecord(deckID: freeDeckID, learningCardID: sharedCardID, sortOrder: 0),
            ]
        )
        try await repository.applyStagedPage(
            ContentPage(
                assets: [
                    asset(id: paidAssetID, version: version),
                    asset(id: sharedAssetID, version: version),
                    asset(id: previewAssetID, version: version),
                ]
            ),
            staging: ContentStagingState(
                contentVersion: version,
                stage: .ready,
                cursor: nil,
                pendingDeckIDs: [],
                updatedAt: PersistenceFixtures.instant
            )
        )
        return (repository, store)
    }

    private func card(id: UUID, assetID: UUID, version: String) -> LearningCardRecord {
        LearningCardRecord(
            id: id,
            subjectEntityID: PersistenceFixtures.entityID,
            templateCode: "COAT_OF_ARMS_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: assetID,
            displayName: "Belgium",
            aliases: [],
            contentVersion: version
        )
    }

    private func asset(id: UUID, version: String) -> AssetRecord {
        AssetRecord(
            id: id,
            type: "COAT_OF_ARMS",
            url: URL(string: "https://cdn.test.invalid/\(id.uuidString).png")!,
            mimeType: "image/png",
            sha256: String(repeating: "c", count: 64),
            contentVersion: version
        )
    }
}
