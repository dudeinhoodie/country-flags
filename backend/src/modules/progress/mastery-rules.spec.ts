import { CardLearningState, MasteryTier } from "@prisma/client";

import {
  DAILY_REVIEW_LIMIT,
  remainingDailyAllowance,
} from "./daily-review-limit";
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

/**
 * The day's ceiling.
 *
 * Two weeks away and everything comes due at once. A queue of two hundred
 * and fifty is not a day's work, it is a reason to stop opening the app —
 * so the day asks for fifty and the rest waits (#daily-cap).
 */
describe("aggregateProgress daily allowance", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");

  function due(id: number, daysOverdue: number): ProgressCardMetrics {
    return {
      learningCardId: `card-${id}`,
      state: CardLearningState.REVIEW,
      dueAt: new Date(now.getTime() - daysOverdue * 86_400_000),
      successfulReviews: 5,
      totalReviews: 5,
      recentSuccessfulReviews: 5,
      recentReviews: 5,
    };
  }

  it("cuts today's queue to what the day allows", () => {
    const cards = Array.from({ length: 250 }, (_, index) => due(index, 1));

    const result = aggregateProgress(cards, now, undefined, undefined, 50);

    expect(result.dueCards).toBe(50);
    // The rest is owed, not forgiven: nothing changed about the cards.
    expect(result.totalCards).toBe(250);
  });

  /// The breakdown has to add up to the number above it, or the screen is
  /// describing two different queues.
  it("keeps the breakdown adding up to the capped total", () => {
    const cards = [
      ...Array.from({ length: 30 }, (_, index) => due(index, 3)),
      ...Array.from({ length: 30 }, (_, index) => ({
        ...due(100 + index, 2),
        state: CardLearningState.LEARNING,
      })),
    ];

    const result = aggregateProgress(cards, now, undefined, undefined, 50);

    expect(
      result.overdueCards + result.dueLearningCards + result.dueRelearningCards,
    ).toBe(result.dueCards);
    expect(result.dueCards).toBe(50);
  });

  /// Oldest debt first: what waited longest is what the day asks for.
  it("takes the cards owed longest", () => {
    const cards = [due(1, 10), due(2, 1), due(3, 5)];

    const result = aggregateProgress(cards, now, undefined, undefined, 2);

    expect(result.dueCards).toBe(2);
  });

  it("asks for nothing more once the day is spent", () => {
    const cards = Array.from({ length: 20 }, (_, index) => due(index, 1));

    const result = aggregateProgress(cards, now, undefined, undefined, 0);

    expect(result.dueCards).toBe(0);
  });

  /// The ceiling must not launder a backlog into a tier: the larger the debt,
  /// the smaller the share it would appear to be once capped.
  it("judges the tier by the whole debt rather than the day's dose", () => {
    const known = Array.from({ length: 500 }, (_, index) => ({
      learningCardId: `card-${index}`,
      state: CardLearningState.REVIEW,
      dueAt:
        index < 250
          ? new Date(now.getTime() - 86_400_000)
          : new Date(now.getTime() + 86_400_000),
      successfulReviews: 3,
      totalReviews: 3,
      recentSuccessfulReviews: index === 0 ? 40 : 0,
      recentReviews: index === 0 ? 40 : 0,
    }));

    const capped = aggregateProgress(known, now, undefined, undefined, 50);

    // Half the deck is overdue, so platinum is out of the question however
    // few of them today asks for.
    expect(capped.dueCards).toBe(50);
    expect(capped.currentMasteryTier).not.toBe(MasteryTier.PLATINUM);
  });

  it("reports the whole backlog when no ceiling is given", () => {
    const cards = Array.from({ length: 80 }, (_, index) => due(index, 1));

    expect(aggregateProgress(cards, now).dueCards).toBe(80);
  });
});

describe("remainingDailyAllowance", () => {
  it("spends the day down and never goes below nothing", () => {
    expect(remainingDailyAllowance(0)).toBe(DAILY_REVIEW_LIMIT);
    expect(remainingDailyAllowance(20)).toBe(DAILY_REVIEW_LIMIT - 20);
    expect(remainingDailyAllowance(DAILY_REVIEW_LIMIT)).toBe(0);
    expect(remainingDailyAllowance(DAILY_REVIEW_LIMIT + 10)).toBe(0);
  });
});
