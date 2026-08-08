import Foundation

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// Deterministic values so a failure points at the behaviour, not at the data.
enum PersistenceFixtures {
    static let deckID = UUID(uuidString: "70000000-0000-4000-8000-000000000001")!
    static let cardID = UUID(uuidString: "50000000-0000-4000-8000-000000000001")!
    static let secondCardID = UUID(uuidString: "50000000-0000-4000-8000-000000000002")!
    static let entityID = UUID(uuidString: "30000000-0000-4000-8000-000000000001")!
    static let assetID = UUID(uuidString: "40000000-0000-4000-8000-000000000001")!
    static let sessionID = UUID(uuidString: "90000000-0000-4000-8000-000000000001")!
    static let instant = Date(timeIntervalSince1970: 1_760_000_000)

    static let guestScope = AccountScope.guest(
        installationID: UUID(uuidString: "81000000-0000-4000-8000-000000000001")!
    )
    static let firstUserScope = AccountScope.authenticated(
        userID: UUID(uuidString: "80000000-0000-4000-8000-000000000001")!
    )
    static let secondUserScope = AccountScope.authenticated(
        userID: UUID(uuidString: "80000000-0000-4000-8000-000000000002")!
    )

    static func manifest(version: String = "test-only-fixture-v1") -> ContentManifestRecord {
        ContentManifestRecord(
            contentVersion: version,
            defaultLocale: "ru",
            supportedLocales: ["ru", "en"],
            supportedTemplateSchemaVersions: [1],
            assetBaseURL: URL(string: "https://cdn.test.invalid/")!,
            changeCursor: "cursor-1",
            checksum: String(repeating: "a", count: 64),
            appliedAt: instant
        )
    }

    static func entity(version: String = "test-only-fixture-v1") -> GeoEntityRecord {
        GeoEntityRecord(
            id: entityID,
            kind: "COUNTRY",
            status: "ACTIVE",
            recognitionStatus: "UN_MEMBER",
            contentVersion: version,
            names: [
                GeoNameRecord(locale: "ru", value: "Бельгия", isPrimary: true),
                GeoNameRecord(locale: "en", value: "Belgium", isPrimary: true),
            ],
            assets: [
                AssetRecord(
                    id: assetID,
                    type: "FLAG",
                    url: URL(string: "https://cdn.test.invalid/belgium.svg")!,
                    mimeType: "image/svg+xml",
                    sha256: String(repeating: "b", count: 64),
                    contentVersion: version
                )
            ],
            facts: [
                FactRecord(type: "CAPITAL", displayValue: "Брюссель", sourceName: "TEST_ONLY")
            ]
        )
    }

    static func deck(version: String = "test-only-fixture-v1") -> DeckRecord {
        DeckRecord(
            id: deckID,
            code: "ALL_COUNTRIES",
            kind: "CURATED",
            name: "Все страны",
            deckDescription: "Полный каталог",
            cardCount: 2,
            contentVersion: version,
            sortOrder: 0
        )
    }

    static func card(
        id: UUID = cardID,
        version: String = "test-only-fixture-v1"
    ) -> LearningCardRecord {
        LearningCardRecord(
            id: id,
            subjectEntityID: entityID,
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
            semanticVersion: 1,
            revision: 1,
            answerMode: "SELF_RATED",
            promptAssetID: assetID,
            displayName: "Бельгия",
            aliases: [],
            contentVersion: version
        )
    }

    static func session(status: String = "ACTIVE") -> StudySessionRecord {
        StudySessionRecord(
            id: sessionID,
            deckID: deckID,
            mode: "SELF_RATED",
            selectionOrigin: "CLIENT_OFFLINE",
            requestedUniqueCount: 5,
            status: status,
            contentVersion: "test-only-fixture-v1",
            startedAt: instant,
            completedAt: nil,
            cards: [
                StudySessionCardRecord(
                    id: UUID(uuidString: "a0000000-0000-4000-8000-000000000001")!,
                    learningCardID: cardID,
                    initialOrder: 0,
                    selectionReason: "NEW",
                    displayName: "Бельгия",
                    promptAssetID: assetID,
                    revision: 1
                )
            ]
        )
    }

    static func review(
        id: UUID = UUID(uuidString: "92000000-0000-4000-8000-000000000001")!,
        cardID: UUID = cardID,
        sequence: Int64 = 1
    ) -> ReviewEventRecord {
        ReviewEventRecord(
            id: id,
            sessionID: sessionID,
            learningCardID: cardID,
            rating: "GOOD",
            answerMode: "SELF_RATED",
            selectedOptionID: nil,
            responseTimeMilliseconds: 3_200,
            clientOccurredAt: instant,
            estimatedServerOccurredAt: instant,
            clientSequence: sequence,
            baseStateVersion: 0
        )
    }

    static func cardState(
        cardID: UUID = cardID,
        stateVersion: Int = 1,
        isLocalProjection: Bool = true
    ) -> CardStateRecord {
        CardStateRecord(
            learningCardID: cardID,
            state: "LEARNING",
            difficulty: 5.2,
            stability: 1.4,
            dueAt: instant.addingTimeInterval(600),
            repetitions: 1,
            lapses: 0,
            schedulerVersion: "test-fsrs-6-v2",
            stateVersion: stateVersion,
            updatedAt: instant,
            isLocalProjection: isLocalProjection
        )
    }

    static func outbox(
        id: UUID = UUID(uuidString: "b0000000-0000-4000-8000-000000000001")!,
        kind: OutboxOperationKind = .reviewBatch,
        state: OutboxState = .pending
    ) -> OutboxOperationRecord {
        OutboxOperationRecord(
            id: id,
            kind: kind,
            dependencyID: sessionID,
            payload: Data(#"{"payloadVersion":1}"#.utf8),
            state: state,
            attemptCount: 0,
            lastFailureCode: nil,
            createdAt: instant,
            updatedAt: instant
        )
    }

    static func settings(sessionSize: Int) -> UserSettingsRecord {
        UserSettingsRecord(
            sessionSize: sessionSize,
            contentLocale: "ru",
            defaultAnswerMode: "SELF_RATED",
            extraFactTypes: ["CAPITAL"],
            soundEnabled: true,
            hapticsEnabled: true,
            remindersEnabled: false,
            version: 1,
            updatedAt: instant
        )
    }
}

/// A store in a fresh temporary directory, removed when the test ends.
struct TemporaryStore {
    let directory: URL

    init() {
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("country-flags-tests-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
    }

    var fileURL: URL {
        directory.appendingPathComponent("store.sqlite")
    }

    func open() throws -> LocalStore {
        try LocalStore(fileURL: fileURL)
    }

    func remove() {
        try? FileManager.default.removeItem(at: directory)
    }
}
