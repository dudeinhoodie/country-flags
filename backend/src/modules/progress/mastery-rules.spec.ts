import { CardLearningState, MasteryTier } from "@prisma/client";

import { aggregateProgress, type ProgressCardMetrics } from "./mastery-rules";

function cards(input: {
  total: number;
  qualified: number;
  successesPerQualified: number;
  recentCorrect: number;
  recentTotal: number;
  overdue?: number;
}): ProgressCardMetrics[] {
  return Array.from({ length: input.total }, (_, index) => ({
    learningCardId: `card-${index}`,
    state:
      index < input.qualified
        ? CardLearningState.REVIEW
        : CardLearningState.NEW,
    dueAt:
      index < (input.overdue ?? 0)
        ? new Date("2026-07-01T00:00:00.000Z")
        : new Date("2026-09-01T00:00:00.000Z"),
    successfulReviews:
      index < input.qualified ? input.successesPerQualified : 0,
    totalReviews: index < input.qualified ? input.successesPerQualified : 0,
    recentSuccessfulReviews: index === 0 ? input.recentCorrect : 0,
    recentReviews: index === 0 ? input.recentTotal : 0,
  }));
}

describe("aggregateProgress mastery thresholds", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it.each([
    {
      name: "none below bronze coverage",
      input: cards({
        total: 10,
        qualified: 4,
        successesPerQualified: 2,
        recentCorrect: 8,
        recentTotal: 10,
      }),
      expected: MasteryTier.NONE,
    },
    {
      name: "bronze at its exact boundaries",
      input: cards({
        total: 10,
        qualified: 5,
        successesPerQualified: 1,
        recentCorrect: 7,
        recentTotal: 10,
      }),
      expected: MasteryTier.BRONZE,
    },
    {
      name: "silver at its exact boundaries",
      input: cards({
        total: 12,
        qualified: 9,
        successesPerQualified: 2,
        recentCorrect: 8,
        recentTotal: 10,
      }),
      expected: MasteryTier.SILVER,
    },
    {
      name: "gold at its exact boundaries",
      input: cards({
        total: 10,
        qualified: 9,
        successesPerQualified: 3,
        recentCorrect: 9,
        recentTotal: 10,
      }),
      expected: MasteryTier.GOLD,
    },
    {
      name: "platinum with no more than ten percent overdue",
      input: cards({
        total: 10,
        qualified: 10,
        successesPerQualified: 3,
        recentCorrect: 19,
        recentTotal: 20,
        overdue: 1,
      }),
      expected: MasteryTier.PLATINUM,
    },
    {
      name: "gold when platinum has too many overdue cards",
      input: cards({
        total: 10,
        qualified: 10,
        successesPerQualified: 3,
        recentCorrect: 19,
        recentTotal: 20,
        overdue: 2,
      }),
      expected: MasteryTier.GOLD,
    },
  ])("returns $expected for $name", ({ input, expected }) => {
    expect(aggregateProgress(input, now).currentMasteryTier).toBe(expected);
  });

  it("reports due/new/learning/review counts and recent accuracy", () => {
    const result = aggregateProgress(
      [
        {
          learningCardId: "new",
          state: null,
          dueAt: null,
          successfulReviews: 0,
          totalReviews: 0,
          recentSuccessfulReviews: 0,
          recentReviews: 0,
        },
        {
          learningCardId: "learning",
          state: CardLearningState.LEARNING,
          dueAt: new Date("2026-08-01T00:00:00.000Z"),
          successfulReviews: 1,
          totalReviews: 2,
          recentSuccessfulReviews: 1,
          recentReviews: 2,
        },
        {
          learningCardId: "review",
          state: CardLearningState.REVIEW,
          dueAt: new Date("2026-09-01T00:00:00.000Z"),
          successfulReviews: 3,
          totalReviews: 3,
          recentSuccessfulReviews: 3,
          recentReviews: 3,
        },
      ],
      now,
    );

    expect(result).toMatchObject({
      totalCards: 3,
      learnedCards: 1,
      dueCards: 1,
      newCards: 1,
      learningCards: 1,
      reviewCards: 1,
      reviewCount: 5,
      accuracy30Days: 0.8,
    });
  });

  /**
   * Learned is three correct answers, not the state the scheduler put the
   * card in.
   *
   * The two used to be the same thing, and a sitting could end with nothing
   * learned because the first repetition is an hour out (ADR-013) — the
   * screen said the work had not counted.
   */
  it("counts three correct answers as learned, whatever the scheduler calls the card", () => {
    const result = aggregateProgress(
      [
        // Still in its learning steps, but answered right three times.
        {
          learningCardId: "learning-but-known",
          state: CardLearningState.LEARNING,
          dueAt: new Date("2026-08-01T00:00:00.000Z"),
          successfulReviews: 3,
          totalReviews: 3,
          recentSuccessfulReviews: 3,
          recentReviews: 3,
        },
        // Graduated by the scheduler, but only twice right: two correct
        // answers are not yet knowing a flag.
        {
          learningCardId: "graduated-but-thin",
          state: CardLearningState.REVIEW,
          dueAt: new Date("2026-09-01T00:00:00.000Z"),
          successfulReviews: 2,
          totalReviews: 4,
          recentSuccessfulReviews: 2,
          recentReviews: 4,
        },
      ],
      now,
    );

    expect(result.learnedCards).toBe(1);
  });

  /// A card answered once is in progress, and in progress is not learned:
  /// the two counts must never name the same card (#232).
  it("keeps a card answered once out of the learned count", () => {
    const result = aggregateProgress(
      [
        {
          learningCardId: "touched-once",
          state: CardLearningState.LEARNING,
          dueAt: new Date("2026-08-01T00:00:00.000Z"),
          successfulReviews: 1,
          totalReviews: 1,
          recentSuccessfulReviews: 1,
          recentReviews: 1,
        },
      ],
      now,
    );

    expect(result).toMatchObject({ learnedCards: 0, newCards: 0 });
  });
});
