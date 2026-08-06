import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  AnswerMode,
  PrismaClient,
  ReviewRating,
  SchedulerAlgorithm,
  SchedulerDefinitionStatus,
} from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { ReconciliationWorker } from "../src/modules/reviews/reconciliation.worker";
import {
  FSRS6_DEFAULT_PARAMETERS,
  FSRS_PACKAGE_NAME,
  FSRS_PACKAGE_VERSION,
} from "../src/modules/scheduler/fsrs6-scheduler.adapter";
import {
  TEST_STUDY_DEVICE_ID,
  TEST_STUDY_USER_ID,
} from "../src/modules/study-sessions/fixtures/test-study.fixture";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";

interface SessionBody {
  cards: Array<{
    id: string;
    learningCard: { id: string };
    options?: Array<{ id: string; position: number; displayName: string }>;
  }>;
}

interface ReviewStateBody {
  learningCardId: string;
  stateVersion: number;
  schedulerVersion: string;
  dueAt: string;
}

interface ReviewBatchBody {
  results: Array<{
    eventId: string;
    status: "ACCEPTED" | "DUPLICATE" | "REJECTED" | "RECONCILIATION_PENDING";
    rejectionCode: string | null;
    canonicalRating: ReviewRating | null;
    isCorrect: boolean | null;
    correctOptionId: string | null;
    cardState: ReviewStateBody | null;
  }>;
  serverTime: string;
  nextSyncCursor: string;
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

describe("immutable review ingestion and FSRS projection (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_reviews_${process.pid}_${Date.now()}`.toLowerCase();
  const sessionId = "91000000-0000-4000-8000-000000000001";
  const eventId = "92000000-0000-4000-8000-000000000001";
  let testDatabaseUrl: string;
  let learningCardId: string;
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let accessToken: string;

  async function startApplication(): Promise<void> {
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
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for review integration tests");
    }
    admin = new PrismaClient({
      datasources: { db: { url: baseUrl } },
    });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    testDatabaseUrl = databaseUrlFor(baseUrl, databaseName);
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
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Review test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.NODE_ENV = "test";
    process.env.TEST_AUTH_ENABLED = "true";
    await startApplication();
    await importTestContent(database);
    await importTestStudySeed(database);

    const session = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: sessionId,
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 20,
        mode: AnswerMode.SELF_RATED,
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const body = session.body as unknown as SessionBody;
    const cardWithoutState = await Promise.all(
      body.cards.map(async ({ learningCard }) => ({
        id: learningCard.id,
        state: await database.userCardState.findUnique({
          where: {
            userId_learningCardId: {
              userId: TEST_STUDY_USER_ID,
              learningCardId: learningCard.id,
            },
          },
        }),
      })),
    );
    const selected = cardWithoutState.find(({ state }) => state === null);
    if (selected === undefined) {
      throw new Error("Review test session has no new card");
    }
    learningCardId = selected.id;
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

  function selfRatedEvent(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: eventId,
      sessionId,
      learningCardId,
      deviceId: TEST_STUDY_DEVICE_ID,
      answerMode: AnswerMode.SELF_RATED,
      rating: ReviewRating.GOOD,
      responseTimeMs: 4200,
      clientOccurredAt: "2026-07-29T10:00:00.000Z",
      estimatedServerOccurredAt: "2026-07-29T10:00:00.000Z",
      clientSequence: 1,
      baseStateVersion: 0,
      ...overrides,
    };
  }

  async function sendEvent(
    event: Record<string, unknown>,
  ): Promise<ReviewBatchBody> {
    const response = await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ payloadVersion: 1, events: [event] })
      .expect(200);
    return response.body as unknown as ReviewBatchBody;
  }

  it("atomically persists immutable event, projection and outbox", async () => {
    const initialChangesResponse = await request(httpServer)
      .get("/v1/me/changes")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const initialChanges = initialChangesResponse.body as unknown as {
      nextCursor: string;
    };
    const body = await sendEvent(selfRatedEvent());

    expect(body.results[0]).toMatchObject({
      eventId,
      status: "ACCEPTED",
      canonicalRating: ReviewRating.GOOD,
      isCorrect: true,
      cardState: {
        learningCardId,
        stateVersion: 1,
      },
    });
    expect(body.nextSyncCursor).not.toBe("");
    await expect(
      database.reviewEvent.count({
        where: { userId: TEST_STUDY_USER_ID, learningCardId },
      }),
    ).resolves.toBe(1);
    await expect(
      database.learningOutboxEvent.count({
        where: { userId: TEST_STUDY_USER_ID, learningCardId },
      }),
    ).resolves.toBe(1);
    const changesUrl = `/v1/me/changes?after=${encodeURIComponent(
      initialChanges.nextCursor,
    )}`;
    const firstChanges = await request(httpServer)
      .get(changesUrl)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(firstChanges.body).toMatchObject({
      items: [
        {
          operation: "UPSERT",
          resourceType: "CARD_STATE",
          resourceId: learningCardId,
          payload: { learningCardId, stateVersion: 1 },
        },
      ],
      hasMore: false,
      nextCursor: body.nextSyncCursor,
    });
    const repeatedChanges = await request(httpServer)
      .get(changesUrl)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(repeatedChanges.body).toEqual(firstChanges.body);
  });

  it("returns the saved result for duplicate and rejects payload reuse", async () => {
    const before = await database.userCardState.findUniqueOrThrow({
      where: {
        userId_learningCardId: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
      },
    });
    const duplicate = await sendEvent(selfRatedEvent());
    expect(duplicate.results[0]).toMatchObject({
      eventId,
      status: "DUPLICATE",
      cardState: { stateVersion: 1 },
    });
    await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        payloadVersion: 1,
        events: [selfRatedEvent({ rating: ReviewRating.EASY })],
      })
      .expect(409);
    const after = await database.userCardState.findUniqueOrThrow({
      where: {
        userId_learningCardId: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
      },
    });
    expect(after).toEqual(before);
    await expect(
      database.learningOutboxEvent.count({
        where: { userId: TEST_STUDY_USER_ID, learningCardId },
      }),
    ).resolves.toBe(1);
  });

  it("replays a late predecessor deterministically and survives restart", async () => {
    const sequenceThree = await sendEvent(
      selfRatedEvent({
        id: "92000000-0000-4000-8000-000000000003",
        rating: ReviewRating.EASY,
        clientSequence: 3,
        clientOccurredAt: "2026-07-29T10:03:00.000Z",
        estimatedServerOccurredAt: "2026-07-29T10:03:00.000Z",
        baseStateVersion: 1,
      }),
    );
    expect(sequenceThree.results[0]?.status).toBe("ACCEPTED");
    const late = await sendEvent(
      selfRatedEvent({
        id: "92000000-0000-4000-8000-000000000002",
        rating: ReviewRating.AGAIN,
        clientSequence: 2,
        clientOccurredAt: "2026-07-29T10:02:00.000Z",
        estimatedServerOccurredAt: "2026-07-29T10:02:00.000Z",
        baseStateVersion: 1,
      }),
    );
    const replayedState = late.results[0]?.cardState;
    expect(late.results[0]).toMatchObject({
      status: "ACCEPTED",
      cardState: { stateVersion: 3 },
    });

    await app.close();
    await startApplication();
    const duplicateAfterRestart = await sendEvent(
      selfRatedEvent({
        id: "92000000-0000-4000-8000-000000000002",
        rating: ReviewRating.AGAIN,
        clientSequence: 2,
        clientOccurredAt: "2026-07-29T10:02:00.000Z",
        estimatedServerOccurredAt: "2026-07-29T10:02:00.000Z",
        baseStateVersion: 1,
      }),
    );
    expect(duplicateAfterRestart.results[0]?.cardState).toEqual(replayedState);
  });

  it("serializes concurrent submissions for the same card", async () => {
    const secondDeviceId = "81000000-0000-4000-8000-000000000002";
    await database.device.create({
      data: {
        id: secondDeviceId,
        userId: TEST_STUDY_USER_ID,
        clientGeneratedId: "TEST_ONLY_SECOND_DEVICE",
        platform: "IOS",
        appVersion: "0.1.0-test",
        locale: "en",
        timezone: "UTC",
      },
    });
    const [first, second] = await Promise.all([
      sendEvent(
        selfRatedEvent({
          id: "92000000-0000-4000-8000-000000000004",
          clientSequence: 4,
          clientOccurredAt: "2026-07-29T10:04:00.000Z",
          estimatedServerOccurredAt: "2026-07-29T10:04:00.000Z",
          baseStateVersion: 3,
        }),
      ),
      sendEvent(
        selfRatedEvent({
          id: "92000000-0000-4000-8000-000000000005",
          deviceId: secondDeviceId,
          clientSequence: 1,
          clientOccurredAt: "2026-07-29T10:04:00.000Z",
          estimatedServerOccurredAt: "2026-07-29T10:04:00.000Z",
          baseStateVersion: 3,
        }),
      ),
    ]);

    expect(first.results[0]?.status).toBe("ACCEPTED");
    expect(second.results[0]?.status).toBe("ACCEPTED");
    const state = await database.userCardState.findUniqueOrThrow({
      where: {
        userId_learningCardId: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
      },
    });
    expect(state.stateVersion).toBe(5);
  });

  it("derives objective grading only from the persisted option snapshot", async () => {
    const objectiveSessionId = "91000000-0000-4000-8000-000000000002";
    const session = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: objectiveSessionId,
        deckId: "70000000-0000-4000-8000-000000000001",
        mode: AnswerMode.MULTIPLE_CHOICE,
        selectionOrigin: "SERVER",
        requestedUniqueCount: 5,
        locale: "en",
      })
      .expect(201);
    const sessionBody = session.body as unknown as SessionBody;
    const objectiveCard = sessionBody.cards[0];
    if (objectiveCard === undefined || objectiveCard.options?.length !== 4) {
      throw new Error("Generated objective session has no complete option set");
    }
    const persistedOptions = await database.studySessionCardOption.findMany({
      where: { studySessionCardId: objectiveCard.id },
      orderBy: { position: "asc" },
    });
    const correctOptionId = persistedOptions.find(
      ({ isCorrect }) => isCorrect,
    )?.id;
    const wrongOptionId = persistedOptions.find(
      ({ isCorrect }) => !isCorrect,
    )?.id;
    if (correctOptionId === undefined || wrongOptionId === undefined) {
      throw new Error("Persisted objective options have invalid correctness");
    }
    const objectiveEvent = (
      id: string,
      selectedOptionId: string,
      clientSequence: number,
    ): Record<string, unknown> => {
      const minute = clientSequence.toString().padStart(2, "0");
      return {
        id,
        sessionId: objectiveSessionId,
        learningCardId: objectiveCard.learningCard.id,
        deviceId: TEST_STUDY_DEVICE_ID,
        answerMode: AnswerMode.MULTIPLE_CHOICE,
        selectedOptionId,
        clientOccurredAt: `2026-07-29T10:${minute}:00.000Z`,
        estimatedServerOccurredAt: `2026-07-29T10:${minute}:00.000Z`,
        clientSequence,
        baseStateVersion: null,
      };
    };

    const outsideSnapshot = await sendEvent(
      objectiveEvent(
        "92000000-0000-4000-8000-000000000009",
        "93000000-0000-4000-8000-000000000099",
        9,
      ),
    );
    expect(outsideSnapshot.results[0]).toMatchObject({
      status: "REJECTED",
      rejectionCode: "OPTION_NOT_IN_SESSION",
      canonicalRating: null,
      isCorrect: null,
    });

    const correct = await sendEvent(
      objectiveEvent(
        "92000000-0000-4000-8000-000000000010",
        correctOptionId,
        10,
      ),
    );
    expect(correct.results[0]).toMatchObject({
      status: "ACCEPTED",
      canonicalRating: ReviewRating.GOOD,
      isCorrect: true,
      correctOptionId,
    });

    await app.close();
    await startApplication();
    const wrong = await sendEvent(
      objectiveEvent("92000000-0000-4000-8000-000000000011", wrongOptionId, 11),
    );
    expect(wrong.results[0]).toMatchObject({
      status: "ACCEPTED",
      canonicalRating: ReviewRating.AGAIN,
      isCorrect: false,
      correctOptionId,
    });
  });

  it("creates an upgrade checkpoint without rewriting immutable history", async () => {
    const previousHashes = await database.reviewEvent.findMany({
      where: { userId: TEST_STUDY_USER_ID, learningCardId },
      orderBy: { id: "asc" },
      select: { id: true, payloadHash: true, schedulerVersion: true },
    });
    await database.schedulerDefinition.update({
      where: { version: "test-fsrs-6-v2" },
      data: { status: SchedulerDefinitionStatus.RETIRED },
    });
    await database.schedulerDefinition.create({
      data: {
        version: "test-fsrs-6-v3",
        algorithm: SchedulerAlgorithm.FSRS,
        algorithmMajor: 6,
        packageName: FSRS_PACKAGE_NAME,
        packageVersion: FSRS_PACKAGE_VERSION,
        parametersVersion: "fsrs-6-default-21-v2",
        parameters: FSRS6_DEFAULT_PARAMETERS,
        defaultDesiredRetention: 0.91,
        status: SchedulerDefinitionStatus.ACTIVE,
        activeFrom: new Date("2026-07-29T12:00:00.000Z"),
      },
    });

    const upgraded = await sendEvent(
      selfRatedEvent({
        id: "92000000-0000-4000-8000-000000000006",
        clientSequence: 5,
        clientOccurredAt: "2026-07-29T10:05:00.000Z",
        estimatedServerOccurredAt: "2026-07-29T10:05:00.000Z",
        baseStateVersion: 5,
      }),
    );
    expect(upgraded.results[0]).toMatchObject({
      status: "ACCEPTED",
      cardState: {
        stateVersion: 6,
        schedulerVersion: "test-fsrs-6-v3",
      },
    });
    await expect(
      database.schedulerMigrationCheckpoint.count({
        where: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
          toSchedulerVersion: "test-fsrs-6-v3",
        },
      }),
    ).resolves.toBe(1);

    const persistedHistory = await database.reviewEvent.findMany({
      where: {
        userId: TEST_STUDY_USER_ID,
        learningCardId,
        id: { in: previousHashes.map(({ id }) => id) },
      },
      orderBy: { id: "asc" },
      select: { id: true, payloadHash: true, schedulerVersion: true },
    });
    expect(persistedHistory).toEqual(previousHashes);
    await expect(
      database.reviewEvent.update({
        where: {
          userId_id: { userId: TEST_STUDY_USER_ID, id: eventId },
        },
        data: { rating: ReviewRating.EASY },
      }),
    ).rejects.toThrow("updates are forbidden for immutable table");
  });

  it("resumes late-event reconciliation from a PostgreSQL checkpoint after restart", async () => {
    const secondDeviceId = "94000000-0000-4000-8000-000000000002";
    await database.device.create({
      data: {
        id: secondDeviceId,
        userId: TEST_STUDY_USER_ID,
        clientGeneratedId: "reviews-reconciliation-device",
        platform: "IOS",
        appVersion: "1.0.0",
        locale: "en",
        timezone: "UTC",
      },
    });
    const stateBefore = await database.userCardState.findUniqueOrThrow({
      where: {
        userId_learningCardId: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
      },
    });
    const lateEventId = "92000000-0000-4000-8000-000000000012";
    const response = await sendEvent(
      selfRatedEvent({
        id: lateEventId,
        deviceId: secondDeviceId,
        clientSequence: 1,
        clientOccurredAt: "2026-07-29T09:00:00.000Z",
        estimatedServerOccurredAt: "2026-07-29T09:00:00.000Z",
        baseStateVersion: stateBefore.stateVersion,
      }),
    );
    expect(response.results[0]).toMatchObject({
      status: "RECONCILIATION_PENDING",
      cardState: { stateVersion: stateBefore.stateVersion },
    });
    await expect(
      database.reviewEvent.count({
        where: { userId: TEST_STUDY_USER_ID, id: lateEventId },
      }),
    ).resolves.toBe(1);

    await app.close();
    await startApplication();
    let completedJobId: string | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const job = await database.reconciliationJob.findFirstOrThrow({
        where: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
        orderBy: { createdAt: "desc" },
      });
      if (job.status === "COMPLETED") {
        completedJobId = job.id;
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    expect(completedJobId).toBeDefined();
    const reconciled = await database.userCardState.findUniqueOrThrow({
      where: {
        userId_learningCardId: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
      },
    });
    expect(reconciled.stateVersion).toBe(stateBefore.stateVersion + 1);
    const reconciledCheckpoint =
      await database.schedulerMigrationCheckpoint.findUniqueOrThrow({
        where: {
          userId_learningCardId_toSchedulerVersion: {
            userId: TEST_STUDY_USER_ID,
            learningCardId,
            toSchedulerVersion: "test-fsrs-6-v3",
          },
        },
        select: { reconciliationVersion: true, lastReconciledAt: true },
      });
    expect(reconciledCheckpoint.reconciliationVersion).toBe(1);
    expect(reconciledCheckpoint.lastReconciledAt).toBeInstanceOf(Date);

    await database.userCardState.delete({
      where: {
        userId_learningCardId: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
      },
    });
    await database.reconciliationJob.create({
      data: {
        userId: TEST_STUDY_USER_ID,
        learningCardId,
        targetSchedulerVersion: "test-fsrs-6-v3",
        reason: "PROJECTION_DRIFT",
      },
    });
    await app.get(ReconciliationWorker).drain();
    const replayed = await database.userCardState.findUniqueOrThrow({
      where: {
        userId_learningCardId: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
      },
    });
    expect(replayed).toMatchObject({
      state: reconciled.state,
      difficulty: reconciled.difficulty,
      stability: reconciled.stability,
      dueAt: reconciled.dueAt,
      stateVersion: reconciled.stateVersion,
      schedulerVersion: reconciled.schedulerVersion,
    });
  });

  it("rolls back a review when an active scheduler definition is unsupported", async () => {
    const stateBefore = await database.userCardState.findUniqueOrThrow({
      where: {
        userId_learningCardId: {
          userId: TEST_STUDY_USER_ID,
          learningCardId,
        },
      },
    });
    const eventCountBefore = await database.reviewEvent.count({
      where: { userId: TEST_STUDY_USER_ID, learningCardId },
    });
    const outboxCountBefore = await database.learningOutboxEvent.count({
      where: { userId: TEST_STUDY_USER_ID, learningCardId },
    });
    await database.schedulerDefinition.update({
      where: { version: "test-fsrs-6-v3" },
      data: { status: SchedulerDefinitionStatus.RETIRED },
    });
    await database.schedulerDefinition.create({
      data: {
        version: "test-fsrs-6-unsupported",
        algorithm: SchedulerAlgorithm.FSRS,
        algorithmMajor: 6,
        packageName: FSRS_PACKAGE_NAME,
        packageVersion: "999.0.0",
        parametersVersion: "unsupported-v1",
        parameters: FSRS6_DEFAULT_PARAMETERS,
        defaultDesiredRetention: 0.9,
        status: SchedulerDefinitionStatus.ACTIVE,
        activeFrom: new Date("2026-07-29T13:00:00.000Z"),
      },
    });

    await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        payloadVersion: 1,
        events: [
          selfRatedEvent({
            id: "92000000-0000-4000-8000-000000000007",
            clientSequence: 6,
            clientOccurredAt: "2026-07-29T10:06:00.000Z",
            estimatedServerOccurredAt: "2026-07-29T10:06:00.000Z",
            baseStateVersion: 6,
          }),
        ],
      })
      .expect(503);

    await expect(
      database.reviewEvent.count({
        where: { userId: TEST_STUDY_USER_ID, learningCardId },
      }),
    ).resolves.toBe(eventCountBefore);
    await expect(
      database.learningOutboxEvent.count({
        where: { userId: TEST_STUDY_USER_ID, learningCardId },
      }),
    ).resolves.toBe(outboxCountBefore);
    await expect(
      database.userCardState.findUniqueOrThrow({
        where: {
          userId_learningCardId: {
            userId: TEST_STUDY_USER_ID,
            learningCardId,
          },
        },
      }),
    ).resolves.toEqual(stateBefore);
  });
});

// A separate throwaway database, deliberately: the suite above hand-tunes exact
// stateVersion counts for one shared card across many sequential tests, and any
// extra session-creation call shifts which card the "due/learning priority" selector
// hands back next (a just-reviewed card can immediately re-qualify as due). Isolating
// this flow avoids coupling it to that fragile ordering.
describe("mixed-mode study flow (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_mixed_flow_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let accessToken: string;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for review integration tests");
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
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Mixed-flow test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

  async function sendMixedFlowEvent(
    event: Record<string, unknown>,
  ): Promise<ReviewBatchBody> {
    const response = await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ payloadVersion: 1, events: [event] })
      .expect(200);
    return response.body as unknown as ReviewBatchBody;
  }

  async function newCardIn(
    body: SessionBody,
  ): Promise<SessionBody["cards"][number]> {
    const candidates = await Promise.all(
      body.cards.map(async (card) => ({
        card,
        state: await database.userCardState.findUnique({
          where: {
            userId_learningCardId: {
              userId: TEST_STUDY_USER_ID,
              learningCardId: card.learningCard.id,
            },
          },
        }),
      })),
    );
    // A just-reviewed card can immediately re-qualify as due/learning priority in
    // the very next session request, so never assume cards[0] is unreviewed.
    const picked = candidates.find(({ state }) => state === null)?.card;
    if (picked === undefined) {
      throw new Error("Mixed-flow test has no new card in this session");
    }
    return picked;
  }

  it("grades both SELF_RATED and MULTIPLE_CHOICE reviews and updates FSRS state for each, in one continuous flow", async () => {
    const selfRatedSessionId = "95000000-0000-4000-8000-000000000001";
    const selfRatedSession = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: selfRatedSessionId,
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 5,
        mode: AnswerMode.SELF_RATED,
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const selfRatedCard = await newCardIn(
      selfRatedSession.body as unknown as SessionBody,
    );

    const selfRatedResult = await sendMixedFlowEvent({
      id: "96000000-0000-4000-8000-000000000001",
      sessionId: selfRatedSessionId,
      learningCardId: selfRatedCard.learningCard.id,
      deviceId: TEST_STUDY_DEVICE_ID,
      answerMode: AnswerMode.SELF_RATED,
      rating: ReviewRating.GOOD,
      responseTimeMs: 4200,
      clientOccurredAt: "2026-07-29T10:00:00.000Z",
      estimatedServerOccurredAt: "2026-07-29T10:00:00.000Z",
      clientSequence: 1,
      baseStateVersion: 0,
    });
    expect(selfRatedResult.results[0]).toMatchObject({
      status: "ACCEPTED",
      canonicalRating: ReviewRating.GOOD,
      isCorrect: true,
      cardState: {
        learningCardId: selfRatedCard.learningCard.id,
        stateVersion: 1,
      },
    });
    expect(typeof selfRatedResult.results[0]?.cardState?.dueAt).toBe("string");

    const multipleChoiceSessionId = "95000000-0000-4000-8000-000000000002";
    const multipleChoiceSession = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: multipleChoiceSessionId,
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 5,
        mode: AnswerMode.MULTIPLE_CHOICE,
        selectionOrigin: "SERVER",
        locale: "en",
      })
      .expect(201);
    const multipleChoiceCard = await newCardIn(
      multipleChoiceSession.body as unknown as SessionBody,
    );
    if (multipleChoiceCard.options?.length !== 4) {
      throw new Error(
        "Mixed-flow test has no complete MULTIPLE_CHOICE option set",
      );
    }
    const persistedOptions = await database.studySessionCardOption.findMany({
      where: { studySessionCardId: multipleChoiceCard.id },
      orderBy: { position: "asc" },
    });
    const correctOptionId = persistedOptions.find(
      ({ isCorrect }) => isCorrect,
    )?.id;
    if (correctOptionId === undefined) {
      throw new Error("Mixed-flow test has no correct option");
    }

    const multipleChoiceResult = await sendMixedFlowEvent({
      id: "96000000-0000-4000-8000-000000000002",
      sessionId: multipleChoiceSessionId,
      learningCardId: multipleChoiceCard.learningCard.id,
      deviceId: TEST_STUDY_DEVICE_ID,
      answerMode: AnswerMode.MULTIPLE_CHOICE,
      selectedOptionId: correctOptionId,
      clientOccurredAt: "2026-07-29T11:00:00.000Z",
      estimatedServerOccurredAt: "2026-07-29T11:00:00.000Z",
      clientSequence: 2,
      baseStateVersion: null,
    });
    expect(multipleChoiceResult.results[0]).toMatchObject({
      status: "ACCEPTED",
      canonicalRating: ReviewRating.GOOD,
      isCorrect: true,
      correctOptionId,
      cardState: {
        learningCardId: multipleChoiceCard.learningCard.id,
        stateVersion: 1,
      },
    });
    expect(typeof multipleChoiceResult.results[0]?.cardState?.dueAt).toBe(
      "string",
    );
  });
});
