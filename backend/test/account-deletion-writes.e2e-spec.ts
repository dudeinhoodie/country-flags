import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { ConsentCategory, PrismaClient, UserStatus } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { AccountDeletionService } from "../src/modules/account-lifecycle/account-deletion.service";
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";
import { TEST_CONTENT_FIXTURE } from "../src/modules/content/fixtures/test-content.fixture";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";

const FREE_DECK_ID = "70000000-0000-4000-8000-000000000001";

interface ErrorBody {
  error: { code: string };
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function syncEvent(): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    eventName: "sync.completed",
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    anonymousId: "a".repeat(20),
    sessionId: "s".repeat(10),
    context: {
      platform: "ios",
      appVersion: "1.0.0",
      build: "100",
      locale: "en",
    },
    properties: { result: "success", durationBucket: "under_1s" },
  };
}

/**
 * What an account deletion does to the writes around it: the ones already in
 * flight, the ones that arrive while it runs, and the analytics events that
 * were still waiting to be delivered.
 */
describe("account deletion and in-flight writes (integration)", () => {
  jest.setTimeout(180_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    TEST_AUTH_ENABLED: process.env.TEST_AUTH_ENABLED,
  };
  const databaseName =
    `country_flags_deletion_writes_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestJwtSigner;
  let deletion: AccountDeletionService;
  let cardIds: string[];

  async function account(): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    await database.user.create({
      data: {
        id: userId,
        preferredLocale: "en",
        status: UserStatus.ACTIVE,
        settings: { create: { timezone: "UTC", contentLocale: "en" } },
      },
    });
    return { userId, token: signer.sign(userId) };
  }

  /** Everything account-scoped that a write could have left behind. */
  async function leftovers(userId: string): Promise<Record<string, number>> {
    const [
      reviewEvents,
      studySessions,
      devices,
      guestImports,
      cardStates,
      deckMastery,
      settings,
      privacySettings,
      analyticsEvents,
    ] = await Promise.all([
      database.reviewEvent.count({ where: { userId } }),
      database.studySession.count({ where: { userId } }),
      database.device.count({ where: { userId } }),
      database.guestImportOperation.count({ where: { userId } }),
      database.userCardState.count({ where: { userId } }),
      database.userDeckMastery.count({ where: { userId } }),
      database.userSettings.count({ where: { userId } }),
      database.userPrivacySettings.count({ where: { userId } }),
      database.analyticsOutboxEvent.count({
        where: { analyticsSubjectId: userId },
      }),
    ]);
    return {
      reviewEvents,
      studySessions,
      devices,
      guestImports,
      cardStates,
      deckMastery,
      settings,
      privacySettings,
      analyticsEvents,
    };
  }

  function guestImport(reviewsPerCard: number): Record<string, unknown> {
    const sessions: Array<Record<string, unknown>> = [];
    const reviews: Array<Record<string, unknown>> = [];
    let clientSequence = 0;
    for (let index = 0; index < 10; index += 1) {
      const sessionId = randomUUID();
      sessions.push({
        id: sessionId,
        deckId: FREE_DECK_ID,
        mode: "SELF_RATED",
        requestedUniqueCount: 5,
        contentVersion: TEST_CONTENT_FIXTURE.version,
        startedAt: new Date().toISOString(),
      });
      for (const learningCardId of cardIds) {
        for (let answer = 0; answer < reviewsPerCard; answer += 1) {
          clientSequence += 1;
          reviews.push({
            id: randomUUID(),
            sessionId,
            learningCardId,
            answerMode: "SELF_RATED",
            rating: "GOOD",
            clientOccurredAt: new Date().toISOString(),
            clientSequence,
          });
        }
      }
    }
    return {
      payloadVersion: 1,
      migrationId: randomUUID(),
      sourceInstallId: `guest-install-${randomUUID()}`,
      sessions,
      reviews,
    };
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for deletion write tests");
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
          DIRECT_DATABASE_URL: testDatabaseUrl,
        },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Deletion write test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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
    httpServer = app.getHttpServer() as Server;
    database = app.get(PrismaService);
    signer = app.get(TestJwtSigner);
    deletion = app.get(AccountDeletionService);

    await importTestContent(database);
    await importTestStudySeed(database);
    const memberships = await database.deckCard.findMany({
      where: {
        deckId: FREE_DECK_ID,
        learningCard: {
          revisions: { some: { contentVersion: TEST_CONTENT_FIXTURE.version } },
        },
      },
      orderBy: { learningCardId: "asc" },
      select: { learningCardId: true },
      take: 5,
    });
    cardIds = memberships.map(({ learningCardId }) => learningCardId);
    if (cardIds.length !== 5) {
      throw new Error("Deletion write fixture expects five free cards");
    }
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await app?.close();
    if (admin !== undefined) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
  });

  it("erases the analytics events still waiting to be delivered for the account", async () => {
    const { userId, token } = await account();
    const other = await account();
    for (const subject of [token, other.token]) {
      await request(httpServer)
        .post("/v1/analytics/events/batch")
        .set("Authorization", `Bearer ${subject}`)
        .send({ payloadVersion: 1, events: [syncEvent(), syncEvent()] })
        .expect(200);
    }
    // One of them already leased by the delivery worker.
    await database.analyticsOutboxEvent.updateMany({
      where: { analyticsSubjectId: userId },
      data: { deliveryStatus: "PROCESSING" },
    });
    await database.analyticsOutboxEvent.create({
      data: {
        eventId: randomUUID(),
        eventName: "sync.completed",
        schemaVersion: 1,
        occurredAt: new Date(),
        analyticsSubjectId: userId,
        anonymousId: "a".repeat(20),
        properties: { result: "failed", durationBucket: "over_5s" },
        context: {},
        consentCategory: ConsentCategory.DIAGNOSTICS,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await deletion.delete(userId, randomUUID());

    await expect(
      database.analyticsOutboxEvent.count({
        where: { analyticsSubjectId: userId },
      }),
    ).resolves.toBe(0);
    await expect(
      database.analyticsOutboxEvent.count({
        where: { analyticsSubjectId: other.userId },
      }),
    ).resolves.toBe(2);
    const audit = await database.auditEvent.findFirstOrThrow({
      where: { actorUserId: userId, action: "ACCOUNT_DELETED" },
      select: { metadata: true },
    });
    expect(audit.metadata).toMatchObject({
      deletedCounts: { analyticsOutboxEvents: 3 },
    });
  });

  it("refuses writes while the deletion is pending, and the deletion then finishes", async () => {
    const { userId, token } = await account();
    await database.userSettings.deleteMany({ where: { userId } });
    // The mark is committed and the erasure has not finished yet.
    const requestedAt = new Date(Date.now() - 60_000);
    await database.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DELETION_PENDING,
        deletionRequestedAt: requestedAt,
      },
    });

    const imported = await request(httpServer)
      .post("/v1/me/guest-imports")
      .set("Authorization", `Bearer ${token}`)
      .send(guestImport(1))
      .expect(401);
    expect((imported.body as ErrorBody).error.code).toBe("ACCOUNT_UNAVAILABLE");
    const settings = await request(httpServer)
      .get("/v1/me/settings")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect((settings.body as ErrorBody).error.code).toBe("ACCOUNT_UNAVAILABLE");
    await request(httpServer)
      .get("/v1/me/privacy-settings")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    await request(httpServer)
      .post("/v1/analytics/events/batch")
      .set("Authorization", `Bearer ${token}`)
      .send({ payloadVersion: 1, events: [syncEvent()] })
      .expect(401);
    await expect(leftovers(userId)).resolves.toEqual({
      reviewEvents: 0,
      studySessions: 0,
      devices: 0,
      guestImports: 0,
      cardStates: 0,
      deckMastery: 0,
      settings: 0,
      privacySettings: 0,
      analyticsEvents: 0,
    });

    await expect(deletion.delete(userId, randomUUID())).resolves.toMatchObject({
      status: "DELETION_PENDING",
      requestedAt: requestedAt.toISOString(),
    });
    await expect(
      database.user.findUniqueOrThrow({
        where: { id: userId },
        select: { status: true, deletionRequestedAt: true },
      }),
    ).resolves.toEqual({ status: "DELETED", deletionRequestedAt: requestedAt });
  });

  it("leaves nothing behind of a guest import that was running when the account was deleted", async () => {
    const { userId, token } = await account();
    // Long enough to still be running when the deletion arrives: a few
    // hundred reviews, each its own transaction and progress rebuild.
    const running = request(httpServer)
      .post("/v1/me/guest-imports")
      .set("Authorization", `Bearer ${token}`)
      .send(guestImport(6))
      .then((response) => response);

    let started = false;
    for (let attempt = 0; attempt < 600 && !started; attempt += 1) {
      started = (await database.reviewEvent.count({ where: { userId } })) > 0;
      if (!started) {
        await new Promise((done) => setTimeout(done, 25));
      }
    }
    expect(started).toBe(true);

    await deletion.delete(userId, randomUUID());
    const response = await running;

    // The import is refused as soon as it next writes. Whatever it wrote
    // before the deletion was erased with the rest.
    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error.code).toBe("ACCOUNT_UNAVAILABLE");
    await expect(leftovers(userId)).resolves.toEqual({
      reviewEvents: 0,
      studySessions: 0,
      devices: 0,
      guestImports: 0,
      cardStates: 0,
      deckMastery: 0,
      settings: 0,
      privacySettings: 0,
      analyticsEvents: 0,
    });
  });
});
