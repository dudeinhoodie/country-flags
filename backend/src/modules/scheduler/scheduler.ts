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
  /// The rung of the learning or relearning ladder the card stands on — the
  /// index ts-fsrs keeps in `learning_steps`. It is state, not a derived
  /// value: two rungs of `["3h", "3h", "1d"]` are three hours apart alike, so
  /// neither the due date nor the stage can tell the scheduler which one the
  /// card is on, and without it `GOOD` never leaves `LEARNING` (ADR-026).
  learningStep: number;
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
