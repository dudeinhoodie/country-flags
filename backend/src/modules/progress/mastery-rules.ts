import { CardLearningState, MasteryTier } from "@prisma/client";

export const MASTERY_RULE_VERSION = 1;

export interface MasteryThreshold {
  tier: Exclude<MasteryTier, "NONE">;
  coverage: number;
  successfulReviewsPerCard: number;
  accuracy30Days: number;
  minimumSuccessfulReviews: number;
  maximumOverdueRatio: number;
}

export const MASTERY_THRESHOLDS: readonly MasteryThreshold[] = [
  {
    tier: MasteryTier.BRONZE,
    coverage: 0.5,
    successfulReviewsPerCard: 1,
    accuracy30Days: 0.7,
    minimumSuccessfulReviews: 5,
    maximumOverdueRatio: 1,
  },
  {
    tier: MasteryTier.SILVER,
    coverage: 0.75,
    successfulReviewsPerCard: 2,
    accuracy30Days: 0.8,
    minimumSuccessfulReviews: 10,
    maximumOverdueRatio: 1,
  },
  {
    tier: MasteryTier.GOLD,
    coverage: 0.9,
    successfulReviewsPerCard: 2,
    accuracy30Days: 0.9,
    minimumSuccessfulReviews: 20,
    maximumOverdueRatio: 1,
  },
  {
    tier: MasteryTier.PLATINUM,
    coverage: 1,
    successfulReviewsPerCard: 3,
    accuracy30Days: 0.95,
    minimumSuccessfulReviews: 30,
    maximumOverdueRatio: 0.1,
  },
];

export interface ProgressCardMetrics {
  learningCardId: string;
  state: CardLearningState | null;
  dueAt: Date | null;
  successfulReviews: number;
  totalReviews: number;
  recentSuccessfulReviews: number;
  recentReviews: number;
}

export interface ProgressAggregate {
  totalCards: number;
  learnedCards: number;
  dueCards: number;
  overdueCards: number;
  dueLearningCards: number;
  dueRelearningCards: number;
  newCards: number;
  learningCards: number;
  relearningCards: number;
  reviewCards: number;
  successfulReviews: number;
  reviewCount: number;
  accuracy30Days: number;
  currentMasteryTier: MasteryTier;
  ruleVersion: number;
}

export function masteryTierRank(tier: MasteryTier): number {
  return [
    MasteryTier.NONE,
    MasteryTier.BRONZE,
    MasteryTier.SILVER,
    MasteryTier.GOLD,
    MasteryTier.PLATINUM,
  ].indexOf(tier);
}

export function aggregateProgress(
  cards: ProgressCardMetrics[],
  now: Date,
  thresholds: readonly MasteryThreshold[] = MASTERY_THRESHOLDS,
  ruleVersion = MASTERY_RULE_VERSION,
): ProgressAggregate {
  const totalCards = cards.length;
  // Touched is not learned: a card is learned once it graduates to REVIEW,
  // which is what the schedulers mean by it and what a person means by the
  // word. Counting any touched card here made "learned" and "in progress"
  // the same set until the first graduations, and the home tally showed one
  // number twice.
  const touchedCards = cards.filter(
    ({ totalReviews }) => totalReviews > 0,
  ).length;
  const learnedCards = cards.filter(
    ({ state }) => state === CardLearningState.REVIEW,
  ).length;
  const isDue = ({ dueAt, totalReviews }: ProgressCardMetrics): boolean =>
    totalReviews > 0 && dueAt !== null && dueAt.getTime() <= now.getTime();
  const overdueCards = cards.filter(
    (card) => card.state === CardLearningState.REVIEW && isDue(card),
  ).length;
  const dueLearningCards = cards.filter(
    (card) => card.state === CardLearningState.LEARNING && isDue(card),
  ).length;
  const dueRelearningCards = cards.filter(
    (card) => card.state === CardLearningState.RELEARNING && isDue(card),
  ).length;
  const dueCards = overdueCards + dueLearningCards + dueRelearningCards;
  // New is what was never touched — a card mid-learning is neither new nor
  // learned, and both splits have to say so.
  const newCards = totalCards - touchedCards;
  const learningCards = cards.filter(
    ({ state }) => state === CardLearningState.LEARNING,
  ).length;
  const relearningCards = cards.filter(
    ({ state }) => state === CardLearningState.RELEARNING,
  ).length;
  const reviewCards = cards.filter(
    ({ state }) => state === CardLearningState.REVIEW,
  ).length;
  const successfulReviews = cards.reduce(
    (total, card) => total + card.successfulReviews,
    0,
  );
  const reviewCount = cards.reduce(
    (total, card) => total + card.totalReviews,
    0,
  );
  const recentSuccessfulReviews = cards.reduce(
    (total, card) => total + card.recentSuccessfulReviews,
    0,
  );
  const recentReviews = cards.reduce(
    (total, card) => total + card.recentReviews,
    0,
  );
  const accuracy30Days =
    recentReviews === 0 ? 0 : recentSuccessfulReviews / recentReviews;
  const overdueRatio = totalCards === 0 ? 0 : dueCards / totalCards;

  let currentMasteryTier: MasteryTier = MasteryTier.NONE;
  for (const threshold of thresholds) {
    const qualifyingCards = cards.filter(
      ({ successfulReviews: successes }) =>
        successes >= threshold.successfulReviewsPerCard,
    ).length;
    const coverage = totalCards === 0 ? 0 : qualifyingCards / totalCards;
    if (
      coverage >= threshold.coverage &&
      successfulReviews >= threshold.minimumSuccessfulReviews &&
      accuracy30Days >= threshold.accuracy30Days &&
      overdueRatio <= threshold.maximumOverdueRatio
    ) {
      currentMasteryTier = threshold.tier;
    }
  }

  return {
    totalCards,
    learnedCards,
    dueCards,
    overdueCards,
    dueLearningCards,
    dueRelearningCards,
    newCards,
    learningCards,
    relearningCards,
    reviewCards,
    successfulReviews,
    reviewCount,
    accuracy30Days,
    currentMasteryTier,
    ruleVersion,
  };
}
