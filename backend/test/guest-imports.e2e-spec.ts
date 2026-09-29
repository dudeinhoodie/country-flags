import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  DeckAccessModel,
  DeckKind,
  DeckStatus,
  EntitlementGrantSource,
  EntitlementGrantStatus,
  GuestImportStatus,
  PrismaClient,
  TimeConfidence,
  UserStatus,
} from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import {
  guestImportRequestHash,
  parseGuestImportRequest,
} from "../src/modules/account-lifecycle/guest-import.request";
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";
import { TEST_CONTENT_FIXTURE } from "../src/modules/content/fixtures/test-content.fixture";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { reviewedTodayCount } from "../src/modules/progress/daily-review-limit";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";

const FREE_DECK_ID = "70000000-0000-4000-8000-000000000001";
const PAID_DECK_ID = "70000000-0000-4000-8000-00000000045a";
const ENTITLEMENT_KEY = "entitlement.test_only_guest_import";
const DAY_MS = 24 * 60 * 60 * 1000;

interface ImportResultBody {
  migrationId: string;
  status: string;
  acceptedEventCount: number;
  duplicateEventCount: number;
  rejectedEventCount: number;
}

interface GuestReview {
  id: string;
  sessionId: string;
  learningCardId: string;
  answerMode: "SELF_RATED";
  rating: "GOOD";
  clientOccurredAt: string;
  clientSequence: number;
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/**
 * The guest import, end to end: when the imported reviews happened, which
 * decks a guest session may land in, and what a retried request does while
 * the first one is still running.
 */
describe("guest progress import (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    TEST_AUTH_ENABLED: process.env.TEST_AUTH_ENABLED,
  };
  const databaseName =
    `country_flags_guest_import_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestJwtSigner;
  let freeCardIds: string[];
  let paidCardIds: string[];
  let releasePublishedAt: Date;

  /** A fresh account per test, so no test reads another's day or cards. */
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

  function session(id: string, deckId = FREE_DECK_ID): Record<string, unknown> {
    return {
      id,
      deckId,
      mode: "SELF_RATED",
      requestedUniqueCount: 5,
      contentVersion: TEST_CONTENT_FIXTURE.version,
      startedAt: new Date(releasePublishedAt.getTime() + DAY_MS).toISOString(),
    };
  }

  function review(
    sessionId: string,
    learningCardId: string,
    clientOccurredAt: Date,
    clientSequence: number,
  ): GuestReview {
    return {
      id: randomUUID(),
      sessionId,
      learningCardId,
      answerMode: "SELF_RATED",
      rating: "GOOD",
      clientOccurredAt: clientOccurredAt.toISOString(),
      clientSequence,
    };
  }

  async function submit(
    token: string,
    payload: Record<string, unknown>,
  ): Promise<ImportResultBody> {
    const response = await request(httpServer)
      .post("/v1/me/guest-imports")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)
      .expect(202);
    return response.body as ImportResultBody;
  }

  async function settled(
    token: string,
    migrationId: string,
  ): Promise<ImportResultBody> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await request(httpServer)
        .get(`/v1/me/guest-imports/${migrationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const body = response.body as ImportResultBody;
      if (body.status !== "PENDING") {
        return body;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`Guest import ${migrationId} never settled`);
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for guest import tests");
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
        `Guest import test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    await importTestContent(database);
    await importTestStudySeed(database);

    // Pinned relative to the clock the suite runs under: the release is
    // the floor of a guest's clock, and a fixed date would drift into the
    // test's own window.
    releasePublishedAt = new Date(Date.now() - 60 * DAY_MS);
    await database.contentRelease.update({
      where: { version: TEST_CONTENT_FIXTURE.version },
      data: { publishedAt: releasePublishedAt },
    });

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
    freeCardIds = memberships.map(({ learningCardId }) => learningCardId);
    if (freeCardIds.length !== 5) {
      throw new Error("Guest import fixture expects five free cards");
    }

    // The paid deck reuses two free cards: what is refused is the deck a
    // guest session claims to have studied, not a country.
    paidCardIds = freeCardIds.slice(0, 2);
    await database.entitlementDefinition.create({
      data: { key: ENTITLEMENT_KEY, description: "TEST_ONLY paid deck" },
    });
    await database.deck.create({
      data: {
        id: PAID_DECK_ID,
        code: "PAID_GUEST_IMPORT_TEST",
        kind: DeckKind.CURATED,
        status: DeckStatus.PUBLISHED,
        accessModel: DeckAccessModel.ENTITLEMENT,
        requiredEntitlementKey: ENTITLEMENT_KEY,
        contentVersion: TEST_CONTENT_FIXTURE.version,
        localizations: {
          create: [
            { locale: "en", name: "Paid test deck", description: "TEST_ONLY" },
          ],
        },
        cards: {
          create: paidCardIds.map((learningCardId, index) => ({
            learningCardId,
            sortOrder: index + 1,
          })),
        },
      },
    });
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

  it("keeps the days a guest studied on instead of the moment of the import", async () => {
    const { userId, token } = await account();
    const sessionId = randomUUID();
    const now = Date.now();
    const twoWeeksAgo = new Date(now - 14 * DAY_MS);
    const reviews = [
      // A clock set back past the release: bounded to its publication.
      review(sessionId, freeCardIds[0]!, new Date("2001-01-01T00:00:00Z"), 1),
      review(sessionId, freeCardIds[1]!, twoWeeksAgo, 2),
      review(
        sessionId,
        freeCardIds[2]!,
        new Date(twoWeeksAgo.getTime() + 60_000),
        3,
      ),
      review(sessionId, freeCardIds[3]!, new Date(now - 1_000), 4),
      // A clock set forward: bounded to the moment the server got it.
      review(sessionId, freeCardIds[4]!, new Date(now + 30 * DAY_MS), 5),
    ];
    const result = await submit(token, {
      payloadVersion: 1,
      migrationId: randomUUID(),
      sourceInstallId: `guest-install-${randomUUID()}`,
      sessions: [session(sessionId)],
      reviews,
    });
    expect(result).toMatchObject({
      status: "APPLIED",
      acceptedEventCount: 5,
      rejectedEventCount: 0,
    });

    const stored = await database.reviewEvent.findMany({
      where: { userId },
      orderBy: { clientSequence: "asc" },
      select: {
        effectiveOccurredAt: true,
        receivedAt: true,
        timeConfidence: true,
        estimatedServerOccurredAt: true,
      },
    });
    expect(stored).toHaveLength(5);
    expect(stored[0]).toMatchObject({
      effectiveOccurredAt: releasePublishedAt,
      timeConfidence: TimeConfidence.BOUNDED,
    });
    expect(
      stored.slice(1, 4).map((event) => ({
        effectiveOccurredAt: event.effectiveOccurredAt.toISOString(),
        timeConfidence: event.timeConfidence,
        estimatedServerOccurredAt: event.estimatedServerOccurredAt,
      })),
    ).toEqual(
      reviews.slice(1, 4).map(({ clientOccurredAt }) => ({
        effectiveOccurredAt: clientOccurredAt,
        timeConfidence: TimeConfidence.CLIENT_CLOCK,
        // The raw record stays raw: the guest sent no estimate.
        estimatedServerOccurredAt: null,
      })),
    );
    expect(stored[4]!.timeConfidence).toBe(TimeConfidence.BOUNDED);
    expect(stored[4]!.effectiveOccurredAt).toEqual(stored[4]!.receivedAt);

    // Two weeks of study no longer spend today's limit: only the review
    // answered today and the one whose clock ran ahead count.
    await expect(
      database.$transaction((transaction) =>
        reviewedTodayCount(transaction, userId, "UTC"),
      ),
    ).resolves.toBe(2);
  });

  it("refuses a guest session on a paid deck the account does not own, and only that session", async () => {
    const { userId, token } = await account();
    const freeSessionId = randomUUID();
    const paidSessionId = randomUUID();
    const studiedAt = new Date(Date.now() - 3 * DAY_MS);
    const payload = {
      payloadVersion: 1,
      migrationId: randomUUID(),
      sourceInstallId: `guest-install-${randomUUID()}`,
      sessions: [session(freeSessionId), session(paidSessionId, PAID_DECK_ID)],
      reviews: [
        review(freeSessionId, freeCardIds[3]!, studiedAt, 1),
        review(paidSessionId, paidCardIds[0]!, studiedAt, 2),
      ],
    };

    await expect(submit(token, payload)).resolves.toMatchObject({
      status: "PARTIAL",
      acceptedEventCount: 1,
      rejectedEventCount: 1,
    });
    await expect(
      database.studySession.count({ where: { id: paidSessionId } }),
    ).resolves.toBe(0);
    await expect(
      database.reviewEvent.count({
        where: { userId, sessionId: paidSessionId },
      }),
    ).resolves.toBe(0);

    const owner = await account();
    await database.userEntitlementGrant.create({
      data: {
        userId: owner.userId,
        entitlementKey: ENTITLEMENT_KEY,
        sourceType: EntitlementGrantSource.MIGRATION,
        status: EntitlementGrantStatus.ACTIVE,
      },
    });
    const ownedSessionId = randomUUID();
    await expect(
      submit(owner.token, {
        payloadVersion: 1,
        migrationId: randomUUID(),
        sourceInstallId: `guest-install-${randomUUID()}`,
        sessions: [session(ownedSessionId, PAID_DECK_ID)],
        reviews: [review(ownedSessionId, paidCardIds[0]!, studiedAt, 1)],
      }),
    ).resolves.toMatchObject({ status: "APPLIED", acceptedEventCount: 1 });
  });

  it("runs a retried import once while the first attempt is still running", async () => {
    const { userId, token } = await account();
    const sessionId = randomUUID();
    const migrationId = randomUUID();
    const studiedAt = Date.now() - 5 * DAY_MS;
    const payload = {
      payloadVersion: 1,
      migrationId,
      sourceInstallId: `guest-install-${randomUUID()}`,
      sessions: [session(sessionId)],
      reviews: freeCardIds.map((cardId, index) =>
        review(
          sessionId,
          cardId,
          new Date(studiedAt + index * 60_000),
          index + 1,
        ),
      ),
    };

    const [first, second] = await Promise.all([
      submit(token, payload),
      submit(token, payload),
    ]);
    for (const body of [first, second]) {
      expect(["PENDING", "APPLIED"]).toContain(body.status);
    }
    await expect(settled(token, migrationId)).resolves.toMatchObject({
      status: "APPLIED",
      acceptedEventCount: 5,
      duplicateEventCount: 0,
      rejectedEventCount: 0,
    });
    // One attempt ran: one outcome was written, every review exists once.
    await expect(
      database.auditEvent.count({
        where: {
          action: "ACCOUNT_GUEST_PROGRESS_IMPORTED",
          targetId: migrationId,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.reviewEvent.count({ where: { userId } }),
    ).resolves.toBe(5);
  });

  it("waits for a live attempt, takes over a dead one, and lets a newer payload supersede", async () => {
    const { userId, token } = await account();
    const sessionId = randomUUID();
    const migrationId = randomUUID();
    const sourceInstallId = `guest-install-${randomUUID()}`;
    const studiedAt = Date.now() - 2 * DAY_MS;
    const payload = {
      payloadVersion: 1,
      migrationId,
      sourceInstallId,
      sessions: [session(sessionId)],
      reviews: [review(sessionId, freeCardIds[0]!, new Date(studiedAt), 1)],
    };
    const secret = app
      .get(ConfigService)
      .getOrThrow<string>("ACCOUNT_DATA_HASH_SECRET");
    // Another instance holds the import and is still renewing its lease.
    await database.guestImportOperation.create({
      data: {
        id: migrationId,
        userId,
        sourceInstallIdHash: createHmac("sha256", secret)
          .update(`${userId}:${sourceInstallId}`)
          .digest("hex"),
        requestHash: guestImportRequestHash(parseGuestImportRequest(payload)),
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(submit(token, payload)).resolves.toMatchObject({
      status: "PENDING",
      acceptedEventCount: 0,
    });
    await expect(
      database.reviewEvent.count({ where: { userId } }),
    ).resolves.toBe(0);

    // The instance died: its lease ran out, and the retry resumes.
    await database.guestImportOperation.update({
      where: { id: migrationId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(submit(token, payload)).resolves.toMatchObject({
      status: "APPLIED",
      acceptedEventCount: 1,
    });

    // A newer payload for an import still in flight replaces the attempt
    // running the old one rather than waiting for it to finish stale.
    const supersededId = randomUUID();
    const newerSessionId = randomUUID();
    const newer = {
      payloadVersion: 1,
      migrationId: supersededId,
      sourceInstallId,
      sessions: [session(newerSessionId)],
      reviews: [
        review(newerSessionId, freeCardIds[1]!, new Date(studiedAt), 2),
        review(newerSessionId, freeCardIds[2]!, new Date(studiedAt + 1_000), 3),
      ],
    };
    await database.guestImportOperation.create({
      data: {
        id: supersededId,
        userId,
        sourceInstallIdHash: createHmac("sha256", secret)
          .update(`${userId}:${sourceInstallId}`)
          .digest("hex"),
        requestHash: "0".repeat(64),
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(submit(token, newer)).resolves.toMatchObject({
      status: "APPLIED",
      acceptedEventCount: 2,
    });
    await expect(
      database.guestImportOperation.findUniqueOrThrow({
        where: { id: supersededId },
        select: { status: true, leaseToken: true, leaseExpiresAt: true },
      }),
    ).resolves.toEqual({
      status: GuestImportStatus.APPLIED,
      leaseToken: null,
      leaseExpiresAt: null,
    });
  });
});
