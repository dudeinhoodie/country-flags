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
/// by `-reset-store`. All handlers are invoked serially by
/// `MockClientTransport`, which owns the closures that capture this object.
public final class MockLearningBackend: @unchecked Sendable {
    private struct StoredState: Codable {
        var cardsByDeckID: [String: [String]] = [:]
    }

    private let defaults: UserDefaults
    private let storageKey: String
    private let now: @Sendable () -> Date

    public init(
        arguments: [String] = ProcessInfo.processInfo.arguments,
        defaults: UserDefaults = .standard,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.defaults = defaults
        self.now = now
        let installationID = Self.value(after: "-installation-id", in: arguments) ?? "default"
        let accountUserID = MockAuth.fixtureUserID(arguments: arguments)
        storageKey = "countryflags.mock.learning.\(installationID).\(accountUserID)"
        if arguments.contains("-reset-store") {
            defaults.removeObject(forKey: storageKey)
        }
    }

    public func handlers() -> [String: MockClientTransport.Handler] {
        [
            "createGuestImport": { [self] request in importGuest(request) },
            "getGuestImport": { [self] request in importStatus(request) },
            "getUserChanges": { [self] _ in userChanges() },
            "getProgress": { [self] _ in progress() },
        ]
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
        let decks: [[String: Any]] = state.cardsByDeckID.keys.sorted().map { deckID in
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
        let due = Set(state.cardsByDeckID.values.flatMap { $0 }).count
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

    private func load() -> StoredState {
        guard let data = defaults.data(forKey: storageKey),
            let state = try? JSONDecoder().decode(StoredState.self, from: data)
        else { return StoredState() }
        return state
    }

    private func save(_ state: StoredState) {
        defaults.set(try? JSONEncoder().encode(state), forKey: storageKey)
    }

    private static func json(_ object: [String: Any]) -> MockClientTransport.Response {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else {
            return .errorEnvelope(statusCode: 500, code: "MOCK_ENCODING_FAILED")
        }
        return .json(data)
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
