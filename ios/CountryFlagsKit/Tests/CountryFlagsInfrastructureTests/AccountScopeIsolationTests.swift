import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

final class AccountScopeIsolationTests: XCTestCase {
    /// A guest and two accounts share one device. None of them may read
    /// another's progress, which is the difference between "the app forgot my
    /// data" and "the app showed me somebody else's".
    func testScopesDoNotReadEachOthersData() async throws {
        let store = try LocalStore(location: .inMemory)
        let learning = store.makeLearningRepository()
        let outbox = store.makeOutboxRepository()

        try await learning.saveSettings(
            PersistenceFixtures.settings(sessionSize: 5),
            for: PersistenceFixtures.guestScope
        )
        try await learning.saveSettings(
            PersistenceFixtures.settings(sessionSize: 10),
            for: PersistenceFixtures.firstUserScope
        )
        try await learning.saveSettings(
            PersistenceFixtures.settings(sessionSize: 20),
            for: PersistenceFixtures.secondUserScope
        )
        try await learning.saveCardStates(
            [PersistenceFixtures.cardState()],
            for: PersistenceFixtures.firstUserScope
        )
        try await outbox.enqueue(
            PersistenceFixtures.outbox(),
            for: PersistenceFixtures.firstUserScope
        )

        let guestSettings = try await learning.settings(for: PersistenceFixtures.guestScope)
        let firstSettings = try await learning.settings(for: PersistenceFixtures.firstUserScope)
        let secondSettings = try await learning.settings(for: PersistenceFixtures.secondUserScope)
        XCTAssertEqual(guestSettings?.sessionSize, 5)
        XCTAssertEqual(firstSettings?.sessionSize, 10)
        XCTAssertEqual(secondSettings?.sessionSize, 20)

        let secondStates = try await learning.cardStates(for: PersistenceFixtures.secondUserScope)
        XCTAssertTrue(secondStates.isEmpty)
        let guestOutbox = try await outbox.pendingOperations(for: PersistenceFixtures.guestScope)
        XCTAssertTrue(guestOutbox.isEmpty)
        let firstOutbox = try await outbox.pendingOperations(for: PersistenceFixtures.firstUserScope)
        XCTAssertEqual(firstOutbox.count, 1)
    }

    /// Signing out erases one account and leaves the other, plus the shared
    /// content, untouched.
    func testEraseRemovesOnlyTheChosenScope() async throws {
        let store = try LocalStore(location: .inMemory)
        let content = store.makeContentRepository()
        let learning = store.makeLearningRepository()
        let outbox = store.makeOutboxRepository()
        let telemetry = store.makeTelemetryRepository()
        let cleaner = store.makeAccountScopeCleaner()

        try await content.applyContent(
            manifest: PersistenceFixtures.manifest(),
            entities: [PersistenceFixtures.entity()],
            decks: [PersistenceFixtures.deck()],
            cards: [PersistenceFixtures.card()],
            deckCards: [
                DeckCardRecord(
                    deckID: PersistenceFixtures.deckID,
                    learningCardID: PersistenceFixtures.cardID,
                    sortOrder: 0
                )
            ]
        )
        for scope in [PersistenceFixtures.firstUserScope, PersistenceFixtures.secondUserScope] {
            try await learning.saveSettings(
                PersistenceFixtures.settings(sessionSize: 10),
                for: scope
            )
            try await learning.saveSession(PersistenceFixtures.session(), for: scope)
            try await outbox.enqueue(PersistenceFixtures.outbox(), for: scope)
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
        }

        try await cleaner.erase(scope: PersistenceFixtures.firstUserScope)

        let erasedSettings = try await learning.settings(for: PersistenceFixtures.firstUserScope)
        XCTAssertNil(erasedSettings)
        let erasedSession = try await learning.activeSession(for: PersistenceFixtures.firstUserScope)
        XCTAssertNil(erasedSession)
        let erasedOutbox = try await outbox.pendingOperations(
            for: PersistenceFixtures.firstUserScope
        )
        XCTAssertTrue(erasedOutbox.isEmpty)
        let erasedEvents = try await telemetry.pendingAnalyticsEvents(
            for: PersistenceFixtures.firstUserScope
        )
        XCTAssertTrue(erasedEvents.isEmpty)

        let survivingSettings = try await learning.settings(
            for: PersistenceFixtures.secondUserScope
        )
        XCTAssertNotNil(survivingSettings)
        let survivingOutbox = try await outbox.pendingOperations(
            for: PersistenceFixtures.secondUserScope
        )
        XCTAssertEqual(survivingOutbox.count, 1)

        // Content is shared, so signing out must not force a re-download.
        let decks = try await content.decks()
        XCTAssertEqual(decks.count, 1)
        let manifest = try await content.currentManifest()
        XCTAssertNotNil(manifest)
    }
}
