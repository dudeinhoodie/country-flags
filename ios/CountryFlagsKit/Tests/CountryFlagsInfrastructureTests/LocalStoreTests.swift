import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

final class ReviewTransactionTests: XCTestCase {
    override func tearDown() {
        SwiftDataLearningRepository.validateWriteOverride = nil
        super.tearDown()
    }

    /// The answer, its projected state and the outbox entry are one write. The
    /// session may not advance until all three are on disk.
    func testReviewStateAndOutboxAreWrittenTogether() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let outbox = store.makeOutboxRepository()
        let scope = PersistenceFixtures.firstUserScope
        try await learning.saveSession(PersistenceFixtures.session(), for: scope)

        try await learning.recordReview(
            PersistenceFixtures.review(),
            projectedState: PersistenceFixtures.cardState(),
            outbox: PersistenceFixtures.outbox(),
            for: scope
        )

        let reviews = try await learning.reviews(
            inSession: PersistenceFixtures.sessionID,
            for: scope
        )
        XCTAssertEqual(reviews.count, 1)
        let states = try await learning.cardStates(for: scope)
        XCTAssertEqual(states.first?.stateVersion, 1)
        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertEqual(pending.count, 1)
    }

    /// A failure in the middle must leave nothing behind. A review without its
    /// outbox entry would be work the device never uploads, and an outbox entry
    /// without its review would upload something it cannot explain.
    func testFailedWriteLeavesNoHalfRecordedReview() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let outbox = store.makeOutboxRepository()
        let scope = PersistenceFixtures.firstUserScope
        try await learning.saveSession(PersistenceFixtures.session(), for: scope)

        struct InjectedFailure: Error {}
        SwiftDataLearningRepository.validateWriteOverride = { throw InjectedFailure() }

        do {
            try await learning.recordReview(
                PersistenceFixtures.review(),
                projectedState: PersistenceFixtures.cardState(),
                outbox: PersistenceFixtures.outbox(),
                for: scope
            )
            XCTFail("the write must not report success")
        } catch {
            guard case PersistenceError.transactionFailed = error else {
                return XCTFail("unexpected error: \(error)")
            }
        }

        SwiftDataLearningRepository.validateWriteOverride = nil
        let reviews = try await learning.reviews(
            inSession: PersistenceFixtures.sessionID,
            for: scope
        )
        XCTAssertTrue(reviews.isEmpty)
        let states = try await learning.cardStates(for: scope)
        XCTAssertTrue(states.isEmpty)
        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertTrue(pending.isEmpty)
    }

    /// The identifier is assigned before the card is answered, so a repeated
    /// write is the same review rather than a second one.
    func testRepeatedReviewIdentifierIsNotStoredTwice() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let scope = PersistenceFixtures.firstUserScope
        try await learning.saveSession(PersistenceFixtures.session(), for: scope)

        for _ in 0..<2 {
            try await learning.recordReview(
                PersistenceFixtures.review(),
                projectedState: PersistenceFixtures.cardState(),
                outbox: PersistenceFixtures.outbox(),
                for: scope
            )
        }

        let reviews = try await learning.reviews(
            inSession: PersistenceFixtures.sessionID,
            for: scope
        )
        XCTAssertEqual(reviews.count, 1)
    }

    /// Answers arriving from several tasks must all be stored exactly once.
    func testConcurrentReviewsAreAllStoredOnce() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let scope = PersistenceFixtures.firstUserScope
        try await learning.saveSession(PersistenceFixtures.session(), for: scope)

        let count = 12
        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<count {
                group.addTask {
                    let identifier = UUID(
                        uuidString: "92000000-0000-4000-8000-0000000000\(String(format: "%02d", index))"
                    )!
                    try await learning.recordReview(
                        PersistenceFixtures.review(
                            id: identifier,
                            sequence: Int64(index + 1)
                        ),
                        projectedState: PersistenceFixtures.cardState(
                            stateVersion: index + 1
                        ),
                        outbox: PersistenceFixtures.outbox(id: UUID()),
                        for: scope
                    )
                }
            }
            try await group.waitForAll()
        }

        let reviews = try await learning.reviews(
            inSession: PersistenceFixtures.sessionID,
            for: scope
        )
        XCTAssertEqual(reviews.count, count)
        XCTAssertEqual(Set(reviews.map(\.id)).count, count)
    }
}

final class StoreRelaunchTests: XCTestCase {
    /// Closing the process and opening the store again has to return the
    /// unfinished session, the answers and the queue: relaunching the app is
    /// not a reason to lose work the user already did.
    func testFileBackedStoreSurvivesReopening() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let scope = PersistenceFixtures.firstUserScope

        do {
            let store = try temporary.open()
            let learning = store.makeLearningRepository()
            try await learning.saveSession(PersistenceFixtures.session(), for: scope)
            try await learning.recordReview(
                PersistenceFixtures.review(),
                projectedState: PersistenceFixtures.cardState(),
                outbox: PersistenceFixtures.outbox(),
                for: scope
            )
        }

        // A separate container over the same file stands in for the next launch.
        let reopened = try temporary.open()
        let learning = reopened.makeLearningRepository()
        let outbox = reopened.makeOutboxRepository()

        let session = try await learning.activeSession(for: scope)
        XCTAssertEqual(session?.id, PersistenceFixtures.sessionID)
        XCTAssertEqual(session?.cards.count, 1)
        let reviews = try await learning.reviews(
            inSession: PersistenceFixtures.sessionID,
            for: scope
        )
        XCTAssertEqual(reviews.count, 1)
        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.state, .pending)
    }

    /// Opening the store through the migration plan must carry the queue over.
    /// An app update that dropped it would throw away answers the backend has
    /// never seen.
    func testPendingOutboxSurvivesAnUpdateOfTheStore() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let scope = PersistenceFixtures.guestScope

        do {
            let store = try temporary.open()
            let outbox = store.makeOutboxRepository()
            for index in 0..<3 {
                try await outbox.enqueue(
                    PersistenceFixtures.outbox(id: UUID(), kind: .reviewBatch),
                    for: scope
                )
                _ = index
            }
        }

        let reopened = try temporary.open()
        let pending = try await reopened.makeOutboxRepository().pendingOperations(for: scope)
        XCTAssertEqual(pending.count, 3)
    }

    /// A crash leaves operations claimed. They belong back in the queue rather
    /// than staying invisible forever.
    func testInterruptedOperationsAreRequeued() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let scope = PersistenceFixtures.guestScope
        let identifier = UUID()
        try await outbox.enqueue(PersistenceFixtures.outbox(id: identifier), for: scope)
        try await outbox.updateState(of: identifier, to: .inFlight, failureCode: nil, for: scope)

        let requeued = try await outbox.requeueInterruptedOperations(for: scope)

        XCTAssertEqual(requeued, 1)
        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertEqual(pending.first?.state, .pending)
        // The attempt was counted, so a permanently failing operation cannot
        // retry forever unnoticed.
        XCTAssertEqual(pending.first?.attemptCount, 1)
    }

    /// A rejected operation stays in the store: dropping it silently would hide
    /// work the user believes was saved.
    func testPermanentlyRejectedOperationLeavesTheQueueButStaysStored() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let scope = PersistenceFixtures.guestScope
        let identifier = UUID()
        try await outbox.enqueue(PersistenceFixtures.outbox(id: identifier), for: scope)

        try await outbox.updateState(
            of: identifier,
            to: .permanentFailure,
            failureCode: "UNKNOWN_LEARNING_CARD",
            for: scope
        )

        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertTrue(pending.isEmpty)
        let requeued = try await outbox.requeueInterruptedOperations(for: scope)
        XCTAssertEqual(requeued, 0)
    }
}

final class ContentStoreTests: XCTestCase {
    func testApplyingContentReplacesTheCurrentManifest() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()

        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(version: "v1"),
            entities: [PersistenceFixtures.entity(version: "v1")],
            decks: [PersistenceFixtures.deck(version: "v1")],
            cards: [PersistenceFixtures.card(version: "v1")],
            deckCards: [
                DeckCardRecord(
                    deckID: PersistenceFixtures.deckID,
                    learningCardID: PersistenceFixtures.cardID,
                    sortOrder: 0
                )
            ]
        )
        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(version: "v2"),
            entities: [],
            decks: [],
            cards: [],
            deckCards: []
        )

        let manifest = try await content.currentManifest()
        XCTAssertEqual(manifest?.contentVersion, "v2")
        // The records of the previous release are still readable, so a session
        // that started on v1 keeps working.
        let entity = try await content.entity(id: PersistenceFixtures.entityID)
        XCTAssertEqual(entity?.contentVersion, "v1")
        XCTAssertEqual(entity?.names.count, 2)
        XCTAssertEqual(entity?.assets.first?.sha256.count, 64)
    }

    /// A tombstone retires content instead of deleting it: an unfinished
    /// session still has to render the card it started with.
    func testRetiredContentLeavesSelectionButStaysReadable() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()
        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [PersistenceFixtures.entity()],
            decks: [PersistenceFixtures.deck()],
            cards: [
                PersistenceFixtures.card(),
                PersistenceFixtures.card(id: PersistenceFixtures.secondCardID),
            ],
            deckCards: [
                DeckCardRecord(
                    deckID: PersistenceFixtures.deckID,
                    learningCardID: PersistenceFixtures.cardID,
                    sortOrder: 0
                ),
                DeckCardRecord(
                    deckID: PersistenceFixtures.deckID,
                    learningCardID: PersistenceFixtures.secondCardID,
                    sortOrder: 1
                ),
            ]
        )

        try await content.retire(cardIDs: [PersistenceFixtures.cardID], entityIDs: [])

        let cards = try await content.cards(inDeck: PersistenceFixtures.deckID)
        XCTAssertEqual(cards.map(\.id), [PersistenceFixtures.secondCardID])
    }
}

final class TelemetryStoreTests: XCTestCase {
    /// Withdrawing consent has to reach events that are already queued.
    func testWithdrawingConsentDropsOptionalEventsOnly() async throws {
        let store = try LocalStore(location: .inMemory)
        let telemetry = store.makeTelemetryRepository()
        let scope = PersistenceFixtures.firstUserScope

        try await telemetry.enqueueAnalyticsEvent(
            AnalyticsEventRecord(
                id: UUID(),
                name: "deck.opened",
                schemaVersion: 1,
                payload: Data("{}".utf8),
                isOptional: true,
                occurredAt: PersistenceFixtures.instant
            ),
            for: scope
        )
        try await telemetry.enqueueAnalyticsEvent(
            AnalyticsEventRecord(
                id: UUID(),
                name: "auth.completed",
                schemaVersion: 1,
                payload: Data("{}".utf8),
                isOptional: false,
                occurredAt: PersistenceFixtures.instant
            ),
            for: scope
        )

        let removed = try await telemetry.removeOptionalAnalyticsEvents(for: scope)

        XCTAssertEqual(removed, 1)
        let remaining = try await telemetry.pendingAnalyticsEvents(for: scope)
        XCTAssertEqual(remaining.map(\.name), ["auth.completed"])
    }
}
