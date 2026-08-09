import Foundation

/// What the backend decided about one submitted review.
///
/// The raw values are the contract's. They are typed because each one means a
/// different thing for the queue, and treating two of them alike is how a
/// device either loses work or replays it forever.
public enum ReviewAcknowledgementStatus: String, Hashable, Sendable, CaseIterable {
    /// Stored. The pending item can go.
    case accepted = "ACCEPTED"
    /// Already stored from an earlier attempt. The item can go for the same
    /// reason: the work is on the server, which is what the queue was for.
    case duplicate = "DUPLICATE"
    /// Refused for good. Retrying would loop forever, so the item is parked
    /// with its code rather than deleted or retried.
    case rejected = "REJECTED"
    /// The backend has it but has not settled it yet. The item stays pending.
    case reconciliationPending = "RECONCILIATION_PENDING"
}

/// One decision, with whatever canonical state came back with it.
public struct ReviewAcknowledgement: Hashable, Sendable {
    public let eventID: UUID
    public let status: ReviewAcknowledgementStatus
    public let rejectionCode: String?
    /// The server's own card state. It replaces the local projection wholesale
    /// rather than being merged with it.
    public let cardState: CardStateRecord?

    public init(
        eventID: UUID,
        status: ReviewAcknowledgementStatus,
        rejectionCode: String?,
        cardState: CardStateRecord?
    ) {
        self.eventID = eventID
        self.status = status
        self.rejectionCode = rejectionCode
        self.cardState = cardState
    }

    /// Whether the queue is done with this item.
    ///
    /// Accepted and duplicate both mean the work reached the server. A
    /// rejection is finished too, but parked rather than cleared, so support
    /// can see what the backend refused.
    public var clearsPendingItem: Bool {
        switch status {
        case .accepted, .duplicate: true
        case .rejected, .reconciliationPending: false
        }
    }
}

/// What one batch produced.
public struct ReviewBatchOutcome: Sendable {
    public let acknowledgements: [ReviewAcknowledgement]
    public let cursor: String?
    public let serverTime: Date

    public init(acknowledgements: [ReviewAcknowledgement], cursor: String?, serverTime: Date) {
        self.acknowledgements = acknowledgements
        self.cursor = cursor
        self.serverTime = serverTime
    }
}

/// Decides whether a canonical state may replace what the device holds.
public enum CanonicalStateMerge {
    /// - Returns: the state to store, or nil when the device already holds
    ///   something newer.
    ///
    /// A response can arrive after the learner has answered the same card
    /// again. Applying it then would roll their progress backwards, so a
    /// canonical state only lands when it is at least as new as a local
    /// projection — and a canonical state always beats a projection of the same
    /// version, because the projection was only ever a guess at it.
    public static func resolve(
        canonical: CardStateRecord,
        local: CardStateRecord?
    ) -> CardStateRecord? {
        guard let local else { return canonical }
        if canonical.stateVersion > local.stateVersion { return canonical }
        if canonical.stateVersion == local.stateVersion, local.isLocalProjection { return canonical }
        return nil
    }
}
