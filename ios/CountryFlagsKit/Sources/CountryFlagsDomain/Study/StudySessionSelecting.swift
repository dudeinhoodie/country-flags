import Foundation

/// The backend as the composer of sessions.
///
/// The server sees every device's answers once they upload, so its selection
/// is the canonical one; the local selection remains the offline half. Both
/// produce the same stored record, and everything downstream — the screen,
/// the resume, the reviews — cannot tell who composed the session it holds.
public protocol StudySessionSelecting: Sendable {
    /// Asks the backend to compose a session. The identifier is the client's,
    /// minted before the call, so a retry cannot create a second session.
    func serverSession(
        id: UUID,
        deckID: UUID,
        size: StudySessionSize,
        mode: StudyAnswerMode
    ) async throws -> StudySessionRecord

    /// Tells the backend a session it composed is finished. Idempotent, and
    /// best-effort by design: the reviews already carry the learning.
    func completeSession(id: UUID) async
}

/// Hands the backend a session it has never seen, so the reviews that
/// reference it can follow.
public protocol StudySessionImporting: Sendable {
    /// Idempotent on the session identifier. A refusal by content — the deck
    /// changed, a card retired — is permanent: the same composition can never
    /// become acceptable by asking again.
    func importOfflineSession(_ session: StudySessionRecord) async throws
}
