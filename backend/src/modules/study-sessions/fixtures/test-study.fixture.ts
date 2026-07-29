import {
  AnswerMode,
  CardLearningState,
  SchedulerAlgorithm,
  SchedulerDefinitionStatus,
  UserStatus,
} from "@prisma/client";

export const TEST_STUDY_USER_ID = "80000000-0000-4000-8000-000000000001";
export const TEST_SCHEDULER_VERSION = "test-fsrs-6-v1";

export const TEST_STUDY_FIXTURE = {
  marker: "TEST_ONLY",
  scheduler: {
    version: TEST_SCHEDULER_VERSION,
    algorithm: SchedulerAlgorithm.FSRS,
    algorithmMajor: 6,
    packageName: "TEST_ONLY",
    packageVersion: "0.0.0",
    parametersVersion: "test-parameters-v1",
    parameters: { marker: "TEST_ONLY" },
    defaultDesiredRetention: 0.9,
    status: SchedulerDefinitionStatus.ACTIVE,
    activeFrom: "2026-07-29T00:00:00.000Z",
  },
  user: {
    id: TEST_STUDY_USER_ID,
    displayName: "Test Learner",
    preferredLocale: "ru",
    status: UserStatus.ACTIVE,
  },
  settings: {
    sessionSize: 5,
    contentLocale: "ru",
    defaultAnswerMode: AnswerMode.SELF_RATED,
    desiredRetention: 0.9,
    timezone: "Europe/Moscow",
  },
  cardStates: [
    {
      contentKey: "country.belgium",
      state: CardLearningState.REVIEW,
      difficulty: 5,
      stability: 10,
      dueAt: "2026-01-01T00:00:00.000Z",
      lastReviewedAt: "2025-12-01T00:00:00.000Z",
      repetitions: 3,
      lapses: 1,
      stateVersion: 3,
    },
    {
      contentKey: "country.france",
      state: CardLearningState.LEARNING,
      difficulty: 6,
      stability: 1,
      dueAt: "2026-01-02T00:00:00.000Z",
      lastReviewedAt: "2026-01-01T00:00:00.000Z",
      repetitions: 1,
      lapses: 0,
      stateVersion: 2,
    },
    {
      contentKey: "country.germany",
      state: CardLearningState.REVIEW,
      difficulty: 4,
      stability: 30,
      dueAt: "2099-01-01T00:00:00.000Z",
      lastReviewedAt: "2026-01-01T00:00:00.000Z",
      repetitions: 5,
      lapses: 0,
      stateVersion: 5,
    },
  ],
} as const;
