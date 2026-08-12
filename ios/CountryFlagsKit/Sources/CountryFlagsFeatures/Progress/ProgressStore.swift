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
    public let totalCards: Int
    public let startedCards: Int
    public let dueCards: Int
    /// The tier the server awarded, or nil when it has not spoken about this
    /// deck. A guest never has one: their work is durable on the device but is
    /// not uploaded until there is an account to attribute it to.
    public let masteryTier: MasteryTier?

    public var isUntouched: Bool { startedCards == 0 }

    /// How far through the deck the learner is, for a bar rather than a number.
    public var fraction: Double {
        totalCards > 0 ? Double(startedCards) / Double(totalCards) : 0
    }
}

/// One earned achievement as the screen shows it.
public struct AchievementRow: Identifiable, Hashable, Sendable {
    public let id: UUID
    public let code: String
    public let tier: MasteryTier?
    public let earnedAt: Date?
}

/// What the progress screen reads.
///
/// The counts come from the device's own records rather than from the server:
/// which cards a deck holds and which of them have been answered is something
/// the device can see for itself, and a guest — the only kind of account this
/// build has — is never synchronised at all. Mastery is the opposite. The
/// tiers are the server's product decision, so a tier is displayed when one
/// has arrived and simply absent when none has.
@MainActor
@Observable
public final class ProgressStore {
    public private(set) var decks: [DeckProgressRow] = []
    public private(set) var achievements: [AchievementRow] = []
    public private(set) var isLoaded = false

    private let content: any ContentRepository
    private let learning: any LearningRepository
    private let scopes: any AccountScopeResolving
    private let dates: any DateProviding

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

    public func load() async {
        // The progress belongs to the account that did the work, so the scope
        // is resolved here rather than captured when the screen was built.
        let scope = await scopes.currentScope()
        let states = (try? await learning.cardStates(for: scope)) ?? []
        achievements = ((try? await learning.achievements(for: scope)) ?? [])
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
        // A learner who has answered nothing has no progress, whatever the
        // decks hold, and the screen that says so shows no deck rows at all.
        // Reading the catalogue to build rows nobody sees is what made this
        // screen slow on a fresh install: the release is still being written
        // to the content store then, and a read of it waits for that import.
        guard !states.isEmpty || !achievements.isEmpty else {
            decks = []
            isLoaded = true
            return
        }

        let decks = (try? await content.decks()) ?? []
        let cardsByDeck = (try? await content.cardIdentifiersByDeck()) ?? [:]
        let counted = LocalProgressProjection.progress(
            cardsByDeck: cardsByDeck,
            states: states,
            now: dates.now()
        )
        let countsByDeck = Dictionary(
            counted.map { ($0.deckID, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        // Whatever the server has said about mastery, keyed so a deck it has
        // not ranked simply has no tier rather than a made-up one.
        let tiersByDeck = Dictionary(
            ((try? await learning.deckProgress(for: scope)) ?? [])
                .map { ($0.deckID, MasteryTier(rawValue: $0.currentMasteryTier)) },
            uniquingKeysWith: { first, _ in first }
        )

        self.decks = decks.map { deck in
            let counts = countsByDeck[deck.id]
            return DeckProgressRow(
                id: deck.id,
                code: deck.code,
                name: deck.name,
                totalCards: counts?.totalCards ?? deck.cardCount,
                startedCards: counts?.startedCards ?? 0,
                dueCards: counts?.dueCards ?? 0,
                masteryTier: tiersByDeck[deck.id].flatMap { $0.isEarned ? $0 : nil }
            )
        }
        isLoaded = true
    }

    /// Nothing has been studied yet, which is a different screen from a screen
    /// with numbers on it: it explains where progress comes from instead of
    /// showing a column of zeroes.
    public var hasNoProgress: Bool {
        decks.allSatisfy(\.isUntouched) && achievements.isEmpty
    }
}
