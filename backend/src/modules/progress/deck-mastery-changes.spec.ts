import { MasteryTier } from "@prisma/client";

import { deckMasteryChanges, type DeckMasteryRow } from "./progress.service";

function deck(
  scopeId: string,
  figures: Partial<{
    currentMasteryTier: MasteryTier;
    learnedCards: number;
    totalCards: number;
    ruleVersion: number;
  }> = {},
): Parameters<typeof deckMasteryChanges>[1][number] {
  return {
    scopeType: "DECK",
    scopeId,
    totalCards: figures.totalCards ?? 10,
    learnedCards: figures.learnedCards ?? 3,
    currentMasteryTier: figures.currentMasteryTier ?? MasteryTier.BRONZE,
    ruleVersion: figures.ruleVersion ?? 1,
  } as Parameters<typeof deckMasteryChanges>[1][number];
}

function row(
  deckId: string,
  figures: Partial<DeckMasteryRow> = {},
): DeckMasteryRow {
  return {
    deckId,
    tier: MasteryTier.BRONZE,
    masteredCardCount: 3,
    totalCardCount: 10,
    projectionVersion: 1,
    ...figures,
  };
}

describe("deckMasteryChanges", () => {
  // Every rebuild used to rewrite every deck's row; a cache that is already
  // right costs no write (#452).
  it("writes nothing when the cache already says what the projection says", () => {
    expect(
      deckMasteryChanges(
        [row("deck-a"), row("deck-b")],
        [deck("deck-a"), deck("deck-b")],
      ),
    ).toEqual({ stale: [], changed: [] });
  });

  it("writes a deck with no row and a deck whose figures moved", () => {
    const { changed } = deckMasteryChanges(
      [row("deck-a"), row("deck-b")],
      [
        deck("deck-a", { learnedCards: 4 }),
        deck("deck-b"),
        deck("deck-c", {
          currentMasteryTier: MasteryTier.NONE,
          learnedCards: 0,
        }),
      ],
    );

    expect(changed).toEqual([
      row("deck-a", { masteredCardCount: 4 }),
      row("deck-c", { tier: MasteryTier.NONE, masteredCardCount: 0 }),
    ]);
  });

  it.each([
    ["tier", { currentMasteryTier: MasteryTier.SILVER }],
    ["total", { totalCards: 12 }],
    ["rule version", { ruleVersion: 2 }],
  ])("writes a deck whose %s moved", (_what, figures) => {
    expect(
      deckMasteryChanges([row("deck-a")], [deck("deck-a", figures)]).changed,
    ).toHaveLength(1);
  });

  it("deletes the rows of decks no longer published", () => {
    expect(
      deckMasteryChanges([row("deck-a"), row("retired")], [deck("deck-a")])
        .stale,
    ).toEqual(["retired"]);
  });
});
