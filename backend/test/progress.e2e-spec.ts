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
import { ProgressService } from "../src/modules/progress/progress.service";
import {
  TEST_STUDY_DEVICE_ID,
  TEST_STUDY_USER_ID,
} from "../src/modules/study-sessions/fixtures/test-study.fixture";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";

interface SessionBody {
  cards: Array<{ learningCard: { id: string } }>;
}

interface ScopeProgressBody {
  deckId?: string;
  regionId?: string;
  totalCards: number;
  learnedCards: number;
  dueCards: number;
  reviewCount: number;
  accuracy30Days: number;
  currentMasteryTier: string;
  highestAchievementTier: string;
  ruleVersion: number;
}

interface AccountProgressBody extends ScopeProgressBody {
  decks: ScopeProgressBody[];
  regions: ScopeProgressBody[];
}

interface AchievementPageBody {
  items: Array<{
    id: string;
    code: string;
    tier: string;
    scopeType: string;
    scopeId: string;
    earned: boolean;
    ruleVersion: number;
    evidence: Record<string, unknown>;
  }>;
  page: { nextCursor: string | null; hasMore: boolean };
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

describe("progress, mastery and achievements (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_progress_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let accessToken: string;
  let reviewedCardIds: string[];

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for progress integration tests",
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
        `Progress test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    const session = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: "95000000-0000-4000-8000-000000000001",
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 20,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const sessionBody = session.body as unknown as SessionBody;
    const europeCardIds = new Set(
      (
        await database.geoRelation.findMany({
          where: {
            parentEntityId: "30000000-0000-4000-8000-000000000101",
            relationType: "CONTAINS",
          },
          select: {
            child: {
              select: {
                learningCards: {
                  where: { status: "ACTIVE" },
                  select: { id: true },
                },
              },
            },
          },
        })
      ).flatMap(({ child }) => child.learningCards.map(({ id }) => id)),
    );
    reviewedCardIds = sessionBody.cards
      .map(({ learningCard }) => learningCard.id)
      .filter((id) => europeCardIds.has(id))
      .slice(0, 5);
    if (reviewedCardIds.length !== 5) {
      throw new Error("Progress fixture has fewer than five European cards");
    }
    const occurredAt = new Date().toISOString();
    await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        payloadVersion: 1,
        // One answer each, and two more for the first card: learned is three
        // correct answers, so the fixture has to contain a card that reaches
        // it or the assertion below would only be pinning zero.
        events: [
          ...reviewedCardIds,
          reviewedCardIds[0],
          reviewedCardIds[0],
        ].map((learningCardId, index) => ({
          id: `96000000-0000-4000-8000-${(index + 1)
            .toString()
            .padStart(12, "0")}`,
          sessionId: "95000000-0000-4000-8000-000000000001",
          learningCardId,
          deviceId: TEST_STUDY_DEVICE_ID,
          answerMode: "SELF_RATED",
          rating: "GOOD",
          responseTimeMs: 1_000,
          clientOccurredAt: occurredAt,
          estimatedServerOccurredAt: occurredAt,
          clientSequence: index + 1,
          baseStateVersion: null,
        })),
      })
      .expect(200);
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

  it("returns consistent account, deck, region and due aggregates", async () => {
    const accountResponse = await request(httpServer)
      .get("/v1/me/progress")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const account = accountResponse.body as unknown as AccountProgressBody;
    const allDeck = account.decks.find(
      ({ deckId }) => deckId === "70000000-0000-4000-8000-000000000001",
    );
    const europeDeck = account.decks.find(
      ({ deckId }) => deckId === "70000000-0000-4000-8000-000000000002",
    );
    const europeRegion = account.regions.find(
      ({ regionId }) => regionId === "30000000-0000-4000-8000-000000000101",
    );

    expect(account).toMatchObject({
      totalCards: 8,
      learnedCards: 1,
      reviewCount: 7,
      accuracy30Days: 1,
      currentMasteryTier: "BRONZE",
      highestAchievementTier: "BRONZE",
      ruleVersion: 1,
    });
    expect(allDeck).toMatchObject({
      totalCards: 8,
      learnedCards: 1,
      reviewCount: 7,
      currentMasteryTier: "BRONZE",
      highestAchievementTier: "BRONZE",
    });
    expect(europeDeck).toMatchObject({
      totalCards: 7,
      learnedCards: 1,
      currentMasteryTier: "BRONZE",
    });
    expect(europeRegion).toMatchObject({
      totalCards: 7,
      learnedCards: 1,
      currentMasteryTier: "BRONZE",
    });

    const deckResponse = await request(httpServer)
      .get("/v1/me/decks/70000000-0000-4000-8000-000000000001/progress")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const deckBody = deckResponse.body as unknown as ScopeProgressBody & {
      updatedAt: string;
    };
    expect(deckBody).toMatchObject({
      totalCards: allDeck?.totalCards,
      learnedCards: allDeck?.learnedCards,
      dueCards: allDeck?.dueCards,
      reviewCount: allDeck?.reviewCount,
      currentMasteryTier: allDeck?.currentMasteryTier,
      highestAchievementTier: allDeck?.highestAchievementTier,
      ruleVersion: allDeck?.ruleVersion,
    });
    expect(typeof deckBody.updatedAt).toBe("string");

    const due = await request(httpServer)
      .get("/v1/me/due-summary")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const dueBody = due.body as unknown as {
      newCards: number;
      totalDue: number;
      review: number;
    };
    expect(dueBody).toMatchObject({
      newCards: 3,
    });
    expect(typeof dueBody.totalDue).toBe("number");
    expect(typeof dueBody.review).toBe("number");
  });

  it("grants each mastery achievement once and paginates locale-neutral evidence", async () => {
    const countBefore = await database.userAchievement.count({
      where: { userId: TEST_STUDY_USER_ID },
    });
    expect(countBefore).toBeGreaterThanOrEqual(3);

    const progress = app.get(ProgressService);
    await Promise.all([
      progress.rebuildUser(TEST_STUDY_USER_ID),
      progress.rebuildUser(TEST_STUDY_USER_ID),
    ]);
    await expect(
      database.userAchievement.count({
        where: { userId: TEST_STUDY_USER_ID },
      }),
    ).resolves.toBe(countBefore);

    const firstResponse = await request(httpServer)
      .get("/v1/me/achievements?limit=1")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const first = firstResponse.body as unknown as AchievementPageBody;
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      code: "MASTERY_BRONZE",
      tier: "BRONZE",
      earned: true,
      ruleVersion: 1,
      evidence: {
        masteryRuleVersion: 1,
      },
    });
    expect(first.items[0]).not.toHaveProperty("title");
    expect(first.items[0]).not.toHaveProperty("description");
    expect(first.page).toMatchObject({ hasMore: true });

    const secondResponse = await request(httpServer)
      .get(
        `/v1/me/achievements?limit=100&cursor=${encodeURIComponent(
          first.page.nextCursor ?? "",
        )}`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const second = secondResponse.body as unknown as AchievementPageBody;
    expect(second.items.length).toBe(countBefore - 1);
    expect(second.items.map(({ id }) => id)).not.toContain(first.items[0]?.id);
  });

  it("rebuilds cache from immutable history without resetting technical revisions", async () => {
    const before = await app
      .get(ProgressService)
      .getDeckProgress(
        TEST_STUDY_USER_ID,
        "70000000-0000-4000-8000-000000000001",
      );
    const technicalCardId = reviewedCardIds[0]!;
    const currentRevision =
      await database.learningCardRevision.findFirstOrThrow({
        where: { learningCardId: technicalCardId, retiredAt: null },
      });
    await database.learningCardRevision.update({
      where: { id: currentRevision.id },
      data: {
        promptFingerprint: `${currentRevision.promptFingerprint}-technical`,
      },
    });
    await database.userDeckMastery.deleteMany({
      where: { userId: TEST_STUDY_USER_ID },
    });

    const rebuilt = await app
      .get(ProgressService)
      .getDeckProgress(
        TEST_STUDY_USER_ID,
        "70000000-0000-4000-8000-000000000001",
      );
    expect(rebuilt).toMatchObject({
      learnedCards: before.learnedCards,
      reviewCount: before.reviewCount,
      currentMasteryTier: before.currentMasteryTier,
      highestAchievementTier: before.highestAchievementTier,
    });
    await expect(
      database.userDeckMastery.count({
        where: { userId: TEST_STUDY_USER_ID },
      }),
    ).resolves.toBe(2);
  });
});
