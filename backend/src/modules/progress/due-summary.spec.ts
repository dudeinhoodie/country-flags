import { CardLearningState } from "@prisma/client";

import {
  aggregateProgress,
  LEARNED_SUCCESSFUL_REVIEWS,
  type ProgressCardMetrics,
} from "./mastery-rules";
import { dueSummaryResponse } from "./progress.service";

describe("dueSummaryResponse", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const dayAgo = new Date(now.getTime() - 86_400_000);

  function card(
    id: string,
    state: CardLearningState,
    successfulReviews: number,
    dueAt: Date = dayAgo,
  ): ProgressCardMetrics {
    return {
      learningCardId: id,
      state,
      dueAt,
      successfulReviews,
      totalReviews: Math.max(1, successfulReviews),
      recentSuccessfulReviews: successfulReviews,
      recentReviews: Math.max(1, successfulReviews),
    };
  }

  const oneShort = LEARNED_SUCCESSFUL_REVIEWS - 1;
  const aggregate = aggregateProgress(
    [
      card("review-one-short", CardLearningState.REVIEW, oneShort),
      card(
        "review-learned",
        CardLearningState.REVIEW,
        LEARNED_SUCCESSFUL_REVIEWS,
      ),
      card("learning", CardLearningState.LEARNING, 1),
      card("relearning", CardLearningState.RELEARNING, oneShort),
      card(
        "not-due",
        CardLearningState.REVIEW,
        oneShort,
        new Date(now.getTime() + 86_400_000),
      ),
      {
        learningCardId: "new",
        state: null,
        dueAt: null,
        successfulReviews: 0,
        totalReviews: 0,
        recentSuccessfulReviews: 0,
        recentReviews: 0,
      },
    ],
    now,
  );

  // The part of the figure a repeat can finish (#503), next to the counts it
  // is a part of: two of the four due cards, and not the one due tomorrow.
  it("carries the learnable count beside the due counts it belongs to", () => {
    expect(dueSummaryResponse(aggregate, now, null)).toEqual({
      overdue: 2,
      learning: 1,
      relearning: 1,
      newCards: 1,
      review: 3,
      totalDue: 4,
      learnableCards: 2,
      serverTime: now.toISOString(),
    });
  });

  it("says when the next portion opens only when one is not open now", () => {
    const opensAt = new Date(now.getTime() + 3 * 60 * 60 * 1_000);

    expect(dueSummaryResponse(aggregate, now, opensAt)).toMatchObject({
      nextPortionAt: opensAt.toISOString(),
    });
    expect(dueSummaryResponse(aggregate, now, null)).not.toHaveProperty(
      "nextPortionAt",
    );
  });
});
