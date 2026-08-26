import Foundation
import Observation

import CountryFlagsDomain

/// One deck as the progress screen shows it.
public struct DeckProgressRow: Identifiable, Hashable, Sendable {
    public let id: UUID
    /// Rows are addressed by the deck's code rather than by position, so a test
    /// does not break when the catalogue gains a deck.
    public let code: String
    public let name: String
    /// Whether this is a curated deck — the whole picture — rather than one
    /// region of it. The screens that avoid double-counting read this.
    public let isCurated: Bool
    public let totalCards: Int
    public let startedCards: Int
    /// Cards that graduated to REVIEW — the ones honestly learned, as opposed
    /// to merely touched.
    public let learnedCards: Int
    public let dueCards: Int
    /// The tier the server awarded, or nil when it has not spoken about this
    /// deck. A guest never has one: their work is durable on the device but is
    /// not uploaded until there is an account to attribute it to.
    public let masteryTier: MasteryTier?

    public var isUntouched: Bool { startedCards == 0 }

    /// How far through the deck the learner is, for a bar rather than a
    /// number. Clamped: a deck whose membership shrank in a republished
    /// release can report more started cards than it now holds, and a bar
    /// drawn from that ratio runs past its card (Oceania did).
    public var fraction: Double {
        totalCards > 0 ? min(1, Double(startedCards) / Double(totalCards)) : 0
    }

    /// The learned share of the same bar, clamped for the same reason.
    public var learnedFraction: Double {
        totalCards > 0 ? min(1, Double(learnedCards) / Double(totalCards)) : 0
    }
}

/// The session someone walked away from, as the offer to walk back.
public struct ContinuableSession: Hashable, Sendable {
    public let deckID: UUID
    public let size: StudySessionSize
    public let mode: StudyAnswerMode
    public let answeredCards: Int
    public let totalCards: Int
}

/// One earned achievement as the screen shows it.
public struct AchievementRow: Identifiable, Hashable, Sendable {
    public let id: UUID
    public let code: String
    public let tier: MasteryTier?
    public let earnedAt: Date?
}

/// Where the numbers on screen came from.
///
/// The distinction the app is built on: an account's counts are the
/// backend's, full stop. What the device can compute for itself is shown for
/// a guest alone, because the backend has never heard of a guest.
public enum ProgressOrigin: Equatable, Sendable {
    /// The backend's own counts, as this device last received them. Offline
    /// this is the last snapshot rather than a fresh one — still the
    /// backend's answer, not a local recomputation.
    case backend
    /// A guest's own records. There is no account to attribute the work to,
    /// so there is nothing for the backend to have an opinion about.
    case device
    /// An account whose counts have never arrived. Nothing is shown rather
    /// than a locally invented figure that would change the moment the real
    /// one landed.
    case awaitingBackend
}

/// What every screen reads its numbers from.
///
/// One instance for the whole app (`AppComposition`), because the same counts
/// appear on four screens and a number that differs between them is a bug the
/// user can see. Screens observe it and never load it themselves: refreshing
/// is driven from one place, after the work that can change the numbers.
///
/// The backend is the single source of truth (ADR-016). For an account the
/// counts, the due breakdown and the mastery tiers are all the backend's; the
/// device's own projection answers for a guest alone. The two are never
/// blended — a screen showing one deck's local count beside another's
/// server count is how the same session came to be worth different numbers
/// in different places.
@MainActor
@Observable
public final class ProgressStore: CanonicalDataObserving {
    public private(set) var decks: [DeckProgressRow] = []
    public private(set) var achievements: [AchievementRow] = []
    /// The unfinished session, when there is one: the screen that knows about
    /// it can offer to continue instead of silently starting over.
    public private(set) var continuable: ContinuableSession?
    /// The backend's breakdown of today's queue: what kind of work is waiting,
    /// overdue, still being learned or never seen.
    public private(set) var dueSummary: DueSummaryRecord?
    /// Whose numbers these are. Screens read it to know whether they may draw
    /// anything at all.
    public private(set) var origin: ProgressOrigin = .awaitingBackend
    /// Whether a reload is in flight over numbers already on screen. Screens
    /// dim rather than hide: a figure that is being checked still says more
    /// than a spinner, as long as it says it is being checked.
    public private(set) var isRefreshing = false
    public var isLoaded: Bool { origin != .awaitingBackend }

    private let content: any ContentRepository
    private let learning: any LearningRepository
    private let scopes: any AccountScopeResolving
    private let dates: any DateProviding
    /// The one reload in flight. A newer request cancels the older, so a slow
    /// early read can no longer land after — and overwrite — a fast late one.
    private var reloadTask: Task<Void, Never>?
    /// Whether a run has ever come home successfully. An empty result then
    /// means "the account has no progress yet", which is an answer; before
    /// it, an empty result means the backend has not spoken.
    private var backendHasAnswered = false

    public init(
        content: any ContentRepository,
        learning: any LearningRepository,
        scopes: any AccountScopeResolving,
        dates: any DateProviding = SystemDateProvider()
    ) {
        self.content = content
        self.learning = learning
        self.scopes = scopes
        self.dates = dates
    }

    /// A sync run landed. The store re-reads, and remembers whether the
    /// backend actually answered — the launch screen waits on the reading
    /// being finished, not on the run, so the app never opens a frame before
    /// the numbers it is about to draw.
    public func canonicalDataDidLand(succeeded: Bool) async {
        if succeeded { backendHasAnswered = true }
        await reload()
    }

    /// Re-reads everything, cancelling whatever read was already running.
    ///
    /// Every caller goes through here rather than through `load` directly:
    /// two overlapping reads used to write their results in the order they
    /// finished, so returning from a session showed the numbers from before
    /// it until something else happened to read again.
    public func reload() async {
        reloadTask?.cancel()
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.load()
        }
        reloadTask = task
        await task.value
    }

    /// Reads the current state. Cancellable: a superseded read stops before
    /// it publishes anything.
    public func load() async {
        isRefreshing = true
        defer { isRefreshing = false }

        // The progress belongs to the account that did the work, so the scope
        // is resolved here rather than captured when the screen was built.
        let scope = await scopes.currentScope()
        let now = dates.now()
        let loadedContinuable = await continuableSession(for: scope)
        // A summary that has aged out is dropped rather than shown: yesterday's
        // queue presented as today's would be worse than no breakdown at all.
        let loadedSummary = (try? await learning.dueSummary(for: scope))
            .flatMap { $0.isFresh(at: now) ? $0 : nil }
        let states = (try? await learning.cardStates(for: scope)) ?? []
        let loadedAchievements = ((try? await learning.achievements(for: scope)) ?? [])
            .filter { $0.earnedAt != nil }
            .sorted { ($0.earnedAt ?? .distantPast) > ($1.earnedAt ?? .distantPast) }
            .map {
                AchievementRow(
                    id: $0.id,
                    code: $0.code,
                    tier: $0.tier.map(MasteryTier.init(rawValue:)),
                    earnedAt: $0.earnedAt
                )
            }
        if Task.isCancelled { return }
        continuable = loadedContinuable
        dueSummary = loadedSummary
        achievements = loadedAchievements

        // A learner who has answered nothing has no progress, whatever the
        // decks hold, and the screen that says so shows no deck rows at all.
        // Reading the catalogue to build rows nobody sees is what made this
        // screen slow on a fresh install: the release is still being written
        // to the content store then, and a read of it waits for that import.
        guard !states.isEmpty || !loadedAchievements.isEmpty else {
            self.decks = []
            origin = scope.isGuest ? .device : .backend
            return
        }

        // The curated decks lead, the regions follow — the same order the
        // catalog offers them in: "All countries" is the whole picture, and
        // burying it among nine regions made the headline row a needle.
        let decks = ((try? await content.decks()) ?? []).sorted { left, right in
            // The kind is read through the domain's own type, so a contract
            // rename of the raw string breaks in one place, not here.
            let leftCurated = DeckKind(rawValue: left.kind) == .curated
            let rightCurated = DeckKind(rawValue: right.kind) == .curated
            if leftCurated != rightCurated { return leftCurated }
            return (left.sortOrder, left.name) < (right.sortOrder, right.name)
        }
        // What the backend last said about every deck. For an account this is
        // the answer — not a starting point to be corrected with local
        // arithmetic.
        let serverProgress = (try? await learning.deckProgress(for: scope)) ?? []
        let tiersByDeck = Dictionary(
            serverProgress.map { ($0.deckID, MasteryTier(rawValue: $0.currentMasteryTier)) },
            uniquingKeysWith: { first, _ in first }
        )
        let serverByDeck = Dictionary(
            serverProgress.map { ($0.deckID, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        if scope.isGuest {
            // Nobody else can be counting: a guest's work is durable on the
            // device and is never uploaded, so the device is the authority
            // for exactly as long as there is no account.
            let counted = LocalProgressProjection.progress(
                cardsByDeck: (try? await content.cardIdentifiersByDeck()) ?? [:],
                states: states,
                now: now
            )
            let countsByDeck = Dictionary(
                counted.map { ($0.deckID, $0) },
                uniquingKeysWith: { first, _ in first }
            )
            if Task.isCancelled { return }
            self.decks = decks.map { deck in
                let counts = countsByDeck[deck.id]
                return DeckProgressRow(
                    id: deck.id,
                    code: deck.code,
                    name: deck.name,
                    isCurated: DeckKind(rawValue: deck.kind) == .curated,
                    totalCards: counts?.totalCards ?? deck.cardCount,
                    startedCards: counts?.startedCards ?? 0,
                    learnedCards: counts?.learnedCards ?? 0,
                    dueCards: counts?.dueCards ?? 0,
                    // Still the server's award if one was ever received: a
                    // tier is never computed here, only displayed.
                    masteryTier: tiersByDeck[deck.id].flatMap { $0.isEarned ? $0 : nil }
                )
            }
            origin = .device
            return
        }

        // An account whose counts have never arrived shows nothing rather
        // than a local guess: the guess would be replaced by a different
        // number the moment the backend answered, and a screen that changes
        // its mind reads as a screen making figures up.
        guard !serverByDeck.isEmpty else {
            if Task.isCancelled { return }
            self.decks = []
            // An account with nothing on the backend yet is a state, not a
            // wait — but only once the backend has actually said so.
            origin = backendHasAnswered ? .backend : .awaitingBackend
            return
        }

        if Task.isCancelled { return }
        self.decks = decks.compactMap { deck in
            // A deck the backend has not spoken about is left out rather than
            // shown as zeroes: absent and "none learned" are different claims.
            guard let server = serverByDeck[deck.id] else { return nil }
            return DeckProgressRow(
                id: deck.id,
                code: deck.code,
                name: deck.name,
                isCurated: DeckKind(rawValue: deck.kind) == .curated,
                totalCards: server.totalCards,
                // Started is learned plus what is still settling: the backend
                // publishes those two rather than a total, and adding them is
                // the same question asked in its vocabulary.
                startedCards: server.learnedCards + server.inProgressCards,
                learnedCards: server.learnedCards,
                dueCards: server.dueCards,
                masteryTier: tiersByDeck[deck.id].flatMap { $0.isEarned ? $0 : nil }
            )
        }
        origin = .backend
    }

    /// How much work the day owes, counted once for every screen.
    ///
    /// The backend's own breakdown when it sent one; otherwise the curated
    /// deck's queue, which spans every card. Summing the rows would
    /// double-count, because a country belongs to the whole-world deck and to
    /// its region at the same time.
    public var totalDue: Int {
        if let dueSummary { return dueSummary.totalDue }
        if let whole = decks.first(where: \.isCurated) { return whole.dueCards }
        return decks.map(\.dueCards).max() ?? 0
    }

    /// The scheduler state of every answered card, keyed by card. The
    /// drill-down reads this to say where each country stands; a card with no
    /// entry has simply never been answered.
    public func cardStatesByID() async -> [UUID: CardStateRecord] {
        let scope = await scopes.currentScope()
        let states = (try? await learning.cardStates(for: scope)) ?? []
        return Dictionary(
            states.map { ($0.learningCardID, $0) },
            uniquingKeysWith: { first, _ in first }
        )
    }

    /// The active session with cards still owed, or nil. Read from the store
    /// rather than remembered: whether a session is unfinished is what the
    /// reviews say, not what a screen last saw.
    private func continuableSession(for scope: AccountScope) async -> ContinuableSession? {
        guard let session = try? await learning.activeSession(for: scope),
            session.status == StudySessionStatus.active.rawValue,
            let mode = StudyAnswerMode(rawValue: session.mode),
            !session.cards.isEmpty
        else {
            return nil
        }
        let reviews = (try? await learning.reviews(inSession: session.id, for: scope)) ?? []
        let answered = Set(reviews.map(\.learningCardID))
        let answeredCards = session.cards.filter { answered.contains($0.learningCardID) }.count
        guard answeredCards < session.cards.count else { return nil }
        return ContinuableSession(
            deckID: session.deckID,
            size: StudySessionSize(storedValue: session.requestedUniqueCount),
            mode: mode,
            answeredCards: answeredCards,
            totalCards: session.cards.count
        )
    }

    /// Nothing has been studied yet, which is a different screen from a screen
    /// with numbers on it: it explains where progress comes from instead of
    /// showing a column of zeroes.
    public var hasNoProgress: Bool {
        decks.allSatisfy(\.isUntouched) && achievements.isEmpty
    }
}
