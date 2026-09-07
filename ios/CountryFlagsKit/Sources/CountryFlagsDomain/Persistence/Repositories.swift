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
    /// What each of these cards is about, by card identifier.
    ///
    /// Composing a question needs the kind and nothing else — a state's flag
    /// may not be answered with a country — and the kind lives on the entity
    /// rather than on the card. The default below reads one entity at a time
    /// and deduplicates by entity, which is what a store that cannot answer in
    /// one query does; the requirement is declared here so a store that can
    /// may answer it directly.
    func subjectKinds(forCards cards: [LearningCardRecord]) async -> [UUID: CardSubjectKind]
    /// Resolves the asset a card names as its prompt.
    ///
    /// Assets are addressed by identifier rather than reached through their
    /// entity: a card snapshot in a running session refers to one directly, and
    /// it has to keep resolving even after the entity behind it was retired.
    func asset(id: UUID) async throws -> AssetRecord?
    /// Marks content the feed reported as retired. The record stays readable
    /// for a session that is already using it and is never selected again.
    func retire(cardIDs: [UUID], entityIDs: [UUID]) async throws

    /// Takes the local payload of decks this device may no longer open off the
    /// store.
    ///
    /// Called when an entitlement goes — a refund, a sign-out, an account
    /// swap — and it is best-effort by design. It is access control, not DRM:
    /// the backend refuses the cards of a deck an account does not hold, and
    /// that refusal is what protects the content. What this buys is that
    /// somebody else's purchase does not sit on the device after they leave
    /// it, and that the deck composes no session.
    ///
    /// Three things survive on purpose:
    ///
    /// - a card another deck still holds, because the same country belongs to
    ///   a free deck as often as not;
    /// - the public preview, which is published as public and is what the
    ///   locked deck's fan is drawn from;
    /// - a card an unfinished session is holding, so a sitting already open
    ///   can still be finished — §11.4.
    ///
    /// Progress is untouched. It is keyed by card identifier in a store of its
    /// own, and a refund takes the deck away rather than what somebody
    /// learned.
    ///
    /// - Returns: what went, so the caller can drop the drawings as well.
    @discardableResult
    func removeContent(ofDecks deckIDs: [UUID]) async throws -> RemovedDeckContent
}

/// What `removeContent(ofDecks:)` took off the device.
public struct RemovedDeckContent: Hashable, Sendable {
    /// Rows in the deck-to-card join, which is what makes a deck compose a
    /// session. Removing these alone would be enough to close the deck; the
    /// rest is about not leaving the content behind.
    public let membershipCount: Int
    public let cardIDs: [UUID]
    /// The assets no remaining card draws. Whole records rather than
    /// identifiers, because the cache is keyed by the checksum too.
    public let assets: [AssetRecord]

    public init(membershipCount: Int, cardIDs: [UUID], assets: [AssetRecord]) {
        self.membershipCount = membershipCount
        self.cardIDs = cardIDs
        self.assets = assets
    }

    public static let none = RemovedDeckContent(membershipCount: 0, cardIDs: [], assets: [])

    public var isEmpty: Bool { membershipCount == 0 && cardIDs.isEmpty && assets.isEmpty }
}

extension ContentRepository {
    /// One entity per distinct subject, and a card whose entity the device
    /// does not hold is left out rather than guessed at — the caller reads a
    /// missing card as `CardSubjectKind.unresolved`, which is what a card
    /// published before subdivisions existed is.
    public func subjectKinds(
        forCards cards: [LearningCardRecord]
    ) async -> [UUID: CardSubjectKind] {
        var kindByEntity: [UUID: CardSubjectKind] = [:]
        var kindByCard: [UUID: CardSubjectKind] = [:]
        for card in cards {
            let entityID = card.subjectEntityID
            if let known = kindByEntity[entityID] {
                kindByCard[card.id] = known
                continue
            }
            guard let entity = (try? await entity(id: entityID)) ?? nil else { continue }
            let kind = CardSubjectKind(entityKind: entity.entityKind)
            kindByEntity[entityID] = kind
            kindByCard[card.id] = kind
        }
        return kindByCard
    }
}

/// Everything owned by one account.
public protocol LearningRepository: Sendable {
    func settings(for scope: AccountScope) async throws -> UserSettingsRecord?
    func saveSettings(_ settings: UserSettingsRecord, for scope: AccountScope) async throws

    func cardStates(for scope: AccountScope) async throws -> [CardStateRecord]
    func saveCardStates(_ states: [CardStateRecord], for scope: AccountScope) async throws
    /// Removes the named card states. A tombstone in the change stream is a
    /// deletion decided elsewhere; keeping the row would resurrect what the
    /// account already discarded.
    func deleteCardStates(_ learningCardIDs: [UUID], for scope: AccountScope) async throws
    /// Removes every card state the scope owns. The caller is the change
    /// stream's restart: a rotated stream means the account's progress was
    /// cleared, and a fresh read must not inherit rows the server no longer
    /// knows about.
    func deleteAllCardStates(for scope: AccountScope) async throws

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

    /// The last due summary the backend answered with, whenever that was. A
    /// reader decides for itself whether it is still worth showing.
    func dueSummary(for scope: AccountScope) async throws -> DueSummaryRecord?
    func saveDueSummary(_ summary: DueSummaryRecord, for scope: AccountScope) async throws

    /// Removes everything the learner earned — card states, sessions, the
    /// answers in them, deck mastery, achievements and the due summary — and
    /// keeps the account: its settings, its identities and its devices stand.
    ///
    /// The one caller is the clear-progress flow, and it calls this only after
    /// the backend accepted the deletion: a device that wiped itself on an
    /// unanswered request would lose work the account still holds.
    func deleteAllProgress(for scope: AccountScope) async throws
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

    /// The operations the backend refused with one particular code, oldest
    /// first. Most refusals are final, but not every one is about the
    /// operation itself; the caller decides which codes it knows how to cure.
    func operations(
        failedWith code: String,
        for scope: AccountScope
    ) async throws -> [OutboxOperationRecord]

    /// Replaces an operation's payload and returns it to the queue.
    ///
    /// The payload is otherwise immutable — stored encoded, so a later build
    /// cannot change what an earlier one promised to send. The one exception
    /// is a corrected resend: when the backend refused a field, rewriting that
    /// field is the only way the promise can still be kept.
    func requeue(
        _ operationID: UUID,
        withPayload payload: Data,
        for scope: AccountScope
    ) async throws

    func cursor(_ feed: SyncCursorRecord.Feed, for scope: AccountScope) async throws -> SyncCursorRecord?
    func saveCursor(_ cursor: SyncCursorRecord, for scope: AccountScope) async throws

    /// Drops the queue and every feed cursor the scope owns.
    ///
    /// The other half of clearing progress: an unsent review is progress too,
    /// and a cursor into a stream the account has rotated resolves to nothing.
    /// Called only after the backend accepted the deletion.
    func discardQueuedWork(for scope: AccountScope) async throws
}

/// What the account may open, what it has bought and what is for sale.
///
/// Three concerns and one protocol because they are one story and are written
/// together: a purchase is delivered, the backend answers, and the snapshot is
/// replaced. Offers are shared by every account on the device — they are a
/// catalog, like content — while the snapshot and the delivery queue belong to
/// one account and carry a scope.
public protocol CommerceRepository: Sendable {
    /// What the server last said this account may open, or nil when it has
    /// never been asked. Nil is not "nothing": a client that has not asked
    /// yet must not conclude the customer owns nothing.
    func entitlementSnapshot(for scope: AccountScope) async throws -> EntitlementSnapshotRecord?

    /// Replaces the snapshot in one write. A refund and a purchase both arrive
    /// as a whole answer, so the previous one is never partly overwritten.
    func replaceEntitlementSnapshot(
        _ snapshot: EntitlementSnapshotRecord,
        for scope: AccountScope
    ) async throws

    /// Adds a verified transaction to the durable queue, or leaves the one
    /// already queued for the same store transaction alone.
    ///
    /// The caller writes this before it finishes the transaction with the
    /// store: after that point the store will not hand it over again.
    func enqueuePurchaseDelivery(
        _ delivery: PurchaseDeliveryRecord,
        for scope: AccountScope
    ) async throws

    /// Deliveries still owed to the backend, oldest first.
    func pendingPurchaseDeliveries(
        for scope: AccountScope
    ) async throws -> [PurchaseDeliveryRecord]

    func updatePurchaseDeliveryState(
        of deliveryID: UUID,
        to state: PurchaseDeliveryState,
        failureCode: String?,
        for scope: AccountScope
    ) async throws

    /// A crash leaves deliveries claimed but not sent. They belong back in the
    /// queue on the next launch rather than staying invisible forever.
    func requeueInterruptedPurchaseDeliveries(for scope: AccountScope) async throws -> Int

    /// Drops deliveries the backend has confirmed. Only a confirmed one goes:
    /// anything else is a purchase the customer made and nobody recorded.
    func removePurchaseDeliveries(ids: [UUID], for scope: AccountScope) async throws

    /// The offers this build last downloaded, in the order they were listed.
    func offers() async throws -> [CommerceOfferRecord]

    /// Replaces the offer catalog with what the backend just listed. An offer
    /// that is gone from the answer is withdrawn and must stop being shown.
    func replaceOffers(_ offers: [CommerceOfferRecord]) async throws
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
    /// Clears reports that have been delivered, or that consent no longer
    /// allows to be delivered at all.
    func removeDiagnosticReports(ids: [UUID], for scope: AccountScope) async throws
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
