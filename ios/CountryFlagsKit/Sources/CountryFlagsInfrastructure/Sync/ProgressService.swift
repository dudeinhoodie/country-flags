import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// Reads `/v1/me/progress`, `/v1/me/achievements`, `/v1/me/due-summary` and
/// `/v1/me/settings`, writes settings back under optimistic concurrency, and
/// asks for an account's progress to be deleted.
public struct ProgressService: ProgressDownloading, SettingsSyncing, ProgressClearing {
    /// Enough pages to carry every achievement the rules can award, and a stop
    /// so a server that always reports `hasMore` cannot spin here forever.
    private static let achievementPageLimit = 20

    private let clientFactory: APIClientFactory
    private let logger: any AppLogging

    public init(clientFactory: APIClientFactory, logger: any AppLogging = NoOpLogger()) {
        self.clientFactory = clientFactory
        self.logger = logger
    }

    public func download() async throws -> ProgressSnapshot {
        let client = clientFactory.makeClient()
        // Each document on its own request and each outcome kept: the four
        // ride in parallel, and the one the radio drops must not cost the
        // three that land. What did not arrive is reported, not swallowed.
        async let decksResult = Self.attempt { try await deckProgress(using: client) }
        async let achievementsResult = Self.attempt { try await achievements(using: client) }
        async let settingsResult = Self.attempt { try await settings(using: client) }
        async let dueSummaryResult = Self.attempt { try await dueSummary(using: client) }
        let results = await (decksResult, achievementsResult, settingsResult, dueSummaryResult)

        var missing: Set<ProgressSnapshot.Part> = []
        var firstFailure: (any Error)?
        func delivered<Value>(
            _ result: Result<Value, any Error>,
            _ part: ProgressSnapshot.Part
        ) -> Value? {
            switch result {
            case .success(let value):
                return value
            case .failure(let error):
                missing.insert(part)
                if firstFailure == nil { firstFailure = error }
                return nil
            }
        }
        let snapshot = ProgressSnapshot(
            decks: delivered(results.0, .decks),
            achievements: delivered(results.1, .achievements),
            settings: delivered(results.2, .settings) ?? nil,
            dueSummary: delivered(results.3, .dueSummary) ?? nil
        )
        if let firstFailure {
            throw PartialProgressDownload(
                delivered: snapshot,
                missing: missing,
                underlying: firstFailure
            )
        }
        return snapshot
    }

    private static func attempt<Value: Sendable>(
        _ work: @Sendable () async throws -> Value
    ) async -> Result<Value, any Error> {
        do {
            return .success(try await work())
        } catch {
            return .failure(error)
        }
    }

    public func update(_ settings: UserSettingsRecord) async throws -> SettingsUpdateOutcome {
        let client = clientFactory.makeClient()
        let output: Operations.updateSettings.Output
        do {
            output = try await client.updateSettings(
                headers: .init(If_hyphen_Match: Self.entityTag(forVersion: settings.version)),
                body: .json(Self.updateRequest(from: settings))
            )
        } catch {
            let mapped = APIError.from(error)
            // A refusal on the version is not a failure to report: it is the
            // other device having written first, and the caller recovers by
            // taking what the server has.
            if Self.isVersionConflict(mapped) {
                return .conflict(try? await self.settings(using: client))
            }
            throw mapped
        }

        switch output {
        case .ok(let response):
            return .updated(try Self.settings(from: response.body.json))
        case .conflict:
            return .conflict(try? await self.settings(using: client))
        case .default:
            throw APIError.status(
                APIErrorDetails(
                    statusCode: 0,
                    code: "UNKNOWN",
                    message: "Unmapped settings response",
                    requestID: nil
                )
            )
        }
    }

    /// Asks the backend to delete the account's progress, proving the request
    /// with what the learner just signed in for.
    ///
    /// Nothing local is touched here: the caller wipes the device only once
    /// this returns, so a refusal — a dead session, a network that dropped —
    /// leaves the learner with everything they had.
    public func clearProgress() async throws -> ProgressDeletionOutcome {
        let client = clientFactory.makeClient()
        let output: Operations.deleteProgress.Output
        do {
            output = try await client.deleteProgress(
                body: .json(.init(confirmation: .DELETE_PROGRESS))
            )
        } catch {
            throw APIError.from(error)
        }

        switch output {
        case .accepted(let response):
            let payload = try response.body.json
            guard let operationID = UUID(uuidString: payload.operationId) else {
                throw APIError.decoding("The deletion names an operation this client cannot read")
            }
            // An unknown status is refused rather than read as "done": the
            // device is about to delete a learner's history on the strength of
            // this answer.
            guard let status = ProgressDeletionOutcome.Status(rawValue: payload.status.rawValue)
            else {
                throw APIError.decoding("The deletion reports a status this client cannot read")
            }
            logger.log(
                .notice,
                .sync,
                "The backend accepted a progress deletion",
                ["status": .safe(status.rawValue)]
            )
            return ProgressDeletionOutcome(
                operationID: operationID,
                status: status,
                requestedAt: payload.requestedAt
            )
        case .unauthorized, .unprocessableContent, .default:
            throw APIError.status(
                APIErrorDetails(
                    statusCode: 0,
                    code: "UNKNOWN",
                    message: "Unmapped progress deletion response",
                    requestID: nil
                )
            )
        }
    }

    // MARK: - Reads

    private func deckProgress(using client: some APIProtocol) async throws -> [DeckProgressRecord] {
        let output: Operations.getProgress.Output
        do {
            output = try await client.getProgress()
        } catch {
            throw APIError.from(error)
        }
        guard case .ok(let response) = output else { return [] }
        let payload = try response.body.json
        return (payload.decks ?? []).compactMap(Self.deckProgress)
    }

    private func achievements(using client: some APIProtocol) async throws -> [AchievementRecord] {
        var collected: [AchievementRecord] = []
        var cursor: String?
        for _ in 0..<Self.achievementPageLimit {
            let output: Operations.listAchievements.Output
            do {
                output = try await client.listAchievements(query: .init(cursor: cursor))
            } catch {
                throw APIError.from(error)
            }
            guard case .ok(let response) = output else { break }
            let payload = try response.body.json
            collected.append(contentsOf: payload.items.compactMap(Self.achievement))
            guard payload.page.hasMore, let next = payload.page.nextCursor else { break }
            cursor = next
        }
        return collected
    }

    /// The queue as the backend counts it. Absent rather than zeroed when the
    /// answer is not a 200: nobody counted is not the same as nothing waiting,
    /// and the screen that reads this says nothing instead of "0".
    private func dueSummary(using client: some APIProtocol) async throws -> DueSummaryRecord? {
        let output: Operations.getDueSummary.Output
        do {
            output = try await client.getDueSummary()
        } catch {
            throw APIError.from(error)
        }
        guard case .ok(let response) = output else { return nil }
        return Self.dueSummary(from: try response.body.json)
    }

    private func settings(using client: some APIProtocol) async throws -> UserSettingsRecord? {
        let output: Operations.getSettings.Output
        do {
            output = try await client.getSettings()
        } catch {
            throw APIError.from(error)
        }
        guard case .ok(let response) = output else { return nil }
        return try Self.settings(from: response.body.json)
    }

    // MARK: - Mapping

    /// `W/"4"`: the contract encodes the integer version as a weak entity tag,
    /// which is why the stored record carries the version rather than a tag.
    static func entityTag(forVersion version: Int) -> String {
        "W/\"\(version)\""
    }

    private static func isVersionConflict(_ error: APIError) -> Bool {
        switch error {
        case .conflict: true
        // The same refusal expressed against the header the request sent,
        // which is what a precondition on `If-Match` produces.
        case .client(let details): details.statusCode == 412
        default: false
        }
    }

    private static func deckProgress(
        from payload: Components.Schemas.DeckProgress
    ) -> DeckProgressRecord? {
        guard let deckID = UUID(uuidString: payload.deckId) else { return nil }
        return DeckProgressRecord(
            deckID: deckID,
            totalCards: payload.totalCards,
            learnedCards: payload.learnedCards,
            dueCards: payload.dueCards,
            // Started but not finished: every card that has been answered,
            // less the ones that count as learned.
            //
            // Derived rather than taken from the scheduler's own states,
            // because learned is now three correct answers and a card can
            // reach that while the scheduler still calls it LEARNING. Summing
            // the states would then name the same card in both counts, and
            // the tally would show one card twice.
            inProgressCards: max(
                0,
                payload.totalCards - (payload.newCards ?? 0) - payload.learnedCards
            ),
            currentMasteryTier: payload.currentMasteryTier,
            highestAchievementTier: payload.highestAchievementTier,
            updatedAt: payload.updatedAt
        )
    }

    /// `review` is optional in the contract — a release that stops sending it
    /// leaves the breakdown one line shorter rather than failing the download.
    private static func dueSummary(
        from payload: Components.Schemas.DueSummary
    ) -> DueSummaryRecord {
        DueSummaryRecord(
            overdue: payload.overdue,
            learning: payload.learning,
            relearning: payload.relearning,
            review: payload.review ?? 0,
            newCards: payload.newCards,
            totalDue: payload.totalDue,
            serverTime: payload.serverTime
        )
    }

    private static func achievement(
        from payload: Components.Schemas.Achievement
    ) -> AchievementRecord? {
        guard let id = UUID(uuidString: payload.id) else { return nil }
        // An achievement the learner has not earned is not progress to store:
        // the screen lists what was reached, and the catalogue of what exists
        // is the server's business.
        guard payload.earned else { return nil }
        return AchievementRecord(
            id: id,
            code: payload.code,
            category: payload.category,
            tier: payload.tier,
            scopeType: payload.scopeType?.rawValue ?? "GLOBAL",
            scopeID: payload.scopeId.flatMap(UUID.init(uuidString:)),
            earnedAt: payload.earnedAt
        )
    }

    private static func settings(
        from payload: Components.Schemas.UserSettings
    ) throws -> UserSettingsRecord {
        UserSettingsRecord(
            sessionSize: payload.sessionSize.rawValue,
            contentLocale: payload.contentLocale,
            defaultAnswerMode: payload.defaultAnswerMode.rawValue,
            extraFactTypes: payload.extraFactTypes,
            soundEnabled: payload.soundEnabled,
            hapticsEnabled: payload.hapticsEnabled,
            remindersEnabled: payload.remindersEnabled,
            version: payload.version,
            updatedAt: payload.updatedAt
        )
    }

    private static func updateRequest(
        from settings: UserSettingsRecord
    ) -> Components.Schemas.UpdateSettingsRequest {
        .init(
            sessionSize: .init(rawValue: settings.sessionSize),
            contentLocale: settings.contentLocale,
            defaultAnswerMode: .init(rawValue: settings.defaultAnswerMode),
            soundEnabled: settings.soundEnabled,
            hapticsEnabled: settings.hapticsEnabled,
            remindersEnabled: settings.remindersEnabled
        )
    }
}
