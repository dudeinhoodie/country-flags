import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import {
  TEST_STUDY_DEVICE_ID,
  TEST_STUDY_USER_ID,
} from "../src/modules/study-sessions/fixtures/test-study.fixture";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";

interface StudyCardBody {
  id: string;
  initialOrder: number;
  selectionReason: string;
  randomSeed: string;
  learningCard: {
    id: string;
    answerMode: string;
    semanticVersion: number;
    revision: number;
    answer: { displayName: string };
  };
  distractorPolicyVersion: string | null;
  options?: Array<{ id: string; position: number; displayName: string }>;
}

interface StudySessionSummaryBody {
  uniqueCardCount: number;
  reviewCount: number;
  correctCount: number;
  incorrectCount: number;
  durationSeconds: number;
  ratings: { again: number; hard: number; good: number; easy: number };
}

interface StudySessionBody {
  id: string;
  requestedUniqueCount: number;
  selectedUniqueCount: number;
  status: string;
  contentVersion: string;
  schedulerVersion: string;
  startedAt: string;
  completedAt: string | null;
  summary?: StudySessionSummaryBody;
  cards: StudyCardBody[];
}

interface ErrorBody {
  error: {
    code: string;
    requestId: string;
  };
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

describe("study session creation and retrieval (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_sessions_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let accessToken: string;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for study session integration tests",
      );
    }

    admin = new PrismaClient({
      datasources: { db: { url: baseUrl } },
    });
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
        `Study session test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    await importTestContent(database);
    await importTestStudySeed(database);
    accessToken = app.get(TestJwtSigner).sign(TEST_STUDY_USER_ID);
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

  it("imports the deterministic study seed idempotently", async () => {
    const first = await importTestStudySeed(database);
    const second = await importTestStudySeed(database);

    expect(second).toEqual(first);
    expect(first).toEqual({
      marker: "TEST_ONLY",
      userId: TEST_STUDY_USER_ID,
      schedulerVersion: "test-fsrs-6-v2",
      cardStates: 3,
    });
    await expect(
      database.userCardState.count({
        where: { userId: TEST_STUDY_USER_ID },
      }),
    ).resolves.toBe(3);
  });

  it("creates five unique cards with due/learning priority and new fill", async () => {
    const response = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: "90000000-0000-4000-8000-000000000001",
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const body = response.body as unknown as StudySessionBody;

    expect(body).toMatchObject({
      id: "90000000-0000-4000-8000-000000000001",
      requestedUniqueCount: 5,
      selectedUniqueCount: 5,
      contentVersion: "test-only-fixture-v1",
      schedulerVersion: "test-fsrs-6-v2",
    });
    expect(body.cards.map(({ selectionReason }) => selectionReason)).toEqual([
      "OVERDUE",
      "LEARNING",
      "NEW",
      "NEW",
      "NEW",
    ]);
    expect(new Set(body.cards.map(({ id }) => id)).size).toBe(5);
    expect(
      new Set(body.cards.map(({ learningCard }) => learningCard.id)).size,
    ).toBe(5);
    expect(body.cards.map(({ initialOrder }) => initialOrder)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(body.cards[0]?.learningCard.answer.displayName).toBe("Belgium");
    expect(body.cards[1]?.learningCard.answer.displayName).toBe("France");
  });

  it("returns 200 for the same request and 409 for a conflicting payload", async () => {
    const payload = {
      id: "90000000-0000-4000-8000-000000000001",
      deckId: "70000000-0000-4000-8000-000000000001",
      requestedUniqueCount: 5,
      mode: "SELF_RATED",
      locale: "en",
      selectionOrigin: "SERVER",
    };
    const repeated = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(payload)
      .expect(200);
    const repeatedBody = repeated.body as unknown as StudySessionBody;
    const persisted = await database.studySession.findUniqueOrThrow({
      where: { id: payload.id },
      include: { cards: { orderBy: { initialOrder: "asc" } } },
    });

    expect(repeatedBody.cards.map(({ id }) => id)).toEqual(
      persisted.cards.map(({ id }) => id),
    );

    const conflict = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ ...payload, requestedUniqueCount: 10 })
      .expect(409);
    const conflictBody = conflict.body as unknown as ErrorBody;
    expect(conflictBody.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("persists four localized options without exposing correctness", async () => {
    const sessionId = "90000000-0000-4000-8000-000000000004";
    const response = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: sessionId,
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 5,
        mode: "MULTIPLE_CHOICE",
        locale: "en-US",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const body = response.body as unknown as StudySessionBody;

    expect(body.cards).toHaveLength(5);
    for (const card of body.cards) {
      expect(card.learningCard.answerMode).toBe("MULTIPLE_CHOICE");
      expect(card.distractorPolicyVersion).toBe(
        "mvp-distractors-v1@test-only-fixture-v1",
      );
      expect(card.options).toHaveLength(4);
      expect(card.options?.map(({ position }) => position)).toEqual([
        0, 1, 2, 3,
      ]);
      expect(new Set(card.options?.map(({ id }) => id)).size).toBe(4);
      expect(
        card.options?.every(
          (option) => !("isCorrect" in (option as Record<string, unknown>)),
        ),
      ).toBe(true);
    }

    const persisted = await database.studySessionCard.findMany({
      where: { sessionId },
      include: { options: true },
    });
    expect(persisted).toHaveLength(5);
    expect(
      persisted.every(
        ({ options }) =>
          options.length === 4 &&
          options.filter(({ isCorrect }) => isCorrect).length === 1,
      ),
    ).toBe(true);

    const firstOption = body.cards[0]?.options?.[0];
    const persistedOption = persisted
      .flatMap(({ options }) => options)
      .find(({ id }) => id === firstOption?.id);
    if (firstOption === undefined || persistedOption === undefined) {
      throw new Error("Objective session has no persisted option");
    }
    await database.geoEntityName.updateMany({
      where: {
        geoEntityId: persistedOption.answerEntityId,
        locale: "en",
        isPrimary: true,
      },
      data: { value: "Changed after session creation" },
    });
    const unchanged = await request(httpServer)
      .get(`/v1/study-sessions/${sessionId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const unchangedBody = unchanged.body as unknown as StudySessionBody;
    expect(unchangedBody.cards[0]?.options?.[0]?.displayName).toBe(
      firstOption.displayName,
    );
  });

  it("retrieves only the authenticated user's persisted snapshot", async () => {
    const sessionId = "90000000-0000-4000-8000-000000000001";
    const ownResponse = await request(httpServer)
      .get(`/v1/study-sessions/${sessionId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const ownBody = ownResponse.body as unknown as StudySessionBody;
    expect(ownBody.cards).toHaveLength(5);

    const anotherUserId = "80000000-0000-4000-8000-000000000002";
    await database.user.create({
      data: {
        id: anotherUserId,
        preferredLocale: "en",
      },
    });
    const anotherToken = app.get(TestJwtSigner).sign(anotherUserId);
    const hidden = await request(httpServer)
      .get(`/v1/study-sessions/${sessionId}`)
      .set("Authorization", `Bearer ${anotherToken}`)
      .expect(404);
    const hiddenBody = hidden.body as unknown as ErrorBody;
    expect(hiddenBody.error.code).toBe("RESOURCE_NOT_FOUND");

    const unauthorized = await request(httpServer)
      .get(`/v1/study-sessions/${sessionId}`)
      .expect(401);
    const unauthorizedBody = unauthorized.body as unknown as ErrorBody;
    expect(unauthorizedBody.error.code).toBe("UNAUTHORIZED");
  });

  it("uses all available active cards and current technical/material revisions", async () => {
    const response = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: "90000000-0000-4000-8000-000000000002",
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 20,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const body = response.body as unknown as StudySessionBody;
    const russia = body.cards.find(
      ({ learningCard }) => learningCard.answer.displayName === "Russia",
    );
    const switzerland = body.cards.find(
      ({ learningCard }) => learningCard.answer.displayName === "Switzerland",
    );

    expect(body.selectedUniqueCount).toBe(8);
    expect(body.cards).toHaveLength(8);
    expect(new Set(body.cards.map(({ id }) => id)).size).toBe(8);
    expect(russia?.learningCard).toMatchObject({ semanticVersion: 2 });
    expect(switzerland?.learningCard).toMatchObject({ revision: 2 });

    const firstCardId = body.cards[0]?.learningCard.id;
    if (firstCardId === undefined) {
      throw new Error("Created session has no first card");
    }
    await database.learningCard.update({
      where: { id: firstCardId },
      data: { status: "RETIRED" },
    });
    const persisted = await request(httpServer)
      .get("/v1/study-sessions/90000000-0000-4000-8000-000000000002")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const persistedBody = persisted.body as unknown as StudySessionBody;
    expect(persistedBody.cards).toEqual(body.cards);

    const next = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: "90000000-0000-4000-8000-000000000003",
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 20,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const nextBody = next.body as unknown as StudySessionBody;
    expect(nextBody.selectedUniqueCount).toBe(7);
    expect(
      nextBody.cards.map(({ learningCard }) => learningCard.id),
    ).not.toContain(firstCardId);
  });

  it("completes a session once and keeps the canonical summary stable", async () => {
    const sessionId = "90000000-0000-4000-8000-000000000006";
    const created = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: sessionId,
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const createdBody = created.body as unknown as StudySessionBody;
    expect(createdBody.status).toBe("ACTIVE");
    // An unfinished session omits the summary instead of sending null.
    expect(created.body).not.toHaveProperty("summary");
    const [first, second] = createdBody.cards;
    if (first === undefined || second === undefined) {
      throw new Error("Completion test session has too few cards");
    }

    await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        payloadVersion: 1,
        events: [
          {
            id: "93000000-0000-4000-8000-000000000001",
            sessionId,
            learningCardId: first.learningCard.id,
            deviceId: TEST_STUDY_DEVICE_ID,
            answerMode: "SELF_RATED",
            rating: "GOOD",
            responseTimeMs: 3000,
            clientOccurredAt: "2026-07-29T11:00:00.000Z",
            estimatedServerOccurredAt: "2026-07-29T11:00:00.000Z",
            clientSequence: 101,
          },
          {
            id: "93000000-0000-4000-8000-000000000002",
            sessionId,
            learningCardId: second.learningCard.id,
            deviceId: TEST_STUDY_DEVICE_ID,
            answerMode: "SELF_RATED",
            rating: "AGAIN",
            responseTimeMs: 9000,
            clientOccurredAt: "2026-07-29T11:00:30.000Z",
            estimatedServerOccurredAt: "2026-07-29T11:00:30.000Z",
            clientSequence: 102,
          },
        ],
      })
      .expect(200);

    const startedAt = new Date(createdBody.startedAt).getTime();
    const completed = await request(httpServer)
      .post(`/v1/study-sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ completedAt: new Date(startedAt + 90_000).toISOString() })
      .expect(200);
    const completedBody = completed.body as unknown as StudySessionBody;

    expect(completedBody.status).toBe("COMPLETED");
    expect(completedBody.completedAt).not.toBeNull();
    expect(completedBody.summary).toEqual({
      uniqueCardCount: 2,
      reviewCount: 2,
      correctCount: 1,
      incorrectCount: 1,
      durationSeconds: 90,
      ratings: { again: 1, hard: 0, good: 1, easy: 0 },
    });

    // A retried completion is idempotent: neither the summary nor the
    // canonical completion instant may move.
    const retried = await request(httpServer)
      .post(`/v1/study-sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ completedAt: new Date(startedAt + 5_000_000).toISOString() })
      .expect(200);
    expect(retried.body).toMatchObject({
      status: "COMPLETED",
      completedAt: completedBody.completedAt,
      summary: completedBody.summary,
    });

    const persisted = await request(httpServer)
      .get(`/v1/study-sessions/${sessionId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(persisted.body).toMatchObject({
      status: "COMPLETED",
      summary: completedBody.summary,
    });
  });

  it("bounds a skewed completion instant and rejects invalid completion bodies", async () => {
    const sessionId = "90000000-0000-4000-8000-000000000007";
    const created = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: sessionId,
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const startedAt = new Date(
      (created.body as unknown as StudySessionBody).startedAt,
    );

    const invalid = await request(httpServer)
      .post(`/v1/study-sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ completedAt: "2026-07-29T11:00:00.000Z", extra: true })
      .expect(422);
    expect((invalid.body as unknown as ErrorBody).error.code).toBe(
      "VALIDATION_FAILED",
    );

    // A device clock a year ahead must not inflate the reported duration.
    const skewed = await request(httpServer)
      .post(`/v1/study-sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        completedAt: new Date(
          startedAt.getTime() + 365 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
      })
      .expect(200);
    const skewedBody = skewed.body as unknown as StudySessionBody;
    expect(skewedBody.summary).toMatchObject({
      uniqueCardCount: 0,
      reviewCount: 0,
      correctCount: 0,
      incorrectCount: 0,
    });
    expect(skewedBody.summary?.durationSeconds).toBeLessThan(600);
    expect(
      new Date(String(skewedBody.completedAt)).getTime(),
    ).toBeLessThanOrEqual(Date.now());

    const foreign = await request(httpServer)
      .post("/v1/study-sessions/90000000-0000-4000-8000-0000000000ff/complete")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ completedAt: new Date().toISOString() })
      .expect(404);
    expect((foreign.body as unknown as ErrorBody).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );

    await request(httpServer)
      .post(`/v1/study-sessions/${sessionId}/complete`)
      .send({ completedAt: new Date().toISOString() })
      .expect(401);
  });

  it("returns a typed error when the global localized pool is insufficient", async () => {
    const active = await database.geoEntity.findMany({
      where: { status: "ACTIVE", includeInCountryCatalog: true },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const hiddenIds = active.slice(3).map(({ id }) => id);
    await database.geoEntity.updateMany({
      where: { id: { in: hiddenIds } },
      data: { status: "HIDDEN" },
    });

    try {
      const response = await request(httpServer)
        .post("/v1/study-sessions")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          id: "90000000-0000-4000-8000-000000000005",
          deckId: "70000000-0000-4000-8000-000000000001",
          requestedUniqueCount: 5,
          mode: "MULTIPLE_CHOICE",
          locale: "ru",
          selectionOrigin: "SERVER",
        })
        .expect(422);
      const body = response.body as unknown as ErrorBody;
      expect(body.error.code).toBe("DISTRACTOR_POOL_INSUFFICIENT");
    } finally {
      await database.geoEntity.updateMany({
        where: { id: { in: hiddenIds } },
        data: { status: "ACTIVE" },
      });
    }
  });
});
