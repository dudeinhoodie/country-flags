import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  AnswerMode,
  CardLearningState,
  PrismaClient,
  ReconciliationJobStatus,
  ReviewRating,
  SchedulerAlgorithm,
  SchedulerDefinitionStatus,
  type ReviewEvent,
  type UserCardState,
} from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { ReconciliationWorker } from "../src/modules/reviews/reconciliation.worker";
import { SchedulerMigrationWorker } from "../src/modules/reviews/scheduler-migration.worker";
import {
  FSRS6_PARAMETERS_V3,
  FSRS_ACTIVE_DEFINITION_VERSION,
  FSRS_PACKAGE_NAME,
  FSRS_PACKAGE_VERSION,
  FSRS_PARAMETERS_VERSION_V3,
  FSRS_PARAMETERS_VERSION_V4,
} from "../src/modules/scheduler/fsrs6-scheduler.adapter";
import {
  TEST_STUDY_DEVICE_ID,
  TEST_STUDY_USER_ID,
} from "../src/modules/study-sessions/fixtures/test-study.fixture";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";
import { bodyOf } from "./response-body";

interface SessionBody {
  cards: Array<{ learningCard: { id: string } }>;
}

interface CardStateBody {
  state: CardLearningState;
  difficulty: number;
  stability: number;
  dueAt: string;
  repetitions: number;
  lapses: number;
  schedulerVersion: string;
  schedulerParametersVersion: string;
  stateVersion: number;
}

interface ReviewBatchBody {
  results: Array<{
    status: "ACCEPTED" | "DUPLICATE" | "REJECTED" | "RECONCILIATION_PENDING";
    cardState: CardStateBody;
  }>;
}

interface GoldenFixture {
  reviews: Array<{
    occurredAt: string;
    expected: {
      state: CardLearningState;
      difficulty: number;
      stability: number;
      dueAt: string;
      repetitions: number;
      lapses: number;
      learningStep: number;
    };
  }>;
}

type StoredReview = Pick<
  ReviewEvent,
  | "id"
  | "payloadHash"
  | "schedulerVersion"
  | "schedulerParametersVersion"
  | "effectiveOccurredAt"
>;

const HOUR_MS = 3_600_000;
const LEGACY_DEFINITION_VERSION = "test-fsrs-6-v3-ladder";

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/// Issue #435: a `GOOD` in LEARNING never graduated a card, because the adapter
/// dropped the learning step between answers. These run the whole path on
/// PostgreSQL — the review endpoint, the stored projection, the scheduler
/// migration worker and its checkpoint — against the definition the committed
/// migrations install.
describe("the learning step survives between answers (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_learning_step_${process.pid}_${Date.now()}`.toLowerCase();
  const sessionId = "a0000000-0000-4000-8000-000000000001";
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let accessToken: string;
  let legacyCardId: string;
  let freshCardId: string;
  let clientSequence = 0;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for scheduler integration tests",
      );
    }
    admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const testDatabaseUrl = databaseUrlFor(baseUrl, databaseName);
    const prismaCli = require.resolve("prisma/build/index.js");
    const migration = spawnSync(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        resolve(__dirname, "../prisma/schema.prisma"),
      ],
      {
        cwd: resolve(__dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: testDatabaseUrl,
          // The schema's directUrl drives `migrate deploy`; without this the
          // migrations would land on the ambient database, not this test's.
          DIRECT_DATABASE_URL: testDatabaseUrl,
        },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Scheduler test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.NODE_ENV = "test";
    process.env.TEST_AUTH_ENABLED = "true";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix("v1");
    await expressApp.init();
    app = expressApp;
    database = app.get(PrismaService);
    httpServer = app.getHttpServer() as Server;
    accessToken = app.get(TestJwtSigner).sign(TEST_STUDY_USER_ID);

    await importTestContent(database);
    await importTestStudySeed(database);

    const session = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: sessionId,
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 10,
        mode: AnswerMode.SELF_RATED,
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const seeded = new Set(
      (
        await database.userCardState.findMany({
          where: { userId: TEST_STUDY_USER_ID },
          select: { learningCardId: true },
        })
      ).map(({ learningCardId }) => learningCardId),
    );
    const newCards = bodyOf<SessionBody>(session)
      .cards.map(({ learningCard }) => learningCard.id)
      .filter((id) => !seeded.has(id));
    if (newCards.length < 2) {
      throw new Error("Scheduler test session has fewer than two new cards");
    }
    [legacyCardId, freshCardId] = newCards as [string, string];
    // The seed writes card states with no review behind them. A scheduler
    // migration replays history, and a state without any cannot be replayed,
    // so they would fail the run this suite asserts completes.
    await database.userCardState.deleteMany({
      where: { userId: TEST_STUDY_USER_ID },
    });
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.NODE_ENV = originalNodeEnvironment;
    process.env.TEST_AUTH_ENABLED = originalTestAuthEnabled;
    await app?.close();
    if (admin !== undefined) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
  });

  async function activate(version: string): Promise<void> {
    await database.schedulerDefinition.updateMany({
      where: { status: SchedulerDefinitionStatus.ACTIVE },
      data: { status: SchedulerDefinitionStatus.RETIRED },
    });
    await database.schedulerDefinition.update({
      where: { version },
      data: { status: SchedulerDefinitionStatus.ACTIVE },
    });
  }

  async function answerGood(
    learningCardId: string,
    occurredAt: number,
  ): Promise<ReviewBatchBody["results"][number]> {
    clientSequence += 1;
    const previous = await database.userCardState.findUnique({
      where: {
        userId_learningCardId: { userId: TEST_STUDY_USER_ID, learningCardId },
      },
      select: { stateVersion: true },
    });
    const at = new Date(occurredAt).toISOString();
    const response = await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        payloadVersion: 1,
        events: [
          {
            id: `a1000000-0000-4000-8000-${String(clientSequence).padStart(12, "0")}`,
            sessionId,
            learningCardId,
            deviceId: TEST_STUDY_DEVICE_ID,
            answerMode: AnswerMode.SELF_RATED,
            rating: ReviewRating.GOOD,
            responseTimeMs: 1500,
            clientOccurredAt: at,
            estimatedServerOccurredAt: at,
            clientSequence,
            baseStateVersion: previous?.stateVersion ?? null,
          },
        ],
      })
      .expect(200);
    const result = bodyOf<ReviewBatchBody>(response).results[0];
    if (result === undefined) {
      throw new Error("The review batch answered no result");
    }
    return result;
  }

  function storedState(learningCardId: string): Promise<UserCardState> {
    return database.userCardState.findUniqueOrThrow({
      where: {
        userId_learningCardId: { userId: TEST_STUDY_USER_ID, learningCardId },
      },
    });
  }

  function storedHistory(learningCardId: string): Promise<StoredReview[]> {
    return database.reviewEvent.findMany({
      where: { userId: TEST_STUDY_USER_ID, learningCardId },
      orderBy: { clientSequence: "asc" },
      select: {
        id: true,
        payloadHash: true,
        schedulerVersion: true,
        schedulerParametersVersion: true,
        effectiveOccurredAt: true,
      },
    });
  }

  /// The workers also poll on their own, so this drives them until the run
  /// says it is finished rather than assuming one drain is enough.
  async function settleSchedulerMigration(target: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await app.get(SchedulerMigrationWorker).drain();
      await app.get(ReconciliationWorker).drain();
      const run = await database.schedulerMigrationRun.findUnique({
        where: { targetSchedulerVersion: target },
      });
      if (run?.status === ReconciliationJobStatus.COMPLETED) return;
      if (run?.status === ReconciliationJobStatus.FAILED) {
        throw new Error(`Scheduler migration to ${target} failed`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new Error(`Scheduler migration to ${target} did not complete`);
  }

  it("migrates history accepted under v3 with its step, and graduates it on the next GOOD", async () => {
    await database.schedulerDefinition.updateMany({
      where: { status: SchedulerDefinitionStatus.ACTIVE },
      data: { status: SchedulerDefinitionStatus.RETIRED },
    });
    await database.schedulerDefinition.create({
      data: {
        version: LEGACY_DEFINITION_VERSION,
        algorithm: SchedulerAlgorithm.FSRS,
        algorithmMajor: 6,
        packageName: FSRS_PACKAGE_NAME,
        packageVersion: FSRS_PACKAGE_VERSION,
        parametersVersion: FSRS_PARAMETERS_VERSION_V3,
        parameters: FSRS6_PARAMETERS_V3,
        defaultDesiredRetention: 0.9,
        status: SchedulerDefinitionStatus.ACTIVE,
        activeFrom: new Date("2025-03-01T00:00:00.000Z"),
      },
    });

    // The defect as it was scheduled: three `GOOD` answers, three hours
    // apart, and the card still in LEARNING three hours out. Replay must
    // keep producing exactly this for reviews stamped with v3.
    let occurredAt = Date.parse("2025-03-03T00:00:00.000Z");
    for (let answer = 0; answer < 3; answer += 1) {
      const result = await answerGood(legacyCardId, occurredAt);
      expect(result).toMatchObject({
        status: "ACCEPTED",
        cardState: {
          state: CardLearningState.LEARNING,
          schedulerVersion: LEGACY_DEFINITION_VERSION,
        },
      });
      const dueAt = Date.parse(result.cardState.dueAt);
      expect(dueAt - occurredAt).toBe(3 * HOUR_MS);
      occurredAt = dueAt;
    }
    const stuck = await storedState(legacyCardId);
    expect(stuck).toMatchObject({
      state: CardLearningState.LEARNING,
      learningStep: 1,
      stateVersion: 3,
      schedulerVersion: LEGACY_DEFINITION_VERSION,
    });
    const historyBefore = await storedHistory(legacyCardId);
    const cutoffEvent = historyBefore.at(-1);

    await activate(FSRS_ACTIVE_DEFINITION_VERSION);
    await settleSchedulerMigration(FSRS_ACTIVE_DEFINITION_VERSION);

    const migrated = await storedState(legacyCardId);
    expect(migrated).toMatchObject({
      state: CardLearningState.LEARNING,
      learningStep: 1,
      stateVersion: 3,
      dueAt: stuck.dueAt,
      schedulerVersion: FSRS_ACTIVE_DEFINITION_VERSION,
      schedulerParametersVersion: FSRS_PARAMETERS_VERSION_V4,
    });
    const checkpoint =
      await database.schedulerMigrationCheckpoint.findUniqueOrThrow({
        where: {
          userId_learningCardId_toSchedulerVersion: {
            userId: TEST_STUDY_USER_ID,
            learningCardId: legacyCardId,
            toSchedulerVersion: FSRS_ACTIVE_DEFINITION_VERSION,
          },
        },
      });
    expect(checkpoint).toMatchObject({
      fromSchedulerVersion: LEGACY_DEFINITION_VERSION,
      cutoffEventId: cutoffEvent?.id,
      cutoffEffectiveOccurredAt: cutoffEvent?.effectiveOccurredAt,
    });
    expect(checkpoint.migratedState).toMatchObject({
      state: CardLearningState.LEARNING,
      learningStep: 1,
      schedulerVersion: FSRS_ACTIVE_DEFINITION_VERSION,
      schedulerParametersVersion: FSRS_PARAMETERS_VERSION_V4,
    });
    expect(checkpoint.stateChecksum).toMatch(/^[0-9a-f]{64}$/);
    // Immutable history: the migration relabels the projection, never the
    // reviews it was replayed from.
    await expect(storedHistory(legacyCardId)).resolves.toEqual(historyBefore);

    const graduated = await answerGood(legacyCardId, occurredAt);
    expect(graduated).toMatchObject({
      status: "ACCEPTED",
      cardState: {
        state: CardLearningState.REVIEW,
        stateVersion: 4,
        schedulerVersion: FSRS_ACTIVE_DEFINITION_VERSION,
      },
    });
    expect(Date.parse(graduated.cardState.dueAt) - occurredAt).toBe(
      24 * HOUR_MS,
    );
    await expect(storedState(legacyCardId)).resolves.toMatchObject({
      state: CardLearningState.REVIEW,
      learningStep: 2,
    });
  });

  it("graduates a new card on its second GOOD and grows the interval after", async () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          "../../contracts/fixtures/scheduler/fsrs-6-default-v4.json",
        ),
        "utf8",
      ),
    ) as GoldenFixture;
    // Starting at midnight, like the fixture, keeps every answer on the same
    // UTC day offsets, which is what ts-fsrs counts elapsed time in. Five
    // answers stay in the past, so none of them is clamped to the clock.
    let occurredAt = Date.parse("2025-05-05T00:00:00.000Z");
    for (const review of fixture.reviews.slice(0, 5)) {
      const result = await answerGood(freshCardId, occurredAt);
      expect(result).toMatchObject({
        status: "ACCEPTED",
        cardState: {
          state: review.expected.state,
          repetitions: review.expected.repetitions,
          lapses: review.expected.lapses,
          schedulerVersion: FSRS_ACTIVE_DEFINITION_VERSION,
          schedulerParametersVersion: FSRS_PARAMETERS_VERSION_V4,
        },
      });
      expect(result.cardState.difficulty).toBeCloseTo(
        review.expected.difficulty,
        6,
      );
      expect(result.cardState.stability).toBeCloseTo(
        review.expected.stability,
        6,
      );
      const dueAt = Date.parse(result.cardState.dueAt);
      expect(dueAt - occurredAt).toBe(
        Date.parse(review.expected.dueAt) - Date.parse(review.occurredAt),
      );
      await expect(storedState(freshCardId)).resolves.toMatchObject({
        learningStep: review.expected.learningStep,
      });
      occurredAt = dueAt;
    }
    const hoursOut = fixture.reviews
      .slice(0, 5)
      .map(
        ({ occurredAt: at, expected }) =>
          (Date.parse(expected.dueAt) - Date.parse(at)) / HOUR_MS,
      );
    expect(hoursOut).toEqual([3, 24, 168, 768, 2832]);
  });
});
