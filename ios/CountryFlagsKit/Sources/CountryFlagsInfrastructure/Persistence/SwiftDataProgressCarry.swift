import Foundation
import SwiftData

import CountryFlagsDomain

/// Moves a learner's work onto the identifiers of the release that supersedes
/// the one it was done on.
///
/// The catalogue this build ships is stored under identifiers of its own,
/// because a server allocates identifiers this build cannot predict, and the
/// first successful sync replaces it whole (ADR-021). Progress is keyed by
/// card, so without this the rows written before that sync point at cards that
/// are not in the current release: invisible in every count, which joins
/// against it, and refused on import because the backend has never heard of
/// the card, the deck or the release they name. That is #404, and it is what
/// the owner met on the first try — studied as a guest, signed in, and the
/// Progress tab was empty.
///
/// Three properties, in the order they matter:
///
/// - **nothing is deleted.** A row whose card the arriving release does not
///   carry is left exactly where it is, still readable by the session holding
///   it, and counted so the learner can be told;
/// - **one transaction.** An interrupted supersession leaves the store either
///   wholly moved or wholly unmoved, never half of each;
/// - **idempotent.** The mapping names only identifiers of the release being
///   superseded, so running it again over rows that have already moved finds
///   nothing of its own to change.
///
/// It crosses every account on the device on purpose, which is why it is not a
/// method on the learning repository, where every call names one scope.
/// Content is shared by every account, so a release that renumbers it
/// renumbers the guest's work and a signed-in account's work alike.
@ModelActor
actor SwiftDataProgressCarry: ProgressCarrying {
    @discardableResult
    func carry(_ mapping: ContentIdentityMapping) async throws -> CarriedProgress {
        guard !mapping.isEmpty || !mapping.strandedCardIDs.isEmpty else { return .none }
        var carried = CarriedProgress.none
        try transaction {
            let states = try self.carryCardStates(mapping)
            let reviews = try self.carryReviews(mapping)
            let sessions = try self.carrySessions(mapping)
            let queued = try self.carryQueuedReviews(mapping)
            carried = CarriedProgress(
                cardStates: states.moved,
                reviews: reviews,
                sessions: sessions.sessions,
                sessionCards: sessions.cards,
                queuedOperations: queued,
                mergedCardStates: states.merged,
                strandedCards: states.stranded.count
            )
        }
        return carried
    }

    // MARK: - The scheduler state of a card

    /// The rows the counts are computed from, and the reason the Progress tab
    /// was empty.
    ///
    /// The arriving release can already have a state for the card a seeded row
    /// moves onto — an account whose progress the backend answered with before
    /// the catalogue finished arriving. Two rows for one card is not
    /// representable, so one of them wins: what the backend confirmed beats a
    /// local projection, and between two of a kind the one written later does.
    /// The loser is dropped rather than kept as a duplicate, and that is
    /// counted apart from a carry.
    private func carryCardStates(
        _ mapping: ContentIdentityMapping
    ) throws -> (moved: Int, merged: Int, stranded: Set<UUID>) {
        let states = try modelContext.fetch(FetchDescriptor<StoredCardState>())
        var byScopeAndCard: [String: [UUID: StoredCardState]] = [:]
        for state in states {
            byScopeAndCard[state.scopeKey, default: [:]][state.learningCardID] = state
        }

        var moved = 0
        var merged = 0
        var stranded: Set<UUID> = []
        // A row this pass has already merged away is not looked at again. It
        // is still in the array being walked, and reading a deleted model is
        // not something to rely on.
        var dropped: Set<ObjectIdentifier> = []
        for state in states where !dropped.contains(ObjectIdentifier(state)) {
            if mapping.strandedCardIDs.contains(state.learningCardID) {
                stranded.insert(state.learningCardID)
                continue
            }
            guard let destination = mapping.cards[state.learningCardID] else { continue }
            if let existing = byScopeAndCard[state.scopeKey]?[destination.id], existing !== state {
                merged += 1
                if Self.survives(existing, over: state) {
                    modelContext.delete(state)
                    dropped.insert(ObjectIdentifier(state))
                    continue
                }
                modelContext.delete(existing)
                dropped.insert(ObjectIdentifier(existing))
            }
            state.learningCardID = destination.id
            byScopeAndCard[state.scopeKey]?[destination.id] = state
            moved += 1
        }
        return (moved, merged, stranded)
    }

    /// Which of two rows for one card is the one to keep.
    private static func survives(_ left: StoredCardState, over right: StoredCardState) -> Bool {
        if left.isLocalProjection != right.isLocalProjection {
            // The backend is the only source of truth about a card's schedule
            // (ADR-016); a local projection is this device's guess at it.
            return !left.isLocalProjection
        }
        return left.updatedAt >= right.updatedAt
    }

    // MARK: - Answers

    /// Every answer the learner gave, whether or not it has been uploaded.
    ///
    /// They are what a guest import hands to the account, and the backend
    /// resolves each one against the card it names — so an answer that still
    /// names a seeded card is refused for the whole archive.
    private func carryReviews(_ mapping: ContentIdentityMapping) throws -> Int {
        var moved = 0
        for review in try modelContext.fetch(FetchDescriptor<StoredReviewEvent>()) {
            guard let destination = mapping.cards[review.learningCardID] else { continue }
            review.learningCardID = destination.id
            moved += 1
        }
        return moved
    }

    // MARK: - Sittings

    /// The session and the snapshot of every card in it.
    ///
    /// Three things a session names are the release's: the deck it was
    /// composed from, the version it was composed under, and each card's
    /// identifier and revision. All three are declared on import, so all three
    /// have to arrive.
    ///
    /// The card snapshots are otherwise immutable — what was answered stays
    /// the card that was shown — and the exception here is exactly the one the
    /// outbox makes for a corrected resend: what the release calls the card
    /// has changed, and rewriting that is the only way the answer can still be
    /// delivered. The name on the snapshot is left alone, because that is what
    /// the learner actually read.
    private func carrySessions(
        _ mapping: ContentIdentityMapping
    ) throws -> (sessions: Int, cards: Int) {
        var sessions = 0
        var cards = 0
        for session in try modelContext.fetch(FetchDescriptor<StoredStudySession>()) {
            var touched = false
            if let deckID = mapping.decks[session.deckID] {
                session.deckID = deckID
                touched = true
            }
            if session.contentVersion == mapping.supersededVersion {
                session.contentVersion = mapping.arrivingVersion
                touched = true
            }
            for card in session.cards ?? [] {
                guard let destination = mapping.cards[card.learningCardID] else { continue }
                card.learningCardID = destination.id
                card.promptAssetID = destination.promptAssetID
                card.revision = destination.revision
                cards += 1
                touched = true
            }
            if touched { sessions += 1 }
        }
        return (sessions, cards)
    }

    // MARK: - The queue

    /// Answers already queued for upload.
    ///
    /// The payload is stored encoded so a later build cannot change what an
    /// earlier one promised to send, and it is edited here as JSON rather than
    /// re-encoded from today's types — the same way a sequence conflict is
    /// cured. Only the card identifier moves; everything else the learner did
    /// is untouched.
    ///
    /// An operation the backend has already taken is left alone: it is a
    /// record of what was sent, not something that will be sent again.
    private func carryQueuedReviews(_ mapping: ContentIdentityMapping) throws -> Int {
        let kind = OutboxOperationKind.reviewBatch.rawValue
        let synced = OutboxState.synced.rawValue
        var moved = 0
        for operation in try modelContext.fetch(FetchDescriptor<StoredOutboxOperation>())
        where operation.kind == kind && operation.state != synced {
            guard
                var payload = try? JSONSerialization.jsonObject(with: operation.payload)
                    as? [String: Any],
                let text = payload["learningCardID"] as? String,
                let cardID = UUID(uuidString: text),
                let destination = mapping.cards[cardID]
            else { continue }
            payload["learningCardID"] = destination.id.uuidString
            guard
                let data = try? JSONSerialization.data(
                    withJSONObject: payload,
                    options: [.sortedKeys]
                )
            else { continue }
            operation.payload = data
            moved += 1
        }
        return moved
    }
}
