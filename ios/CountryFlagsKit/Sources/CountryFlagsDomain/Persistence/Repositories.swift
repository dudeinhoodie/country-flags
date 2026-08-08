import Foundation

/// What a store can fail with, stated in terms a feature can act on.
public enum PersistenceError: Error, Equatable, Sendable {
    case notFound
    /// The write was rolled back; nothing was persisted.
    case transactionFailed(String)
    case storeUnavailable(String)
}

/// Content shared by every account on the device.
///
/// No method takes a scope: a flag is the same flag for a guest and for a
/// signed-in user, and duplicating it per account would multiply the download.
public protocol ContentRepository: Sendable {
    func currentManifest() async throws -> ContentManifestRecord?
    /// Applies a content release. The manifest is written together with the
    /// records it describes, so a half-applied release cannot become the
    /// current one.
    func applyContent(
        manifest: ContentManifestRecord,
        entities: [GeoEntityRecord],
        decks: [DeckRecord],
        cards: [LearningCardRecord],
        deckCards: [DeckCardRecord]
    ) async throws

    func decks() async throws -> [DeckRecord]
    func cards(inDeck deckID: UUID) async throws -> [LearningCardRecord]
    func entity(id: UUID) async throws -> GeoEntityRecord?
    /// Marks content the feed reported as retired. The record stays readable
    /// for a session that is already using it and is never selected again.
    func retire(cardIDs: [UUID], entityIDs: [UUID]) async throws
}

/// Everything owned by one account.
public protocol LearningRepository: Sendable {
    func settings(for scope: AccountScope) async throws -> UserSettingsRecord?
    func saveSettings(_ settings: UserSettingsRecord, for scope: AccountScope) async throws

    func cardStates(for scope: AccountScope) async throws -> [CardStateRecord]
    func saveCardStates(_ states: [CardStateRecord], for scope: AccountScope) async throws

    func activeSession(for scope: AccountScope) async throws -> StudySessionRecord?
    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws
    func reviews(inSession sessionID: UUID, for scope: AccountScope) async throws -> [ReviewEventRecord]

    /// Writes the answer, its projected card state and the outbox entry in one
    /// transaction.
    ///
    /// The session may not continue until this commits: a review that reached
    /// the screen but not the outbox would be lost work the user already did,
    /// and an outbox entry without its review would upload something the
    /// device cannot explain.
    func recordReview(
        _ review: ReviewEventRecord,
        projectedState: CardStateRecord,
        outbox: OutboxOperationRecord,
        for scope: AccountScope
    ) async throws

    func deckProgress(for scope: AccountScope) async throws -> [DeckProgressRecord]
    func saveDeckProgress(_ progress: [DeckProgressRecord], for scope: AccountScope) async throws
    func achievements(for scope: AccountScope) async throws -> [AchievementRecord]
    func saveAchievements(_ achievements: [AchievementRecord], for scope: AccountScope) async throws
}

/// The queue of work waiting to reach the backend.
public protocol OutboxRepository: Sendable {
    func enqueue(_ operation: OutboxOperationRecord, for scope: AccountScope) async throws
    func pendingOperations(for scope: AccountScope) async throws -> [OutboxOperationRecord]
    func updateState(
        of operationID: UUID,
        to state: OutboxState,
        failureCode: String?,
        for scope: AccountScope
    ) async throws
    /// A crash leaves operations claimed but not sent. They belong back in the
    /// queue on the next launch rather than staying invisible forever.
    func requeueInterruptedOperations(for scope: AccountScope) async throws -> Int

    func cursor(_ feed: SyncCursorRecord.Feed, for scope: AccountScope) async throws -> SyncCursorRecord?
    func saveCursor(_ cursor: SyncCursorRecord, for scope: AccountScope) async throws
}

/// Analytics, consent and diagnostics.
public protocol TelemetryRepository: Sendable {
    func privacySettings(for scope: AccountScope) async throws -> PrivacySettingsRecord?
    func savePrivacySettings(_ settings: PrivacySettingsRecord, for scope: AccountScope) async throws

    func enqueueAnalyticsEvent(_ event: AnalyticsEventRecord, for scope: AccountScope) async throws
    func pendingAnalyticsEvents(for scope: AccountScope) async throws -> [AnalyticsEventRecord]
    func removeAnalyticsEvents(ids: [UUID], for scope: AccountScope) async throws
    /// Applies a consent withdrawal to work already queued, so an event the
    /// user no longer allows never leaves the device.
    func removeOptionalAnalyticsEvents(for scope: AccountScope) async throws -> Int

    func enqueueDiagnosticReport(_ report: PendingDiagnosticReportRecord, for scope: AccountScope) async throws
    func pendingDiagnosticReports(for scope: AccountScope) async throws -> [PendingDiagnosticReportRecord]
}

/// Removes one account's data and nothing else.
public protocol AccountScopeCleaner: Sendable {
    /// Deletes every record owned by the scope, leaving shared content and any
    /// other account untouched.
    func erase(scope: AccountScope) async throws
}
