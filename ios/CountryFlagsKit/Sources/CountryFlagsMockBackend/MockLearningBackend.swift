import Foundation

/// The account learning state behind the Mock build.
///
/// Guest import used to return `APPLIED` and forget the payload immediately.
/// The app then switched to the account scope, correctly discarded the guest
/// archive, and downloaded an empty account. That made the mock claim a
/// successful migration while showing no progress, so UI tests could not
/// prove the product's most important account transition.
///
/// This small stateful fixture persists only card identifiers and deck
/// membership in the Mock app's defaults. It survives an app relaunch, is
/// namespaced by the fixed installation ID a UI test supplies, and is cleared
/// by `-reset-store` — or by the account's own progress deletion, which is
/// the fixture's half of that flow. All handlers are invoked serially by
/// `MockClientTransport`, which owns the closures that capture this object.
public final class MockLearningBackend: @unchecked Sendable {
    private struct StoredState: Codable {
        var cardsByDeckID: [String: [String]] = [:]
    }

    /// The contract's one accepted word. Spelled out here rather than reached
    /// for through the generated client: the fixture answers requests, so it
    /// checks what arrived on the wire.
    private static let deletionConfirmation = "DELETE_PROGRESS"
    private static let deletionOperationID = "c1000000-0000-4000-8000-00000000c1ea"

    /// Makes this run's backend refuse to clear progress. Mock only; a release
    /// binary does not contain this module at all.
    public static let refusedDeletionArgument = "-refuse-progress-deletion"

    /// Makes this run's backend accept the answers a device uploads.
    ///
    /// Off by default, and that default is load-bearing: with nothing
    /// answering `createReviewBatch` the queue never drains, which is exactly
    /// the state the sign-out and offline tests are about. A launch that asks
    /// for this is asking for the other half of the story — the network coming
    /// back — so both halves can be told without either test pretending.
    public static let acceptedReviewsArgument = "-accept-reviews"

    /// Where an uploaded answer is remembered.
    ///
    /// A batch names the card but not the deck it was studied from, and
    /// inventing one would put a deck nobody published into the progress
    /// document. The change stream has no such problem — it is card states,
    /// not decks — so the uploads live under a key `progress()` skips and
    /// `userChanges()` reads like any other.
    private static let uploadedKey = "uploaded"

    private let defaults: UserDefaults
    private let storageKey: String
    private let now: @Sendable () -> Date
    /// Whether this run's backend takes the answers a device uploads.
    private let acceptsReviews: Bool
    /// Whether this run's backend refuses to delete progress.
    ///
    /// The safety of the whole operation rests on the order — the server
    /// agrees first, the device erases second — and the only way to see that
    /// order hold is to watch a refusal happen and find the history still
    /// there. A fixture that could only succeed could not prove it.
    private let refusesDeletion: Bool

    public init(
        arguments: [String] = ProcessInfo.processInfo.arguments,
        defaults: UserDefaults = .standard,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.defaults = defaults
        self.now = now
        refusesDeletion = arguments.contains(Self.refusedDeletionArgument)
        acceptsReviews = arguments.contains(Self.acceptedReviewsArgument)
        let installationID = Self.value(after: "-installation-id", in: arguments) ?? "default"
        let accountUserID = MockAuth.fixtureUserID(arguments: arguments)
        storageKey = "countryflags.mock.learning.\(installationID).\(accountUserID)"
        if arguments.contains("-reset-store") {
            defaults.removeObject(forKey: storageKey)
        }
    }

    public func handlers() -> [String: MockClientTransport.Handler] {
        var handlers: [String: MockClientTransport.Handler] = [
            "createGuestImport": { [self] request in importGuest(request) },
            "getGuestImport": { [self] request in importStatus(request) },
            "getUserChanges": { [self] _ in userChanges() },
            "getProgress": { [self] _ in progress() },
            "deleteProgress": { [self] request in clearProgress(request) },
        ]
        // Registered only when the launch asks. An unregistered operation
        // fails loudly, and that failure is what keeps an answer in the queue.
        if acceptsReviews {
            // Both, and they travel together: the backend will not take a
            // review until it holds the session that review belongs to, so a
            // fixture that answered only the batch would fail the import first
            // and never reach the answers at all.
            handlers["createStudySession"] = { [self] request in acceptSession(request) }
            handlers["createReviewBatch"] = { [self] request in acceptReviews(request) }
        }
        return handlers
    }

    private func importGuest(
        _ request: MockClientTransport.RecordedRequest
    ) -> MockClientTransport.Response {
        guard let body = request.body,
            let payload = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            let migrationID = payload["migrationId"] as? String,
            let sessions = payload["sessions"] as? [[String: Any]],
            let reviews = payload["reviews"] as? [[String: Any]]
        else {
            return .errorEnvelope(
                statusCode: 422,
                code: "VALIDATION_FAILED",
                message: "The mock guest import payload is unreadable"
            )
        }

        let deckBySessionID = Dictionary(
            uniqueKeysWithValues: sessions.compactMap { session -> (String, String)? in
                guard let id = session["id"] as? String,
                    let deckID = session["deckId"] as? String
                else { return nil }
                return (id.lowercased(), deckID.lowercased())
            }
        )
        var state = load()
        for review in reviews {
            guard let sessionID = (review["sessionId"] as? String)?.lowercased(),
                let cardID = (review["learningCardId"] as? String)?.lowercased(),
                let deckID = deckBySessionID[sessionID]
            else { continue }
            var cards = state.cardsByDeckID[deckID, default: []]
            if !cards.contains(cardID) { cards.append(cardID) }
            state.cardsByDeckID[deckID] = cards
        }
        save(state)
        return MockAuth.importResult(
            now: now(),
            migrationID: migrationID,
            acceptedEventCount: reviews.count
        )
    }

    private func importStatus(
        _ request: MockClientTransport.RecordedRequest
    ) -> MockClientTransport.Response {
        let migrationID = request.path.split(separator: "/").last.map(String.init)
            ?? "00000000-0000-4000-8000-00000000f00d"
        return MockAuth.importResult(
            now: now(),
            migrationID: migrationID,
            acceptedEventCount: load().cardsByDeckID.values.reduce(0) { $0 + $1.count },
            statusCode: 200
        )
    }

    private func userChanges() -> MockClientTransport.Response {
        let timestamp = Self.timestamp(now())
        let cardIDs = Set(load().cardsByDeckID.values.flatMap { $0 })
        let items: [[String: Any]] = cardIDs.sorted().map { cardID in
            [
                "operation": "UPSERT",
                "resourceType": "CARD_STATE",
                "resourceId": cardID,
                "occurredAt": timestamp,
                "payload": [
                    "learningCardId": cardID,
                    "state": "LEARNING",
                    "difficulty": 5.0,
                    "stability": 1.0,
                    "dueAt": timestamp,
                    "repetitions": 1,
                    "lapses": 0,
                    "schedulerVersion": "mock-v1",
                    "schedulerParametersVersion": "mock-v1",
                    "stateVersion": 1,
                    "updatedAt": timestamp,
                ],
            ]
        }
        return Self.json([
            "items": items,
            "nextCursor": "mock-guest-import-v1",
            "hasMore": false,
        ])
    }

    private func progress() -> MockClientTransport.Response {
        let timestamp = Self.timestamp(now())
        let state = load()
        let deckIDs = state.cardsByDeckID.keys.filter { $0 != Self.uploadedKey }.sorted()
        let decks: [[String: Any]] = deckIDs.map { deckID in
            let started = state.cardsByDeckID[deckID]?.count ?? 0
            let total = max(started, MockContent.cardCount(forDeckID: deckID) ?? started)
            return [
                "deckId": deckID,
                "totalCards": total,
                "learnedCards": 0,
                "dueCards": started,
                "currentMasteryTier": "NONE",
                "highestAchievementTier": "NONE",
                "updatedAt": timestamp,
                "newCards": max(0, total - started),
                "learningCards": started,
                "relearningCards": 0,
                "reviewCards": 0,
                "successfulReviews": started,
                "reviewCount": started,
                "accuracy30Days": 1.0,
                "ruleVersion": 1,
            ]
        }
        let total = decks.compactMap { $0["totalCards"] as? Int }.max() ?? 0
        let due = Set(deckIDs.flatMap { state.cardsByDeckID[$0] ?? [] }).count
        return Self.json([
            "totalCards": total,
            "learnedCards": 0,
            "dueCards": due,
            "currentMasteryTier": "NONE",
            "highestAchievementTier": "NONE",
            "newCards": max(0, total - due),
            "learningCards": due,
            "relearningCards": 0,
            "reviewCards": 0,
            "successfulReviews": due,
            "reviewCount": due,
            "accuracy30Days": due == 0 ? 0.0 : 1.0,
            "ruleVersion": 1,
            "decks": decks,
        ])
    }

    /// `POST /v1/me/study-sessions`: the offline sitting those answers were
    /// given in.
    ///
    /// Echoed back rather than composed: the device already decided what the
    /// sitting was, and this endpoint's job on an offline import is to accept
    /// that decision. Inventing a different composition here would make the
    /// fixture disagree with the device about a session they both name by the
    /// same identifier.
    private func acceptSession(
        _ request: MockClientTransport.RecordedRequest
    ) -> MockClientTransport.Response {
        guard let body = request.body,
            let sent = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            let id = sent["id"] as? String,
            let deckID = sent["deckId"] as? String,
            let requested = sent["requestedUniqueCount"] as? Int
        else {
            return .errorEnvelope(
                statusCode: 422,
                code: "VALIDATION_FAILED",
                message: "The mock offline session is unreadable"
            )
        }

        let cards = sent["cards"] as? [[String: Any]] ?? []
        let timestamp = Self.timestamp(now())
        return Self.json(
            [
                "id": id,
                "deckId": deckID,
                "mode": sent["mode"] as? String ?? "SELF_RATED",
                "selectionOrigin": sent["selectionOrigin"] as? String ?? "CLIENT_OFFLINE",
                "requestedUniqueCount": requested,
                "selectedUniqueCount": cards.count,
                "status": "ACTIVE",
                "contentVersion": sent["contentVersion"] as? String ?? "mock-v1",
                "schedulerVersion": "mock-v1",
                "startedAt": sent["startedAt"] as? String ?? timestamp,
                "cards": cards,
                "serverTime": timestamp,
            ],
            statusCode: 201
        )
    }

    /// `POST /v1/me/reviews`: the answers a device had been holding.
    ///
    /// Every event is acknowledged and remembered, so a device that is told
    /// its answers landed reads a server that has heard of them. Saying
    /// `ACCEPTED` and forgetting would let a queue drain into nothing, which
    /// is the failure this endpoint exists to prevent.
    private func acceptReviews(
        _ request: MockClientTransport.RecordedRequest
    ) -> MockClientTransport.Response {
        guard let body = request.body,
            let payload = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            let events = payload["events"] as? [[String: Any]]
        else {
            return .errorEnvelope(
                statusCode: 422,
                code: "VALIDATION_FAILED",
                message: "The mock review batch is unreadable"
            )
        }

        var state = load()
        var uploaded = state.cardsByDeckID[Self.uploadedKey, default: []]
        for event in events {
            guard let cardID = (event["learningCardId"] as? String)?.lowercased() else { continue }
            if !uploaded.contains(cardID) { uploaded.append(cardID) }
        }
        state.cardsByDeckID[Self.uploadedKey] = uploaded
        save(state)

        let results: [[String: Any]] = events.compactMap { event in
            guard let id = event["id"] as? String else { return nil }
            return ["eventId": id, "status": "ACCEPTED"]
        }
        return Self.json([
            "results": results,
            "achievements": [],
            "deckSummaries": [],
            "serverTime": Self.timestamp(now()),
            "nextSyncCursor": "mock-reviews-v1",
        ])
    }

    /// `DELETE /v1/me/progress`.
    ///
    /// The fixture forgets what it holds rather than answering `202` and
    /// keeping it. A mock that accepted the deletion and went on serving the
    /// same history would let a device clear itself, resynchronize, and
    /// quietly get everything back — which is the one failure this endpoint
    /// exists to prevent, and the one a UI test must be able to see.
    private func clearProgress(
        _ request: MockClientTransport.RecordedRequest
    ) -> MockClientTransport.Response {
        guard let body = request.body,
            let payload = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            payload["confirmation"] as? String == Self.deletionConfirmation
        else {
            return .errorEnvelope(
                statusCode: 422,
                code: "VALIDATION_FAILED",
                message: "The mock progress deletion carries no confirmation"
            )
        }
        // Refused before anything is forgotten: a backend that failed after
        // deleting would be a different bug from the one this simulates.
        if refusesDeletion {
            return .errorEnvelope(
                statusCode: 503,
                code: "SERVICE_UNAVAILABLE",
                message: "The mock backend refuses to clear progress"
            )
        }
        defaults.removeObject(forKey: storageKey)
        return Self.json(
            [
                "operationId": Self.deletionOperationID,
                "status": "COMPLETED",
                "requestedAt": Self.timestamp(now()),
            ],
            statusCode: 202
        )
    }

    private func load() -> StoredState {
        guard let data = defaults.data(forKey: storageKey),
            let state = try? JSONDecoder().decode(StoredState.self, from: data)
        else { return StoredState() }
        return state
    }

    private func save(_ state: StoredState) {
        defaults.set(try? JSONEncoder().encode(state), forKey: storageKey)
    }

    private static func json(
        _ object: [String: Any],
        statusCode: Int = 200
    ) -> MockClientTransport.Response {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else {
            return .errorEnvelope(statusCode: 500, code: "MOCK_ENCODING_FAILED")
        }
        return .json(data, statusCode: statusCode)
    }

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func value(after argument: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: argument), index + 1 < arguments.count else {
            return nil
        }
        return arguments[index + 1]
    }
}
