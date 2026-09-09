import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// What #404 is about: work done before the first successful sync has to
/// survive it.
///
/// The app seeds an empty store from the catalogue it ships (ADR-021) under
/// identifiers of its own, because a server allocates identifiers this build
/// cannot predict, and the first release that arrives replaces the seed whole.
/// Progress is keyed by card, so unless the identifiers move with it the
/// learner's work stops being counted and stops being importable — which is
/// exactly what the owner met: studied as a guest, signed in, Progress empty.
///
/// The fixture below is the real situation in miniature: a seeded release
/// whose cards are the same cards `SyntheticContent` publishes — the same
/// question, the same drawing, at the same published path — under identifiers
/// no server would ever issue, plus one card the arriving release does not
/// carry at all.
final class SeededProgressCarryTests: XCTestCase {
    private let dates = FixedDateProvider(instant: ContentTestClient.now)
    private let guest = AccountScope.guest(
        installationID: UUID(uuidString: "aa000000-0000-4000-8000-000000000001")!
    )

    // MARK: - The counts

    /// The claim, at the place a person reads it: a guest studies before ever
    /// reaching the backend, the backend then answers, and the numbers are
    /// still theirs.
    func testWorkDoneOnTheSeedIsStillCountedAfterTheReleaseThatSupersedesIt() async throws {
        let harness = try Harness(dates: dates)
        await harness.coordinator.seedFromBundleIfEmpty()
        try await harness.study(["France", "Germany"], as: guest)

        // Before: the guest can see their own work, which is what makes the
        // loss afterwards so plain.
        let before = try await harness.startedCards(for: guest)
        XCTAssertEqual(before, 2)

        let status = await harness.coordinator.synchronize(locale: "en")

        XCTAssertNil(status.lastFailure)
        XCTAssertEqual(status.contentVersion, SyntheticContent.contentVersion)
        // The release renumbered every card, and the work is still counted.
        let after = try await harness.startedCards(for: guest)
        XCTAssertEqual(after, 2)
        // Counted against the release that is current, not against the rows
        // the seed left behind: the identifiers themselves moved.
        let arrivingCardIDs = Set(SyntheticContent.flags.map { UUID(uuidString: $0.cardID)! })
        let states = try await harness.learning.cardStates(for: guest)
        XCTAssertEqual(
            Set(states.map(\.learningCardID)).intersection(arrivingCardIDs).count,
            2
        )
    }

    /// The other half of the owner's path. The backend resolves a guest
    /// archive against the deck, the release and the card each review names,
    /// and refuses the archive when any of the three is unknown to it — which
    /// is what a session composed on the seed always was.
    func testTheGuestImportSubmitsWorkTheBackendCanResolve() async throws {
        let harness = try Harness(dates: dates)
        await harness.coordinator.seedFromBundleIfEmpty()
        try await harness.study(["France", "Germany"], as: guest)

        await harness.coordinator.synchronize(locale: "en")
        let payload = try await harness.submitGuestWork(from: guest)

        let session = try XCTUnwrap(payload.sessions.first)
        // The three things the import declares, all of them the arriving
        // release's now.
        XCTAssertEqual(session.contentVersion, SyntheticContent.contentVersion)
        XCTAssertEqual(session.deckID, UUID(uuidString: SyntheticContent.europeDeckID)!)
        let arrivingCardIDs = Set(SyntheticContent.flags.map { UUID(uuidString: $0.cardID)! })
        XCTAssertEqual(payload.reviews.count, 2)
        for review in payload.reviews {
            XCTAssertTrue(
                arrivingCardIDs.contains(review.learningCardID),
                "A review still names a card the backend has never heard of"
            )
        }
    }

    /// The unfinished sitting: a session is resumed from its own snapshot, and
    /// the snapshot has to name cards the current release still has or the
    /// screen resumes onto nothing.
    func testAnUnfinishedSessionResumesOntoTheArrivingRelease() async throws {
        let harness = try Harness(dates: dates)
        await harness.coordinator.seedFromBundleIfEmpty()
        try await harness.study(["France", "Germany"], as: guest)

        await harness.coordinator.synchronize(locale: "en")

        let stored = try await harness.learning.activeSession(for: guest)
        let session = try XCTUnwrap(stored)
        XCTAssertEqual(session.contentVersion, SyntheticContent.contentVersion)
        for card in session.cards {
            let current = try await harness.content.card(id: card.learningCardID)
            XCTAssertEqual(
                current?.contentVersion,
                SyntheticContent.contentVersion,
                "A card in the open sitting is not in the current release"
            )
            // The prompt and the revision travel with the identifier: an
            // import declares both, and the drawing is what the checksum it
            // sends is read from.
            XCTAssertEqual(card.promptAssetID, current?.promptAssetID)
            XCTAssertEqual(card.revision, current?.revision)
        }
        // What was on the card when it was answered is not rewritten.
        XCTAssertEqual(Set(session.cards.map(\.displayName)), ["France", "Germany"])
    }

    /// Answers already queued for upload are the learner's work too. They are
    /// held while the device is a guest and sent the moment there is an
    /// account, so a queue full of cards the backend cannot resolve is the
    /// same loss arriving later.
    func testQueuedAnswersAreSentUnderTheArrivingIdentifiers() async throws {
        let harness = try Harness(dates: dates)
        await harness.coordinator.seedFromBundleIfEmpty()
        try await harness.study(["France"], as: guest)

        await harness.coordinator.synchronize(locale: "en")

        let pending = try await harness.outbox.pendingOperations(for: guest)
        let queued = pending.filter { $0.kind == .reviewBatch }
        XCTAssertEqual(queued.count, 1)
        let operation = try XCTUnwrap(queued.first)
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: operation.payload) as? [String: Any]
        )
        let cardID = try XCTUnwrap(UUID(uuidString: try XCTUnwrap(payload["learningCardID"] as? String)))
        XCTAssertEqual(cardID, UUID(uuidString: SyntheticContent.flags[0].cardID))
    }

    // MARK: - What cannot be carried

    /// A card the arriving release does not publish has nowhere to go. The
    /// rule is that it is said out loud rather than swallowed: the row stays,
    /// and a notice is written for the screen that would otherwise just show a
    /// smaller number.
    func testWorkOnACardTheArrivingReleaseDroppedIsKeptAndReported() async throws {
        let harness = try Harness(dates: dates)
        await harness.coordinator.seedFromBundleIfEmpty()
        try await harness.study(["France", Harness.strandedName], as: guest)

        await harness.coordinator.synchronize(locale: "en")

        // Nothing was deleted.
        let states = try await harness.learning.cardStates(for: guest)
        XCTAssertEqual(states.count, 2)
        XCTAssertTrue(states.map(\.learningCardID).contains(harness.strandedCardID))
        // And the learner can find out.
        let notice = try XCTUnwrap(harness.notices.pendingNotice())
        XCTAssertEqual(notice.cardCount, 1)
        XCTAssertEqual(notice.arrivingVersion, SyntheticContent.contentVersion)
    }

    /// Nothing to say when nothing was lost. A notice on every first launch
    /// would be noise, and noise is how a real one goes unread.
    func testAReleaseThatCarriesEverythingSaysNothing() async throws {
        let harness = try Harness(dates: dates)
        await harness.coordinator.seedFromBundleIfEmpty()
        try await harness.study(["France"], as: guest)

        await harness.coordinator.synchronize(locale: "en")

        XCTAssertNil(harness.notices.pendingNotice())
    }

    // MARK: - Once, and safely

    /// The supersession can be interrupted, and the next launch runs it again.
    /// Running the carry twice must move nothing a second time — the rows have
    /// already left the identifiers it knows about.
    func testCarryingTwiceMovesNothingTwice() async throws {
        let harness = try Harness(dates: dates)
        await harness.coordinator.seedFromBundleIfEmpty()
        try await harness.study(["France", "Germany"], as: guest)
        await harness.coordinator.synchronize(locale: "en")
        let afterFirst = try await harness.learning.cardStates(for: guest)
        let reviewsAfterFirst = try await harness.learning.reviews(for: guest)

        // A fresh coordinator over the same store, which is what a relaunch
        // builds, running the whole sequence again.
        let second = harness.makeCoordinator()
        await second.seedFromBundleIfEmpty()
        await second.synchronize(locale: "en")

        let afterSecond = try await harness.learning.cardStates(for: guest)
        XCTAssertEqual(
            Set(afterSecond.map(\.learningCardID)),
            Set(afterFirst.map(\.learningCardID))
        )
        XCTAssertEqual(afterSecond.count, afterFirst.count)
        let reviewsAfterSecond = try await harness.learning.reviews(for: guest)
        XCTAssertEqual(reviewsAfterSecond.map(\.id), reviewsAfterFirst.map(\.id))
        let counted = try await harness.startedCards(for: guest)
        XCTAssertEqual(counted, 2)
    }

    /// Two rows for one card are not representable, and the arriving release
    /// can already have one: an account whose progress the backend answered
    /// with before the catalogue finished arriving. The backend's row is the
    /// one that survives (ADR-016).
    func testAServerConfirmedStateWinsOverTheSeededProjection() async throws {
        let harness = try Harness(dates: dates)
        await harness.coordinator.seedFromBundleIfEmpty()
        try await harness.study(["France"], as: guest)
        // The same card, under the identifier the release is about to arrive
        // with, as the backend states it.
        let arriving = UUID(uuidString: SyntheticContent.flags[0].cardID)!
        try await harness.learning.saveCardStates(
            [
                CardStateRecord(
                    learningCardID: arriving,
                    state: "REVIEW",
                    difficulty: 5,
                    stability: 9,
                    dueAt: dates.now(),
                    repetitions: 4,
                    lapses: 0,
                    schedulerVersion: "fsrs-1",
                    stateVersion: 7,
                    updatedAt: dates.now(),
                    isLocalProjection: false
                )
            ],
            for: guest
        )

        await harness.coordinator.synchronize(locale: "en")

        let all = try await harness.learning.cardStates(for: guest)
        let states = all.filter { $0.learningCardID == arriving }
        XCTAssertEqual(states.count, 1)
        XCTAssertEqual(states.first?.stateVersion, 7)
        XCTAssertEqual(states.first?.isLocalProjection, false)
        // And the row it merged into is gone rather than left behind as a
        // second opinion about the same card.
        XCTAssertEqual(all.count, 1)
    }
}

// MARK: - Harness

/// A store seeded from a bundle, a backend that publishes the same cards under
/// its own identifiers, and a guest who studied in between.
private struct Harness {
    /// A country the seeded catalogue knows and the arriving release does not.
    static let strandedName = "Atlantis"

    let store: LocalStore
    let content: any ContentRepository
    let learning: any LearningRepository
    let outbox: any OutboxRepository
    let notices = InMemoryStrandedNotices()
    let transport: MockClientTransport
    let coordinator: ContentBootstrapCoordinator
    let seed: BundledContentSeed
    private let dates: any DateProviding

    init(dates: any DateProviding) throws {
        self.dates = dates
        store = try LocalStore(location: .inMemory)
        content = store.makeContentRepository()
        learning = store.makeLearningRepository()
        outbox = store.makeOutboxRepository()
        transport = MockClientTransport(
            fallbacks: SyntheticContent.responses(now: ContentTestClient.now)
        )
        seed = Self.makeSeed(at: dates.now())
        coordinator = Self.makeCoordinator(
            transport: transport,
            content: content,
            carry: store.makeProgressCarry(),
            notices: notices,
            seed: seed,
            dates: dates
        )
    }

    /// Another coordinator over the same store, as a relaunch would build.
    func makeCoordinator() -> ContentBootstrapCoordinator {
        Self.makeCoordinator(
            transport: transport,
            content: content,
            carry: store.makeProgressCarry(),
            notices: notices,
            seed: seed,
            dates: dates
        )
    }

    private static func makeCoordinator(
        transport: MockClientTransport,
        content: any ContentRepository,
        carry: any ProgressCarrying,
        notices: any StrandedProgressNoticing,
        seed: BundledContentSeed,
        dates: any DateProviding
    ) -> ContentBootstrapCoordinator {
        ContentBootstrapCoordinator(
            service: ContentTestClient.makeService(transport: transport, dates: dates),
            repository: content,
            dates: dates,
            appVersion: "1.2.3",
            pageLimit: 50,
            bundledCatalog: { seed },
            progressCarry: carry,
            strandedNotices: notices
        )
    }

    var strandedCardID: UUID { Self.seededCardID(for: Self.strandedName) }

    /// Answers some of the seeded cards, the way a sitting does: a session, a
    /// review, the projected state and the queued upload, all in the
    /// transaction the runner writes them in.
    func study(_ names: [String], as scope: AccountScope) async throws {
        let cards = names.map { name in
            seed.page.cards.first { $0.displayName == name }!
        }
        let sessionID = UUID(uuidString: "cc000000-0000-4000-8000-000000000001")!
        try await learning.saveSession(
            StudySessionRecord(
                id: sessionID,
                deckID: seed.page.decks.first { $0.code == "EUROPE" }!.id,
                mode: "SELF_RATED",
                selectionOrigin: "CLIENT_OFFLINE",
                requestedUniqueCount: cards.count,
                status: "ACTIVE",
                contentVersion: seed.manifest.contentVersion,
                startedAt: dates.now(),
                completedAt: nil,
                cards: cards.enumerated().map { order, card in
                    StudySessionCardRecord(
                        id: UUID(),
                        learningCardID: card.id,
                        initialOrder: order,
                        selectionReason: "NEW",
                        displayName: card.displayName,
                        promptAssetID: card.promptAssetID,
                        revision: card.revision
                    )
                }
            ),
            for: scope
        )
        for (index, card) in cards.enumerated() {
            let reviewID = UUID()
            try await learning.recordReview(
                ReviewEventRecord(
                    id: reviewID,
                    sessionID: sessionID,
                    learningCardID: card.id,
                    rating: "GOOD",
                    answerMode: "SELF_RATED",
                    selectedOptionID: nil,
                    responseTimeMilliseconds: 1200,
                    clientOccurredAt: dates.now(),
                    estimatedServerOccurredAt: nil,
                    clientSequence: Int64(index + 1),
                    baseStateVersion: nil
                ),
                projectedState: CardStateRecord(
                    learningCardID: card.id,
                    state: "LEARNING",
                    difficulty: 5,
                    stability: 1,
                    dueAt: dates.now(),
                    repetitions: 1,
                    lapses: 0,
                    schedulerVersion: "fsrs-1",
                    stateVersion: 1,
                    updatedAt: dates.now(),
                    isLocalProjection: true
                ),
                outbox: OutboxOperationRecord(
                    id: UUID(),
                    kind: .reviewBatch,
                    dependencyID: sessionID,
                    payload: Self.queuedReview(reviewID: reviewID, sessionID: sessionID, cardID: card.id),
                    state: .pending,
                    attemptCount: 0,
                    lastFailureCode: nil,
                    createdAt: dates.now(),
                    updatedAt: dates.now()
                ),
                for: scope
            )
        }
    }

    /// The number the progress screen shows, computed the way it computes it:
    /// the current release's decks joined against what the learner answered.
    func startedCards(for scope: AccountScope) async throws -> Int {
        LocalProgressProjection.progress(
            cardsByDeck: try await content.cardIdentifiersByDeck(),
            states: try await learning.cardStates(for: scope),
            now: dates.now()
        )
        .map(\.startedCards)
        .max() ?? 0
    }

    /// What the guest import would put on the wire.
    func submitGuestWork(from scope: AccountScope) async throws -> GuestImportPayload {
        let importer = RecordingImporter()
        let coordinator = GuestMigrationCoordinator(
            guestScopes: FixedScope(scope: scope),
            learning: learning,
            importer: importer,
            records: InMemoryMigrationRecords(),
            cleaner: NoOpCleaner(),
            logger: NoOpLogger()
        )
        _ = await coordinator.importGuestWork(
            into: UUID(uuidString: "dd000000-0000-4000-8000-000000000001")!
        )
        let submitted = await importer.submitted
        guard let payload = submitted.first else {
            throw PersistenceError.notFound
        }
        return payload
    }

    // MARK: - The seeded release

    /// The catalogue this build would ship: the same cards the backend
    /// publishes, at the same paths, under identifiers no server issued — plus
    /// one country the arriving release does not carry.
    private static func makeSeed(at now: Date) -> BundledContentSeed {
        let version = "\(BundledContentSeed.versionPrefix)fixture-1"
        let base = "https://cdn.country-flags.app/content/fixture-1/"
        var assets: [AssetRecord] = []
        var cards: [LearningCardRecord] = []
        let published =
            SyntheticContent.flags.map { (name: $0.name, deckCode: $0.deckCode, sha: $0.sha256) }
            + [(name: strandedName, deckCode: "EUROPE", sha: String(repeating: "f", count: 64))]
        for flag in published {
            let assetID = seededAssetID(for: flag.name)
            // The path the release publishes the drawing at is the join: the
            // host and the folder are the release's own address, the tail is
            // the content key.
            assets.append(
                AssetRecord(
                    id: assetID,
                    type: "FLAG",
                    url: URL(
                        string:
                            "\(base)flags/\(flag.deckCode.lowercased())-\(flag.name.lowercased()).png"
                    )!,
                    mimeType: "image/png",
                    sha256: flag.sha,
                    contentVersion: version
                )
            )
            cards.append(
                LearningCardRecord(
                    id: seededCardID(for: flag.name),
                    subjectEntityID: seededEntityID(for: flag.name),
                    templateCode: "FLAG_TO_COUNTRY",
                    templateSchemaVersion: 1,
                    semanticVersion: 1,
                    revision: 1,
                    answerMode: "SELF_RATED",
                    promptAssetID: assetID,
                    displayName: flag.name,
                    aliases: [],
                    contentVersion: version
                )
            )
        }
        let decks = ["ALL_COUNTRIES", "EUROPE"].enumerated().map { index, code in
            DeckRecord(
                id: seededDeckID(for: code),
                code: code,
                kind: index == 0 ? "CURATED" : "TAXONOMY",
                name: code.capitalized,
                deckDescription: "",
                cardCount: cards.count,
                contentVersion: version,
                sortOrder: index
            )
        }
        return BundledContentSeed(
            manifest: ContentManifestRecord(
                contentVersion: version,
                defaultLocale: "en",
                supportedLocales: ["en", "ru"],
                supportedTemplateSchemaVersions: [1],
                assetBaseURL: URL(string: base)!,
                changeCursor: "\(version):0",
                checksum: "seeded",
                appliedAt: now
            ),
            page: ContentPage(
                decks: decks,
                cards: cards,
                deckCards: decks.flatMap { deck in
                    cards.enumerated().map {
                        DeckCardRecord(deckID: deck.id, learningCardID: $1.id, sortOrder: $0)
                    }
                },
                assets: assets
            )
        )
    }

    private static func queuedReview(reviewID: UUID, sessionID: UUID, cardID: UUID) -> Data {
        let payload: [String: Any] = [
            "reviewID": reviewID.uuidString,
            "sessionID": sessionID.uuidString,
            "learningCardID": cardID.uuidString,
            "rating": "GOOD",
            "answerMode": "SELF_RATED",
            "clientOccurredAt": "2026-01-01T00:00:00Z",
            "clientSequence": 1,
        ]
        return (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]))
            ?? Data()
    }

    private static func seededCardID(for name: String) -> UUID { derived("card", name) }
    private static func seededAssetID(for name: String) -> UUID { derived("asset", name) }
    private static func seededEntityID(for name: String) -> UUID { derived("entity", name) }
    private static func seededDeckID(for code: String) -> UUID { derived("deck", code) }

    /// Identifiers the seed invents for itself, which is the whole point: a
    /// server would never issue these.
    private static func derived(_ kind: String, _ key: String) -> UUID {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in Array("\(kind):\(key)".utf8) {
            hash = (hash ^ UInt64(byte)) &* 0x0000_0100_0000_01b3
        }
        var bytes = withUnsafeBytes(of: hash.bigEndian, Array.init)
        bytes += bytes
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(
            uuid: (
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14],
                bytes[15]
            )
        )
    }
}

private final class InMemoryStrandedNotices: StrandedProgressNoticing, @unchecked Sendable {
    private let lock = NSLock()
    private var notice: StrandedProgressNotice?

    func pendingNotice() -> StrandedProgressNotice? {
        lock.withLock { notice }
    }

    func store(_ notice: StrandedProgressNotice) {
        lock.withLock { self.notice = notice }
    }

    func clearNotice() {
        lock.withLock { notice = nil }
    }
}

private struct FixedScope: AccountScopeResolving {
    let scope: AccountScope
    func currentScope() async -> AccountScope { scope }
}

private actor RecordingImporter: GuestImportSubmitting {
    private(set) var submitted: [GuestImportPayload] = []

    func submit(_ payload: GuestImportPayload) async throws -> GuestImportResultRecord {
        submitted.append(payload)
        return GuestImportResultRecord(
            migrationID: payload.migrationID,
            status: .applied,
            acceptedEventCount: payload.reviews.count,
            duplicateEventCount: 0,
            rejectedEventCount: 0,
            completedAt: Date()
        )
    }

    func status(migrationID: UUID) async throws -> GuestImportResultRecord {
        GuestImportResultRecord(
            migrationID: migrationID,
            status: .applied,
            acceptedEventCount: 0,
            duplicateEventCount: 0,
            rejectedEventCount: 0,
            completedAt: Date()
        )
    }
}

private actor InMemoryMigrationRecords: GuestMigrationRecordStoring {
    private var records: [String: GuestMigrationRecord] = [:]

    func record(forScopeKey scopeKey: String) async -> GuestMigrationRecord? {
        records[scopeKey]
    }

    func all() async -> [GuestMigrationRecord] { Array(records.values) }

    func save(_ record: GuestMigrationRecord) async {
        records[record.sourceScopeKey] = record
    }
}

private actor NoOpCleaner: AccountScopeCleaner {
    func erase(scope: AccountScope) async throws {}
}
