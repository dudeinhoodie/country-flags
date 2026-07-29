import type { CardLearningState, ReviewRating } from "@prisma/client";

export interface SchedulerDefinitionData {
  version: string;
  algorithmMajor: number;
  packageName: string;
  packageVersion: string;
  parametersVersion: string;
  parameters: unknown;
  defaultDesiredRetention: number;
}

export interface SchedulerCardState {
  state: CardLearningState;
  difficulty: number;
  stability: number;
  retrievabilityAtReview: number | null;
  dueAt: Date;
  lastReviewedAt: Date | null;
  repetitions: number;
  lapses: number;
  schedulerVersion: string;
  schedulerParametersVersion: string;
}

export interface SchedulerReview {
  rating: ReviewRating;
  occurredAt: Date;
}

export interface Scheduler {
  applyReview(
    previous: SchedulerCardState | null,
    review: SchedulerReview,
    definition: SchedulerDefinitionData,
  ): SchedulerCardState;
}
