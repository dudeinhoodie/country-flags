import { ReviewRating } from "@prisma/client";

import { MAX_FUTURE_SKEW_MS } from "../reviews/review-ordering";

export interface SummaryReviewEvent {
  learningCardId: string;
  rating: ReviewRating;
  isCorrect: boolean;
}

// A type alias, not an interface: Prisma's InputJsonObject requires the
// implicit index signature that only aliases carry.
export type StudySessionSummary = {
  uniqueCardCount: number;
  reviewCount: number;
  correctCount: number;
  incorrectCount: number;
  durationSeconds: number;
  ratings: {
    again: number;
    hard: number;
    good: number;
    easy: number;
  };
};

/**
 * Bounds the client-reported completion instant. The tolerated forward skew
 * matches review time normalization; beyond it the server receive time wins,
 * and completion is never reported before the session started. A skewed device
 * clock must not produce a negative or inflated canonical duration.
 */
export function effectiveCompletedAt(input: {
  clientCompletedAt: Date;
  startedAt: Date;
  receivedAt: Date;
}): Date {
  const tolerated = input.receivedAt.getTime() + MAX_FUTURE_SKEW_MS;
  const effective =
    input.clientCompletedAt.getTime() > tolerated
      ? input.receivedAt.getTime()
      : input.clientCompletedAt.getTime();
  return new Date(Math.max(effective, input.startedAt.getTime()));
}

export function buildSessionSummary(input: {
  events: readonly SummaryReviewEvent[];
  startedAt: Date;
  completedAt: Date;
}): StudySessionSummary {
  const ratings = { again: 0, hard: 0, good: 0, easy: 0 };
  const cardIds = new Set<string>();
  let correctCount = 0;

  for (const event of input.events) {
    cardIds.add(event.learningCardId);
    if (event.isCorrect) {
      correctCount += 1;
    }
    switch (event.rating) {
      case ReviewRating.AGAIN:
        ratings.again += 1;
        break;
      case ReviewRating.HARD:
        ratings.hard += 1;
        break;
      case ReviewRating.GOOD:
        ratings.good += 1;
        break;
      case ReviewRating.EASY:
        ratings.easy += 1;
        break;
    }
  }

  return {
    uniqueCardCount: cardIds.size,
    reviewCount: input.events.length,
    correctCount,
    incorrectCount: input.events.length - correctCount,
    durationSeconds: Math.max(
      0,
      Math.floor(
        (input.completedAt.getTime() - input.startedAt.getTime()) / 1_000,
      ),
    ),
    ratings,
  };
}
