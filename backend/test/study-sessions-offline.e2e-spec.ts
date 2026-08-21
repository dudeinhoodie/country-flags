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

const DECK_ID = "70000000-0000-4000-8000-000000000001";
const CONTENT_VERSION = "test-only-fixture-v1";
const SUPERSEDED_CONTENT_VERSION = "test-only-fixture-v0";
const DRAFT_CONTENT_VERSION = "test-only-fixture-v2-draft";
const STARTED_AT = "2026-07-29T09:40:00.000Z";

interface CardSnapshotBody {
  id: string;
  revision: number;
  answer: { displayName: string };
  prompt: { asset: { sha256: string } };
}

interface StudyCardBody {
  id: string;
  initialOrder: number;
  selectionReason: string;
  randomSeed: string;
  distractorPolicyVersion: string | null;
  learningCard: CardSnapshotBody;
  options?: unknown[];
}

interface StudySessionBody {
  id: string;
  deckId: string;
  mode: string;
  selectionOrigin: string;
  requestedUniqueCount: number;
  selectedUniqueCount: number;
  status: string;
  contentVersion: string;
  schedulerVersion: string;
  startedAt: string;
  completedAt: string | null;
  summary?: { reviewCount: number; correctCount: number };
  cards: StudyCardBody[];
}

interface ErrorBody {
  error: {
    code: string;
    requestId: string;
    details: {
      cards?: Array<{ learningCardId: string; reason: string }>;
      contentVersion?: string;
    };
  };
}

interface ReviewBatchBody {
  results: Array<{
    eventId: string;
    status: string;
    rejectionCode: string | null;
  }>;
}

interface OfflineCardBody {
  learningCardId: string;
  learningCardRevision: number;
  assetSha256: string;
  randomSeed: string;
  distractorPolicyVersion: null;
  snapshot: CardSnapshotBody;
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

describe("offline study session import (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_offline_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let accessToken: string;
  let offlineCards: OfflineCardBody[];
  let canonicalSnapshots: CardSnapshotBody[];

  function importBody(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return {
      id: "91000000-0000-4000-8000-000000000001",
      deckId: DECK_ID,
      requestedUniqueCount: 5,
      mode: "SELF_RATED",
      locale: "en",
      selectionOrigin: "CLIENT_OFFLINE",
      startedAt: STARTED_AT,
      contentVersion: CONTENT_VERSION,
      cards: offlineCards.slice(0, 3),
      ...overrides,
    };
  }

  function post(body: Record<string, unknown>): request.Test {
    return request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for offline session import integration tests",
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
          DIRECT_DATABASE_URL: testDatabaseUrl,
        },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Offline import test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    // A device that studied offline holds exactly the snapshots a server
    // session would have handed it, so the fixture composition is derived from
    // a real server selection instead of hand-written identifiers.
    const seeded = await post({
      id: "91000000-0000-4000-8000-0000000000ff",
      deckId: DECK_ID,
      requestedUniqueCount: 20,
      mode: "SELF_RATED",
      locale: "en",
      selectionOrigin: "SERVER",
    }).expect(201);
    canonicalSnapshots = (seeded.body as StudySessionBody).cards.map(
      ({ learningCard }) => learningCard,
    );
    offlineCards = canonicalSnapshots.map((snapshot, index) => ({
      learningCardId: snapshot.id,
      learningCardRevision: snapshot.revision,
      assetSha256: snapshot.prompt.asset.sha256,
      randomSeed: `offline-seed-${index + 1}`,
      distractorPolicyVersion: null,
      snapshot,
    }));

    await database.contentRelease.create({
      data: {
        version: SUPERSEDED_CONTENT_VERSION,
        schemaVersion: 1,
        status: "RETIRED",
        manifestChecksum: "0".repeat(64),
        metadata: { marker: "TEST_ONLY", manifest: { defaultLocale: "ru" } },
        publishedAt: "2026-07-01T00:00:00.000Z",
        retiredAt: "2026-07-28T12:00:00.000Z",
      },
    });
    await database.contentRelease.create({
      data: {
        version: DRAFT_CONTENT_VERSION,
        schemaVersion: 1,
        status: "DRAFT",
        manifestChecksum: "1".repeat(64),
        metadata: { marker: "TEST_ONLY", manifest: { defaultLocale: "ru" } },
      },
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

  it("creates the client composition with 201 and preserves its identity", async () => {
    const response = await post(importBody()).expect(201);
    const body = response.body as unknown as StudySessionBody;

    expect(body).toMatchObject({
      id: "91000000-0000-4000-8000-000000000001",
      deckId: DECK_ID,
      mode: "SELF_RATED",
      selectionOrigin: "CLIENT_OFFLINE",
      requestedUniqueCount: 5,
      selectedUniqueCount: 3,
      status: "ACTIVE",
      contentVersion: CONTENT_VERSION,
      schedulerVersion: "test-fsrs-6-v2",
      startedAt: STARTED_AT,
      completedAt: null,
    });
    expect(body.cards.map(({ learningCard }) => learningCard.id)).toEqual(
      offlineCards.slice(0, 3).map(({ learningCardId }) => learningCardId),
    );
    expect(body.cards.map(({ initialOrder }) => initialOrder)).toEqual([
      0, 1, 2,
    ]);
    expect(body.cards.map(({ randomSeed }) => randomSeed)).toEqual([
      "offline-seed-1",
      "offline-seed-2",
      "offline-seed-3",
    ]);
    expect(
      body.cards.every(
        ({ distractorPolicyVersion, options }) =>
          distractorPolicyVersion === null && options === undefined,
      ),
    ).toBe(true);
    // Selection reasons are derived from canonical card state, never declared.
    expect(body.cards.map(({ selectionReason }) => selectionReason)).toEqual([
      "OVERDUE",
      "LEARNING",
      "NEW",
    ]);

    const persisted = await request(httpServer)
      .get(`/v1/study-sessions/${body.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect((persisted.body as unknown as StudySessionBody).cards).toEqual(
      body.cards,
    );
  });

  it("rebuilds every snapshot from canonical content", async () => {
    const tampered = canonicalSnapshots[0];
    if (tampered === undefined) {
      throw new Error("Offline fixture has no snapshot");
    }

    const response = await post(
      importBody({
        id: "91000000-0000-4000-8000-000000000002",
        cards: [
          {
            ...offlineCards[0],
            snapshot: {
              ...tampered,
              answer: { ...tampered.answer, displayName: "TAMPERED" },
            },
          },
        ],
      }),
    ).expect(201);
    const body = response.body as unknown as StudySessionBody;

    expect(body.cards[0]?.learningCard).toEqual(tampered);
    expect(body.cards[0]?.learningCard.answer.displayName).not.toBe("TAMPERED");
  });

  it("returns 200 for the same import and 409 for a different composition", async () => {
    const repeated = await post(importBody()).expect(200);
    const repeatedBody = repeated.body as unknown as StudySessionBody;
    expect(repeatedBody.cards.map(({ id }) => id)).toHaveLength(3);
    expect(repeatedBody.startedAt).toBe(STARTED_AT);

    const conflict = await post(
      importBody({ cards: [...offlineCards.slice(0, 3)].reverse() }),
    ).expect(409);
    expect((conflict.body as unknown as ErrorBody).error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );

    // The stored session must survive the rejected retry untouched.
    const stored = await database.studySessionCard.findMany({
      where: { sessionId: "91000000-0000-4000-8000-000000000001" },
      orderBy: { initialOrder: "asc" },
    });
    expect(stored.map(({ learningCardId }) => learningCardId)).toEqual(
      offlineCards.slice(0, 3).map(({ learningCardId }) => learningCardId),
    );
  });

  it("accepts reviews and completion for an imported session", async () => {
    const sessionId = "91000000-0000-4000-8000-000000000003";
    const created = await post(
      importBody({ id: sessionId, cards: offlineCards.slice(0, 2) }),
    ).expect(201);
    const createdBody = created.body as unknown as StudySessionBody;
    const [first, second] = createdBody.cards;
    if (first === undefined || second === undefined) {
      throw new Error("Imported session has too few cards");
    }

    const batch = await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        payloadVersion: 1,
        events: [
          {
            id: "94000000-0000-4000-8000-000000000001",
            sessionId,
            learningCardId: first.learningCard.id,
            deviceId: TEST_STUDY_DEVICE_ID,
            answerMode: "SELF_RATED",
            rating: "GOOD",
            responseTimeMs: 2500,
            clientOccurredAt: "2026-07-29T09:41:00.000Z",
            estimatedServerOccurredAt: "2026-07-29T09:41:00.000Z",
            clientSequence: 501,
          },
          {
            id: "94000000-0000-4000-8000-000000000002",
            sessionId,
            learningCardId: second.learningCard.id,
            deviceId: TEST_STUDY_DEVICE_ID,
            answerMode: "SELF_RATED",
            rating: "AGAIN",
            responseTimeMs: 8000,
            clientOccurredAt: "2026-07-29T09:41:30.000Z",
            estimatedServerOccurredAt: "2026-07-29T09:41:30.000Z",
            clientSequence: 502,
          },
        ],
      })
      .expect(200);
    const batchBody = batch.body as unknown as ReviewBatchBody;

    expect(batchBody.results.map(({ status }) => status)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect(
      batchBody.results.every(({ rejectionCode }) => rejectionCode === null),
    ).toBe(true);

    const completed = await request(httpServer)
      .post(`/v1/study-sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ completedAt: "2026-07-29T09:45:00.000Z" })
      .expect(200);
    const completedBody = completed.body as unknown as StudySessionBody;
    expect(completedBody.status).toBe("COMPLETED");
    expect(completedBody.summary).toMatchObject({
      reviewCount: 2,
      correctCount: 1,
    });
  });

  it("accepts a superseded but published content version", async () => {
    const response = await post(
      importBody({
        id: "91000000-0000-4000-8000-000000000004",
        contentVersion: SUPERSEDED_CONTENT_VERSION,
        cards: offlineCards.slice(0, 1),
      }),
    ).expect(201);

    expect((response.body as unknown as StudySessionBody).contentVersion).toBe(
      SUPERSEDED_CONTENT_VERSION,
    );
  });

  it.each([
    ["an unpublished release", DRAFT_CONTENT_VERSION],
    ["a release the catalog never published", "never-published-v9"],
  ])("rejects %s without creating a session", async (_case, contentVersion) => {
    const id = "91000000-0000-4000-8000-000000000005";
    const response = await post(importBody({ id, contentVersion })).expect(422);
    const body = response.body as unknown as ErrorBody;

    expect(body.error.code).toBe("CONTENT_VERSION_UNKNOWN");
    expect(body.error.details.contentVersion).toBe(contentVersion);
    await expect(
      database.studySession.findUnique({ where: { id } }),
    ).resolves.toBeNull();
  });

  it("rejects a card that is not a member of the deck", async () => {
    const id = "91000000-0000-4000-8000-000000000006";
    const foreign = await database.learningCard.findFirstOrThrow({
      where: { deckCards: { none: { deckId: DECK_ID } } },
      include: {
        revisions: {
          where: { retiredAt: null },
          include: { promptAsset: { include: { representations: true } } },
        },
      },
    });
    const revision = foreign.revisions[0];
    if (
      revision === undefined ||
      revision.promptAsset === null ||
      revision.promptAsset.representations[0] === undefined
    ) {
      throw new Error("Fixture card outside the deck has no prompt asset");
    }

    const response = await post(
      importBody({
        id,
        cards: [
          {
            learningCardId: foreign.id,
            learningCardRevision: revision.revision,
            // Whatever encoding a client would have cached: the check is
            // about the picture the release publishes, not about which of its
            // forms this test happened to pick.
            assetSha256: revision.promptAsset.representations[0].sha256,
            randomSeed: "offline-seed-foreign",
            distractorPolicyVersion: null,
            snapshot: { id: foreign.id, revision: revision.revision },
          },
        ],
      }),
    ).expect(422);
    const body = response.body as unknown as ErrorBody;

    expect(body.error.code).toBe("OFFLINE_SESSION_COMPOSITION_INVALID");
    expect(body.error.details.cards).toEqual([
      { learningCardId: foreign.id, reason: "NOT_IN_DECK" },
    ]);
    await expect(
      database.studySession.findUnique({ where: { id } }),
    ).resolves.toBeNull();
  });

  it("rejects a card retired after the offline selection", async () => {
    const id = "91000000-0000-4000-8000-000000000007";
    const retired = offlineCards.at(-1);
    if (retired === undefined) {
      throw new Error("Offline fixture has no card to retire");
    }

    await database.learningCard.update({
      where: { id: retired.learningCardId },
      data: { status: "RETIRED" },
    });
    try {
      const response = await post(
        importBody({ id, cards: [offlineCards[0], retired] }),
      ).expect(422);
      const body = response.body as unknown as ErrorBody;

      expect(body.error.code).toBe("OFFLINE_SESSION_COMPOSITION_INVALID");
      expect(body.error.details.cards).toEqual([
        { learningCardId: retired.learningCardId, reason: "RETIRED" },
      ]);
      await expect(
        database.studySessionCard.count({ where: { sessionId: id } }),
      ).resolves.toBe(0);
    } finally {
      await database.learningCard.update({
        where: { id: retired.learningCardId },
        data: { status: "ACTIVE" },
      });
    }
  });

  async function expectSingleCardRejection(
    id: string,
    override: Partial<OfflineCardBody>,
    reason: string,
  ): Promise<void> {
    const card = offlineCards[0];
    if (card === undefined) {
      throw new Error("Offline fixture has no card");
    }
    const declared: OfflineCardBody = { ...card, ...override };

    const response = await post(
      importBody({
        id,
        cards: [
          {
            ...declared,
            snapshot: {
              ...declared.snapshot,
              revision: declared.learningCardRevision,
            },
          },
        ],
      }),
    ).expect(422);
    const body = response.body as unknown as ErrorBody;

    expect(body.error.code).toBe("OFFLINE_SESSION_COMPOSITION_INVALID");
    expect(body.error.details.cards).toEqual([
      { learningCardId: card.learningCardId, reason },
    ]);
    await expect(
      database.studySession.findUnique({ where: { id } }),
    ).resolves.toBeNull();
  }

  it("rejects a revision the catalog does not know", async () => {
    await expectSingleCardRejection(
      "91000000-0000-4000-8000-000000000008",
      { learningCardRevision: 99 },
      "REVISION_UNKNOWN",
    );
  });

  it("rejects a stale prompt asset checksum", async () => {
    await expectSingleCardRejection(
      "91000000-0000-4000-8000-000000000009",
      { assetSha256: "a".repeat(64) },
      "ASSET_MISMATCH",
    );
  });

  it("rejects an objective offline session with a typed error", async () => {
    const id = "91000000-0000-4000-8000-00000000000a";
    const response = await post(
      importBody({ id, mode: "MULTIPLE_CHOICE" }),
    ).expect(422);

    expect((response.body as unknown as ErrorBody).error.code).toBe(
      "OFFLINE_MODE_UNSUPPORTED",
    );
    await expect(
      database.studySession.findUnique({ where: { id } }),
    ).resolves.toBeNull();
  });

  it("rejects a repeated card and an oversized composition", async () => {
    const [card] = offlineCards;
    if (card === undefined) {
      throw new Error("Offline fixture has no card");
    }

    const duplicated = await post(
      importBody({
        id: "91000000-0000-4000-8000-00000000000b",
        cards: [card, card],
      }),
    ).expect(422);
    expect((duplicated.body as unknown as ErrorBody).error.code).toBe(
      "VALIDATION_FAILED",
    );

    const oversized = await post(
      importBody({
        id: "91000000-0000-4000-8000-00000000000c",
        requestedUniqueCount: 5,
        cards: offlineCards,
      }),
    ).expect(422);
    expect((oversized.body as unknown as ErrorBody).error.code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("hides an imported session from another account", async () => {
    const anotherUserId = "80000000-0000-4000-8000-000000000003";
    await database.user.create({
      data: { id: anotherUserId, preferredLocale: "en" },
    });
    const anotherToken = app.get(TestJwtSigner).sign(anotherUserId);

    await request(httpServer)
      .get("/v1/study-sessions/91000000-0000-4000-8000-000000000001")
      .set("Authorization", `Bearer ${anotherToken}`)
      .expect(404);

    // The same session ID owned by somebody else is an idempotency conflict,
    // never a silent takeover of the stored composition.
    const conflict = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${anotherToken}`)
      .send(importBody())
      .expect(409);
    expect((conflict.body as unknown as ErrorBody).error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
  });

  it("requires authentication", async () => {
    await request(httpServer)
      .post("/v1/study-sessions")
      .send(importBody({ id: "91000000-0000-4000-8000-00000000000d" }))
      .expect(401);
  });
});
