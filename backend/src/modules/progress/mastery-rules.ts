import { CardLearningState, MasteryTier } from "@prisma/client";

export const MASTERY_RULE_VERSION = 1;

/**
 * How many correct answers make a country learned.
 *
 * A product decision rather than a property of the scheduler: the scheduler
 * decides when to ask again, this decides when to stop calling the card
 * unlearned on the screens that count them.
 */
export const LEARNED_SUCCESSFUL_REVIEWS = 3;

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
  const touchedCards = cards.filter(
    ({ totalReviews }) => totalReviews > 0,
  ).length;
  // Learned is three correct answers, not the scheduler's own word for it.
  //
  // FSRS graduates a card to REVIEW after its learning steps, and ADR-013
  // puts the first repetition an hour out — so a whole sitting could end
  // with nothing learned, and the screen said the work had not counted.
  // Three correct answers is what a person means by knowing a flag, and it
  // is reachable inside one session.
  //
  // Touched is still not learned, which is the half of #232 that stands: a
  // card answered once is in progress, and the two counts must not name the
  // same card twice. They stay disjoint because "in progress" is derived as
  // touched minus learned rather than from the scheduler's states.
  const learnedCards = cards.filter(
    ({ successfulReviews }) => successfulReviews >= LEARNED_SUCCESSFUL_REVIEWS,
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
