import SwiftData
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The upgrade that lets the due summary say when the next portion opens.
///
/// Version 7 widens one table, and the store still holds the two things an
/// update must never destroy: reviews the device has not uploaded, and a
/// session the user is in the middle of. Both are written here through the
/// schema version six really wrote, next to a summary it counted, and all
/// three have to be there after the plan has run.
final class SchemaV7MigrationTests: XCTestCase {
    private let deckID = UUID(uuidString: "70000000-0000-4000-8000-0000000000c1")!
    private let cardID = UUID(uuidString: "50000000-0000-4000-8000-0000000000c1")!
    private let assetID = UUID(uuidString: "40000000-0000-4000-8000-0000000000c1")!
    private let sessionID = UUID(uuidString: "90000000-0000-4000-8000-0000000000c1")!
    private let instant = Date(timeIntervalSince1970: 1_760_000_000)

    func testAStoreWrittenByVersionSixKeepsItsOutboxAndItsOpenSession() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let scope = PersistenceFixtures.guestScope

        try writeVersionSixStore(at: temporary.fileURL, scope: scope)

        let migrated = try temporary.open()

        let pending = try await migrated.makeOutboxRepository().pendingOperations(for: scope)
        XCTAssertEqual(pending.count, 3)
        XCTAssertEqual(pending.first?.state, .pending)

        let session = try await migrated.makeLearningRepository().activeSession(for: scope)
        XCTAssertEqual(session?.id, sessionID)
        XCTAssertEqual(session?.status, "ACTIVE")
        XCTAssertEqual(session?.cards.map(\.learningCardID), [cardID])

        let reviews = try await migrated.makeLearningRepository()
            .reviews(inSession: sessionID, for: scope)
        XCTAssertEqual(reviews.count, 1)
    }

    /// The counts survive, and a summary stored before the instant existed
    /// reads as a portion open now — the same thing the backend means by
    /// leaving the field out — so Home does not promise a wait nobody named.
    func testASummaryWrittenByVersionSixKeepsItsCountsAndHasNoNextPortion() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        let scope = PersistenceFixtures.guestScope

        try writeVersionSixStore(at: temporary.fileURL, scope: scope)

        let migrated = try temporary.open()
        let summary = try await migrated.makeLearningRepository().dueSummary(for: scope)

        XCTAssertEqual(summary?.overdue, 2)
        XCTAssertEqual(summary?.learning, 1)
        XCTAssertEqual(summary?.review, 4)
        XCTAssertEqual(summary?.newCards, 10)
        XCTAssertEqual(summary?.totalDue, 7)
        XCTAssertEqual(summary?.serverTime, instant)
        XCTAssertNil(summary?.nextPortionAt)
    }

    /// The two versions the plan now ends with differ by exactly the instant.
    func testVersionSevenAddsOnlyTheNextPortionInstant() {
        func properties(_ schema: Schema, _ entity: String) -> Set<String> {
            let described = schema.entities.first { $0.name == entity }
            return Set((described?.properties ?? []).map(\.name))
        }

        let six = Schema(versionedSchema: LocalSchemaV6.self)
        let seven = Schema(versionedSchema: LocalSchemaV7.self)

        XCTAssertEqual(
            properties(seven, "StoredDueSummary")
                .subtracting(properties(six, "StoredDueSummary")),
            ["nextPortionAt"]
        )
        XCTAssertEqual(Set(seven.entities.map(\.name)), Set(six.entities.map(\.name)))
    }

    // MARK: - Writing a version six store

    private func writeVersionSixStore(at url: URL, scope: AccountScope) throws {
        let schema = Schema(versionedSchema: LocalSchemaV6.self)
        let container = try ModelContainer(
            for: schema,
            configurations: ModelConfiguration(schema: schema, url: url)
        )
        let context = ModelContext(container)

        context.insert(
            StoredContentManifest(
                contentVersion: "v6",
                defaultLocale: "ru",
                supportedLocales: ["ru", "en"],
                supportedTemplateSchemaVersions: [1],
                assetBaseURL: URL(string: "https://cdn.test.invalid/")!,
                changeCursor: "cursor-6",
                checksum: String(repeating: "a", count: 64),
                appliedAt: instant,
                isCurrent: true
            )
        )
        context.insert(
            LocalSchemaV6.StoredDueSummary(
                scopeKey: scope.key,
                overdue: 2,
                learning: 1,
                relearning: 0,
                review: 4,
                newCards: 10,
                totalDue: 7,
                serverTime: instant
            )
        )

        // The session the user is in the middle of.
        let session = StoredStudySession(
            scopeKey: scope.key,
            id: sessionID,
            deckID: deckID,
            mode: "SELF_RATED",
            selectionOrigin: "CLIENT_OFFLINE",
            requestedUniqueCount: 5,
            status: "ACTIVE",
            contentVersion: "v6",
            startedAt: instant,
            completedAt: nil
        )
        context.insert(session)
        let sessionCard = StoredStudySessionCard(
            id: UUID(uuidString: "a0000000-0000-4000-8000-0000000000c1")!,
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
                id: UUID(uuidString: "92000000-0000-4000-8000-0000000000c1")!,
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
                    id: UUID(uuidString: "b0000000-0000-4000-8000-0000000000c\(index + 1)")!,
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
