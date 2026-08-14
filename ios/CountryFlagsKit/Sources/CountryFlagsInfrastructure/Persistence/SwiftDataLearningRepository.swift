import Foundation
import SwiftData

import CountryFlagsDomain

/// Every query here filters on the scope key, which is what keeps a guest, and
/// two accounts on the same device, from reading each other's progress.
@ModelActor
actor SwiftDataLearningRepository: LearningRepository {
    func settings(for scope: AccountScope) async throws -> UserSettingsRecord? {
        let key = scope.key
        var descriptor = FetchDescriptor<StoredUserSettings>(
            predicate: #Predicate { $0.scopeKey == key }
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first.map {
            UserSettingsRecord(
                sessionSize: $0.sessionSize,
                contentLocale: $0.contentLocale,
                defaultAnswerMode: $0.defaultAnswerMode,
                extraFactTypes: $0.extraFactTypes,
                soundEnabled: $0.soundEnabled,
                hapticsEnabled: $0.hapticsEnabled,
                remindersEnabled: $0.remindersEnabled,
                version: $0.version,
                updatedAt: $0.updatedAt
            )
        }
    }

    func saveSettings(_ settings: UserSettingsRecord, for scope: AccountScope) async throws {
        let key = scope.key
        try transaction {
            var descriptor = FetchDescriptor<StoredUserSettings>(
                predicate: #Predicate { $0.scopeKey == key }
            )
            descriptor.fetchLimit = 1
            let stored = try modelContext.fetch(descriptor).first
            if let stored {
                stored.sessionSize = settings.sessionSize
                stored.contentLocale = settings.contentLocale
                stored.defaultAnswerMode = settings.defaultAnswerMode
                stored.extraFactTypes = settings.extraFactTypes
                stored.soundEnabled = settings.soundEnabled
                stored.hapticsEnabled = settings.hapticsEnabled
                stored.remindersEnabled = settings.remindersEnabled
                stored.version = settings.version
                stored.updatedAt = settings.updatedAt
            } else {
                modelContext.insert(
                    StoredUserSettings(
                        scopeKey: key,
                        sessionSize: settings.sessionSize,
                        contentLocale: settings.contentLocale,
                        defaultAnswerMode: settings.defaultAnswerMode,
                        extraFactTypes: settings.extraFactTypes,
                        soundEnabled: settings.soundEnabled,
                        hapticsEnabled: settings.hapticsEnabled,
                        remindersEnabled: settings.remindersEnabled,
                        version: settings.version,
                        updatedAt: settings.updatedAt
                    )
                )
            }
        }
    }

    func cardStates(for scope: AccountScope) async throws -> [CardStateRecord] {
        let key = scope.key
        let descriptor = FetchDescriptor<StoredCardState>(
            predicate: #Predicate { $0.scopeKey == key },
            sortBy: [SortDescriptor(\.dueAt)]
        )
        return try modelContext.fetch(descriptor).map(Self.record)
    }

    func saveCardStates(_ states: [CardStateRecord], for scope: AccountScope) async throws {
        let key = scope.key
        try transaction {
            for state in states {
                try upsertCardState(state, scopeKey: key)
            }
        }
    }

    func activeSession(for scope: AccountScope) async throws -> StudySessionRecord? {
        let key = scope.key
        let active = "ACTIVE"
        var descriptor = FetchDescriptor<StoredStudySession>(
            predicate: #Predicate { $0.scopeKey == key && $0.status == active },
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first.map(Self.record)
    }

    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws {
        let key = scope.key
        let identifier = session.id
        try transaction {
            var descriptor = FetchDescriptor<StoredStudySession>(
                predicate: #Predicate { $0.scopeKey == key && $0.id == identifier }
            )
            descriptor.fetchLimit = 1
            if let stored = try modelContext.fetch(descriptor).first {
                // The card snapshots are immutable; only the lifecycle moves.
                stored.status = session.status
                stored.completedAt = session.completedAt
                return
            }

            let stored = StoredStudySession(
                scopeKey: key,
                id: session.id,
                deckID: session.deckID,
                mode: session.mode,
                selectionOrigin: session.selectionOrigin,
                requestedUniqueCount: session.requestedUniqueCount,
                status: session.status,
                contentVersion: session.contentVersion,
                startedAt: session.startedAt,
                completedAt: session.completedAt
            )
            modelContext.insert(stored)
            stored.cards = session.cards.map {
                StoredStudySessionCard(
                    id: $0.id,
                    learningCardID: $0.learningCardID,
                    initialOrder: $0.initialOrder,
                    selectionReason: $0.selectionReason,
                    displayName: $0.displayName,
                    promptAssetID: $0.promptAssetID,
                    revision: $0.revision,
                    optionIDs: $0.optionIDs,
                    optionNames: $0.optionNames
                )
            }
        }
    }

    func reviews(inSession sessionID: UUID, for scope: AccountScope) async throws -> [ReviewEventRecord] {
        let key = scope.key
        let descriptor = FetchDescriptor<StoredReviewEvent>(
            predicate: #Predicate { $0.scopeKey == key && $0.sessionID == sessionID },
            sortBy: [SortDescriptor(\.clientSequence)]
        )
        return try modelContext.fetch(descriptor).map(Self.record)
    }

    func sessions(for scope: AccountScope) async throws -> [StudySessionRecord] {
        let key = scope.key
        let descriptor = FetchDescriptor<StoredStudySession>(
            predicate: #Predicate { $0.scopeKey == key },
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        return try modelContext.fetch(descriptor).map(Self.record)
    }

    func reviews(for scope: AccountScope) async throws -> [ReviewEventRecord] {
        let key = scope.key
        let descriptor = FetchDescriptor<StoredReviewEvent>(
            predicate: #Predicate { $0.scopeKey == key },
            sortBy: [SortDescriptor(\.clientOccurredAt), SortDescriptor(\.clientSequence)]
        )
        return try modelContext.fetch(descriptor).map(Self.record)
    }

    func recordReview(
        _ review: ReviewEventRecord,
        projectedState: CardStateRecord,
        outbox: OutboxOperationRecord,
        for scope: AccountScope
    ) async throws {
        let key = scope.key
        let reviewID = review.id
        try transaction {
            // The identifier is assigned before the card is answered and never
            // changes, so a repeat is a duplicate rather than a second review.
            var existing = FetchDescriptor<StoredReviewEvent>(
                predicate: #Predicate { $0.scopeKey == key && $0.id == reviewID }
            )
            existing.fetchLimit = 1
            guard try modelContext.fetch(existing).isEmpty else {
                return
            }

            modelContext.insert(
                StoredReviewEvent(
                    scopeKey: key,
                    id: review.id,
                    sessionID: review.sessionID,
                    learningCardID: review.learningCardID,
                    rating: review.rating,
                    answerMode: review.answerMode,
                    selectedOptionID: review.selectedOptionID,
                    responseTimeMilliseconds: review.responseTimeMilliseconds,
                    clientOccurredAt: review.clientOccurredAt,
                    estimatedServerOccurredAt: review.estimatedServerOccurredAt,
                    clientSequence: Int(review.clientSequence),
                    baseStateVersion: review.baseStateVersion
                )
            )
            try upsertCardState(projectedState, scopeKey: key)
            modelContext.insert(
                StoredOutboxOperation(
                    scopeKey: key,
                    id: outbox.id,
                    kind: outbox.kind.rawValue,
                    dependencyID: outbox.dependencyID,
                    payload: outbox.payload,
                    state: outbox.state.rawValue,
                    attemptCount: outbox.attemptCount,
                    lastFailureCode: outbox.lastFailureCode,
                    createdAt: outbox.createdAt,
                    updatedAt: outbox.updatedAt
                )
            )
            try validateWrite()
        }
    }

    func deckProgress(for scope: AccountScope) async throws -> [DeckProgressRecord] {
        let key = scope.key
        let descriptor = FetchDescriptor<StoredDeckProgress>(
            predicate: #Predicate { $0.scopeKey == key }
        )
        return try modelContext.fetch(descriptor).map {
            DeckProgressRecord(
                deckID: $0.deckID,
                totalCards: $0.totalCards,
                learnedCards: $0.learnedCards,
                dueCards: $0.dueCards,
                currentMasteryTier: $0.currentMasteryTier,
                highestAchievementTier: $0.highestAchievementTier,
                updatedAt: $0.updatedAt
            )
        }
    }

    func saveDeckProgress(_ progress: [DeckProgressRecord], for scope: AccountScope) async throws {
        let key = scope.key
        try transaction {
            for item in progress {
                let deckID = item.deckID
                var descriptor = FetchDescriptor<StoredDeckProgress>(
                    predicate: #Predicate { $0.scopeKey == key && $0.deckID == deckID }
                )
                descriptor.fetchLimit = 1
                if let stored = try modelContext.fetch(descriptor).first {
                    stored.totalCards = item.totalCards
                    stored.learnedCards = item.learnedCards
                    stored.dueCards = item.dueCards
                    stored.currentMasteryTier = item.currentMasteryTier
                    stored.highestAchievementTier = item.highestAchievementTier
                    stored.updatedAt = item.updatedAt
                } else {
                    modelContext.insert(
                        StoredDeckProgress(
                            scopeKey: key,
                            deckID: item.deckID,
                            totalCards: item.totalCards,
                            learnedCards: item.learnedCards,
                            dueCards: item.dueCards,
                            currentMasteryTier: item.currentMasteryTier,
                            highestAchievementTier: item.highestAchievementTier,
                            updatedAt: item.updatedAt
                        )
                    )
                }
            }
        }
    }

    func achievements(for scope: AccountScope) async throws -> [AchievementRecord] {
        let key = scope.key
        let descriptor = FetchDescriptor<StoredAchievement>(
            predicate: #Predicate { $0.scopeKey == key },
            sortBy: [SortDescriptor(\.code)]
        )
        return try modelContext.fetch(descriptor).map {
            AchievementRecord(
                id: $0.id,
                code: $0.code,
                category: $0.category,
                tier: $0.tier,
                scopeType: $0.scopeType,
                scopeID: $0.achievementScopeID,
                earnedAt: $0.earnedAt
            )
        }
    }

    func saveAchievements(_ achievements: [AchievementRecord], for scope: AccountScope) async throws {
        let key = scope.key
        try transaction {
            for achievement in achievements {
                let identifier = achievement.id
                var descriptor = FetchDescriptor<StoredAchievement>(
                    predicate: #Predicate { $0.scopeKey == key && $0.id == identifier }
                )
                descriptor.fetchLimit = 1
                if let stored = try modelContext.fetch(descriptor).first {
                    stored.earnedAt = achievement.earnedAt
                    stored.tier = achievement.tier
                } else {
                    modelContext.insert(
                        StoredAchievement(
                            scopeKey: key,
                            id: achievement.id,
                            code: achievement.code,
                            category: achievement.category,
                            tier: achievement.tier,
                            scopeType: achievement.scopeType,
                            achievementScopeID: achievement.scopeID,
                            earnedAt: achievement.earnedAt
                        )
                    )
                }
            }
        }
    }

    // MARK: - Test seam

    /// Injected by a test to fail a write after the inserts, which is how the
    /// rollback of a partially built review can be observed.
    nonisolated(unsafe) static var validateWriteOverride: (@Sendable () throws -> Void)?

    private func validateWrite() throws {
        try Self.validateWriteOverride?()
    }

    // MARK: - Helpers

    private func upsertCardState(_ state: CardStateRecord, scopeKey key: String) throws {
        let cardID = state.learningCardID
        var descriptor = FetchDescriptor<StoredCardState>(
            predicate: #Predicate { $0.scopeKey == key && $0.learningCardID == cardID }
        )
        descriptor.fetchLimit = 1
        if let stored = try modelContext.fetch(descriptor).first {
            stored.state = state.state
            stored.difficulty = state.difficulty
            stored.stability = state.stability
            stored.dueAt = state.dueAt
            stored.repetitions = state.repetitions
            stored.lapses = state.lapses
            stored.schedulerVersion = state.schedulerVersion
            stored.stateVersion = state.stateVersion
            stored.updatedAt = state.updatedAt
            stored.isLocalProjection = state.isLocalProjection
        } else {
            modelContext.insert(
                StoredCardState(
                    scopeKey: key,
                    learningCardID: state.learningCardID,
                    state: state.state,
                    difficulty: state.difficulty,
                    stability: state.stability,
                    dueAt: state.dueAt,
                    repetitions: state.repetitions,
                    lapses: state.lapses,
                    schedulerVersion: state.schedulerVersion,
                    stateVersion: state.stateVersion,
                    updatedAt: state.updatedAt,
                    isLocalProjection: state.isLocalProjection
                )
            )
        }
    }

    private static func record(_ stored: StoredCardState) -> CardStateRecord {
        CardStateRecord(
            learningCardID: stored.learningCardID,
            state: stored.state,
            difficulty: stored.difficulty,
            stability: stored.stability,
            dueAt: stored.dueAt,
            repetitions: stored.repetitions,
            lapses: stored.lapses,
            schedulerVersion: stored.schedulerVersion,
            stateVersion: stored.stateVersion,
            updatedAt: stored.updatedAt,
            isLocalProjection: stored.isLocalProjection
        )
    }

    private static func record(_ stored: StoredReviewEvent) -> ReviewEventRecord {
        ReviewEventRecord(
            id: stored.id,
            sessionID: stored.sessionID,
            learningCardID: stored.learningCardID,
            rating: stored.rating,
            answerMode: stored.answerMode,
            selectedOptionID: stored.selectedOptionID,
            responseTimeMilliseconds: stored.responseTimeMilliseconds,
            clientOccurredAt: stored.clientOccurredAt,
            estimatedServerOccurredAt: stored.estimatedServerOccurredAt,
            clientSequence: Int64(stored.clientSequence),
            baseStateVersion: stored.baseStateVersion
        )
    }

    private static func record(_ stored: StoredStudySession) -> StudySessionRecord {
        StudySessionRecord(
            id: stored.id,
            deckID: stored.deckID,
            mode: stored.mode,
            selectionOrigin: stored.selectionOrigin,
            requestedUniqueCount: stored.requestedUniqueCount,
            status: stored.status,
            contentVersion: stored.contentVersion,
            startedAt: stored.startedAt,
            completedAt: stored.completedAt,
            cards: (stored.cards ?? [])
                .sorted { $0.initialOrder < $1.initialOrder }
                .map {
                    StudySessionCardRecord(
                        id: $0.id,
                        learningCardID: $0.learningCardID,
                        initialOrder: $0.initialOrder,
                        selectionReason: $0.selectionReason,
                        displayName: $0.displayName,
                        promptAssetID: $0.promptAssetID,
                        revision: $0.revision,
                        optionIDs: $0.optionIDs,
                        optionNames: $0.optionNames
                    )
                }
        )
    }
}
