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
    /// Applies a content release in one call. The manifest is written together
    /// with the records it describes, so a half-applied release cannot become
    /// the current one.
    func applyContent(
        manifest: ContentManifestRecord,
        entities: [GeoEntityRecord],
        decks: [DeckRecord],
        cards: [LearningCardRecord],
        deckCards: [DeckCardRecord]
    ) async throws

    /// Applies one page of a release that is not current yet, together with the
    /// point a resume would restart from, in a single transaction.
    ///
    /// Records are upserted on their identifier, so replaying a page whose
    /// commit was lost to a crash converges on the same store rather than
    /// duplicating every row.
    func applyStagedPage(_ page: ContentPage, staging: ContentStagingState) async throws

    /// Where an interrupted download of a version should resume, or nil when
    /// this device has never started that version.
    func stagingState(forVersion contentVersion: String) async throws -> ContentStagingState?

    /// Makes a fully staged release the one every read answers from.
    ///
    /// Until this lands, reads keep answering from the previous release: a
    /// catalog that is half of one version and half of another is never
    /// visible, however far the download got.
    func commitRelease(manifest: ContentManifestRecord) async throws

    func decks() async throws -> [DeckRecord]
    func cards(inDeck deckID: UUID) async throws -> [LearningCardRecord]
    /// One card by identifier, retired or not: a running session holds cards
    /// the current release may already have retired, and their backs still
    /// have to render.
    func card(id: UUID) async throws -> LearningCardRecord?
    /// Which cards each deck holds, as identifiers.
    ///
    /// Counting progress needs to know what is in a deck, not what is on the
    /// cards. Materialising the records instead — every name, every alias,
    /// every fact printed on a back — costs the whole catalogue twice over for
    /// an answer that is a set of identifiers.
    func cardIdentifiersByDeck() async throws -> [UUID: [UUID]]
    func entity(id: UUID) async throws -> GeoEntityRecord?
    /// Resolves the asset a card names as its prompt.
    ///
    /// Assets are addressed by identifier rather than reached through their
    /// entity: a card snapshot in a running session refers to one directly, and
    /// it has to keep resolving even after the entity behind it was retired.
    func asset(id: UUID) async throws -> AssetRecord?
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
    /// One session by its identifier, whatever its status: the uploader needs
    /// the composition of a finished session to import it.
    func session(id: UUID, for scope: AccountScope) async throws -> StudySessionRecord?
    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws
    func reviews(inSession sessionID: UUID, for scope: AccountScope) async throws -> [ReviewEventRecord]

    /// Everything the scope owns, for the one caller that needs all of it:
    /// the guest import, which hands a signed-in account the work this device
    /// did before it had one. Sessions come newest first, reviews in the
    /// order they were made.
    func sessions(for scope: AccountScope) async throws -> [StudySessionRecord]
    func reviews(for scope: AccountScope) async throws -> [ReviewEventRecord]

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

/// Answers which account the device is acting as.
///
/// It is declared here so a feature can address the current account without
/// importing the layer that owns the keychain and the installation identifier.
public protocol AccountScopeResolving: Sendable {
    func currentScope() async -> AccountScope
}

/// Removes one account's data and nothing else.
public protocol AccountScopeCleaner: Sendable {
    /// Deletes every record owned by the scope, leaving shared content and any
    /// other account untouched.
    func erase(scope: AccountScope) async throws
}
