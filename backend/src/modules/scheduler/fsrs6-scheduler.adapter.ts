import { Injectable } from "@nestjs/common";
import { CardLearningState, ReviewRating } from "@prisma/client";

import {
  type Scheduler,
  type SchedulerCardState,
  type SchedulerDefinitionData,
  type SchedulerReview,
} from "./scheduler";

export const FSRS_PACKAGE_NAME = "ts-fsrs";
export const FSRS_PACKAGE_VERSION = "5.4.1";
export const FSRS_ALGORITHM_MAJOR = 6;
/// The parameters every review before 2026-08-21 was scheduled with. Kept
/// because history is replayed with the definition it was accepted under: a
/// card answered under v1 keeps its v1 timings until it is answered again.
export const FSRS_PARAMETERS_VERSION = "fsrs-6-default-21-v1";
export const FSRS_PARAMETERS_VERSION_V2 = "fsrs-6-default-21-v2";
/// The definition row the migration installs. Named by the day it became
/// active, because that is the question anybody debugging a due date asks.
export const FSRS_ACTIVE_DEFINITION_VERSION = "fsrs-6-2026-08-21";

type FsrsState = 0 | 1 | 2 | 3;
type FsrsRating = 1 | 2 | 3 | 4;

interface FsrsCard {
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: FsrsState;
  last_review?: Date;
}

interface FsrsInstance {
  next(card: FsrsCard, now: Date, rating: FsrsRating): { card: FsrsCard };
  get_retrievability(card: FsrsCard, now: Date, format: false): number;
}

interface TsFsrsRuntime {
  createEmptyCard(now: Date): FsrsCard;
  fsrs(parameters: Record<string, unknown>): FsrsInstance;
}

// ts-fsrs 5.4.1 ships both CJS and ESM, but publishes its `types` export after
// `default`. Node16 TypeScript therefore resolves the ESM declaration for this
// CommonJS backend even though Node correctly loads the CJS entrypoint.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsFsrsRuntime = require("ts-fsrs") as TsFsrsRuntime;
const createEmptyCard = (now: Date): FsrsCard =>
  tsFsrsRuntime.createEmptyCard(now);
const fsrs = (parameters: Record<string, unknown>): FsrsInstance =>
  tsFsrsRuntime.fsrs(parameters);

export const FSRS6_DEFAULT_PARAMETERS = {
  request_retention: 0.9,
  maximum_interval: 36_500,
  w: [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
    0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
    0.0912, 0.0658, 0.1542,
  ],
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
} as const;

/// The same algorithm and the same weights, with a slower ladder at the start.
///
/// A card used to come back a minute after "again" and ten minutes after that,
/// which is not a review: the answer is still in the reader's head, getting it
/// right proves nothing, and the queue refills as fast as it drains. The steps
/// are an hour, three hours and a day now, so the first real recall attempt
/// happens after the answer has had a chance to fade. Everything else — the
/// weights, the retention target, the fuzz — is untouched, so this changes when
/// a card is asked, not how the algorithm thinks.
///
/// A lapse follows the same floor: a forgotten card comes back in an hour
/// rather than ten minutes.
export const FSRS6_PARAMETERS_V2 = {
  ...FSRS6_DEFAULT_PARAMETERS,
  learning_steps: ["1h", "3h", "1d"],
  relearning_steps: ["1h"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberArray(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 21 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new Error(`${field} must contain 21 finite FSRS-6 weights`);
  }
  return value.map((item) => Number(item));
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be a string array`);
  }
  return value.map((item) => String(item));
}

function schedulerFor(definition: SchedulerDefinitionData): FsrsInstance {
  if (
    definition.algorithmMajor !== FSRS_ALGORITHM_MAJOR ||
    definition.packageName !== FSRS_PACKAGE_NAME ||
    definition.packageVersion !== FSRS_PACKAGE_VERSION
  ) {
    throw new Error(
      `Unsupported scheduler definition ${definition.version}: ` +
        `${definition.packageName}@${definition.packageVersion}/FSRS-${definition.algorithmMajor}`,
    );
  }
  if (!isRecord(definition.parameters)) {
    throw new Error(
      `Scheduler ${definition.version} parameters must be an object`,
    );
  }
  const parameters = definition.parameters;
  const maximumInterval = parameters.maximum_interval;
  const enableFuzz = parameters.enable_fuzz;
  const enableShortTerm = parameters.enable_short_term;
  if (
    typeof maximumInterval !== "number" ||
    !Number.isInteger(maximumInterval) ||
    maximumInterval < 1 ||
    typeof enableFuzz !== "boolean" ||
    typeof enableShortTerm !== "boolean"
  ) {
    throw new Error(`Scheduler ${definition.version} parameters are invalid`);
  }

  return fsrs({
    request_retention: definition.defaultDesiredRetention,
    maximum_interval: maximumInterval,
    w: numberArray(parameters.w, "parameters.w"),
    enable_fuzz: enableFuzz,
    enable_short_term: enableShortTerm,
    learning_steps: stringArray(
      parameters.learning_steps,
      "parameters.learning_steps",
    ),
    relearning_steps: stringArray(
      parameters.relearning_steps,
      "parameters.relearning_steps",
    ),
  });
}

function fsrsState(state: CardLearningState): FsrsState {
  const states: Record<CardLearningState, FsrsState> = {
    NEW: 0,
    LEARNING: 1,
    REVIEW: 2,
    RELEARNING: 3,
  };
  return states[state];
}

function domainState(state: FsrsState): CardLearningState {
  const states: Record<FsrsState, CardLearningState> = {
    0: CardLearningState.NEW,
    1: CardLearningState.LEARNING,
    2: CardLearningState.REVIEW,
    3: CardLearningState.RELEARNING,
  };
  return states[state];
}

function fsrsRating(rating: ReviewRating): FsrsRating {
  const ratings: Record<ReviewRating, FsrsRating> = {
    AGAIN: 1,
    HARD: 2,
    GOOD: 3,
    EASY: 4,
  };
  return ratings[rating];
}

function round(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}

function toFsrsCard(previous: SchedulerCardState | null, now: Date): FsrsCard {
  if (previous === null) {
    return createEmptyCard(now);
  }
  const scheduledDays =
    previous.lastReviewedAt === null
      ? 0
      : Math.max(
          0,
          Math.round(
            (previous.dueAt.getTime() - previous.lastReviewedAt.getTime()) /
              86_400_000,
          ),
        );

  return {
    due: previous.dueAt,
    stability: previous.stability,
    difficulty: previous.difficulty,
    elapsed_days: 0,
    scheduled_days: scheduledDays,
    learning_steps: 0,
    reps: previous.repetitions,
    lapses: previous.lapses,
    state: fsrsState(previous.state),
    ...(previous.lastReviewedAt === null
      ? {}
      : { last_review: previous.lastReviewedAt }),
  };
}

@Injectable()
export class Fsrs6SchedulerAdapter implements Scheduler {
  applyReview(
    previous: SchedulerCardState | null,
    review: SchedulerReview,
    definition: SchedulerDefinitionData,
  ): SchedulerCardState {
    const scheduler = schedulerFor(definition);
    const card = toFsrsCard(previous, review.occurredAt);
    const retrievability =
      previous === null || previous.state === CardLearningState.NEW
        ? null
        : scheduler.get_retrievability(card, review.occurredAt, false);
    const next = scheduler.next(
      card,
      review.occurredAt,
      fsrsRating(review.rating),
    ).card;

    return {
      state: domainState(next.state),
      difficulty: round(next.difficulty, 6),
      stability: round(next.stability, 6),
      retrievabilityAtReview:
        retrievability === null ? null : round(retrievability, 6),
      dueAt: next.due,
      lastReviewedAt: next.last_review ?? review.occurredAt,
      repetitions: next.reps,
      lapses: next.lapses,
      schedulerVersion: definition.version,
      schedulerParametersVersion: definition.parametersVersion,
    };
  }
}
