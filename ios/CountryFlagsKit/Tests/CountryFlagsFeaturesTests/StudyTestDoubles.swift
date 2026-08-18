import Foundation

import CountryFlagsDomain

struct FixedScopeResolver: AccountScopeResolving {
    let scope: AccountScope

    init(scope: AccountScope = .guest(installationID: UUID())) {
        self.scope = scope
    }

    func currentScope() async -> AccountScope { scope }
}

/// Hands out the identifiers a test names, so a review's identity is something
/// the test can assert on rather than something it has to discover.
struct SequentialUUIDProvider: IdentifierProviding {
    private final class Counter: @unchecked Sendable {
        var value = 0
    }

    private let counter = Counter()

    func next() -> UUID {
        counter.value += 1
        return UUID(uuidString: String(format: "aa000000-0000-4000-8000-%012d", counter.value))!
    }
}

/// A learning store that records what it was asked to do.
///
/// `recordReview` is the transactional boundary the session depends on, so this
/// double can refuse it and can be held open, which is what the failure and the
/// double-tap tests need.
actor RecordingLearningRepository: LearningRepository {
    private(set) var sessions: [StudySessionRecord] = []
    private(set) var reviews: [ReviewEventRecord] = []
    private(set) var projectedStates: [CardStateRecord] = []
    private(set) var outbox: [OutboxOperationRecord] = []
    private var states: [CardStateRecord]
    private var failReviews: Bool
    /// When set, `recordReview` waits here until the test releases it.
    private var gate: CheckedContinuation<Void, Never>?
    private var gateIsArmed = false

    init(states: [CardStateRecord] = [], failReviews: Bool = false) {
        self.states = states
        self.failReviews = failReviews
    }

    func setFailReviews(_ value: Bool) { failReviews = value }

    func armGate() { gateIsArmed = true }

    func openGate() {
        gateIsArmed = false
        gate?.resume()
        gate = nil
    }

    func recordedReviews() -> [ReviewEventRecord] { reviews }
    func recordedSessions() -> [StudySessionRecord] { sessions }
    func recordedOutbox() -> [OutboxOperationRecord] { outbox }
    func recordedProjections() -> [CardStateRecord] { projectedStates }

    // MARK: - LearningRepository

    func settings(for scope: AccountScope) async throws -> UserSettingsRecord? { nil }
    func saveSettings(_ settings: UserSettingsRecord, for scope: AccountScope) async throws {}

    func cardStates(for scope: AccountScope) async throws -> [CardStateRecord] { states }
    func saveCardStates(_ states: [CardStateRecord], for scope: AccountScope) async throws {
        self.states = states
    }
    func deleteCardStates(_ learningCardIDs: [UUID], for scope: AccountScope) async throws {
        let ids = Set(learningCardIDs)
        states.removeAll { ids.contains($0.learningCardID) }
    }
    func deleteAllCardStates(for scope: AccountScope) async throws {
        states = []
    }

    func activeSession(for scope: AccountScope) async throws -> StudySessionRecord? {
        sessions.last { $0.status == StudySessionStatus.active.rawValue }
    }

    func saveSession(_ session: StudySessionRecord, for scope: AccountScope) async throws {
        sessions.removeAll { $0.id == session.id }
        sessions.append(session)
    }

    func reviews(inSession sessionID: UUID, for scope: AccountScope) async throws
        -> [ReviewEventRecord]
    {
        reviews.filter { $0.sessionID == sessionID }
    }

    func session(id: UUID, for scope: AccountScope) async throws -> StudySessionRecord? {
        sessions.first { $0.id == id }
    }

    func sessions(for scope: AccountScope) async throws -> [StudySessionRecord] {
        sessions
    }

    func reviews(for scope: AccountScope) async throws -> [ReviewEventRecord] {
        reviews
    }

    func recordReview(
        _ review: ReviewEventRecord,
        projectedState: CardStateRecord,
        outbox operation: OutboxOperationRecord,
        for scope: AccountScope
    ) async throws {
        if gateIsArmed {
            await withCheckedContinuation { continuation in
                gate = continuation
            }
        }
        guard !failReviews else {
            // The whole write is rolled back, so nothing here is recorded.
            throw PersistenceError.transactionFailed("test")
        }
        reviews.append(review)
        projectedStates.append(projectedState)
        outbox.append(operation)
        states.removeAll { $0.learningCardID == projectedState.learningCardID }
        states.append(projectedState)
    }

    func deckProgress(for scope: AccountScope) async throws -> [DeckProgressRecord] { [] }
    func saveDeckProgress(_ progress: [DeckProgressRecord], for scope: AccountScope) async throws {}
    func achievements(for scope: AccountScope) async throws -> [AchievementRecord] { [] }
    func saveAchievements(_ achievements: [AchievementRecord], for scope: AccountScope) async throws {}

    private var storedDueSummary: DueSummaryRecord?

    func dueSummary(for scope: AccountScope) async throws -> DueSummaryRecord? { storedDueSummary }

    func saveDueSummary(_ summary: DueSummaryRecord, for scope: AccountScope) async throws {
        storedDueSummary = summary
    }

    func deleteAllProgress(for scope: AccountScope) async throws {
        states = []
        sessions = []
        reviews = []
        projectedStates = []
        storedDueSummary = nil
    }
}
