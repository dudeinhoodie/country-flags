import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  ContentChangeOperation,
  ContentReleaseStatus,
  ContentResourceType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { importTestContent } from "../src/modules/content/import/test-content-importer";

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

interface Page {
  nextCursor: string | null;
  hasMore: boolean;
}

interface DeckPageBody {
  items: Array<{
    id: string;
    code: string;
    kind: string;
    name: string;
    description: string;
    cardCount: number;
    contentVersion: string;
  }>;
  page: Page;
}

interface CardPageBody {
  items: Array<{
    id: string;
    semanticVersion: number;
    revision: number;
    answer: { displayName: string };
  }>;
  page: Page;
}

interface ErrorBody {
  error: {
    code: string;
    requestId: string;
    details: Record<string, unknown>;
  };
}

describe("content fixture and read API (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const databaseName =
    `country_flags_content_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for content integration tests");
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
        },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Content test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
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
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    await app?.close();
    if (admin !== undefined) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
  });

  it("imports the TEST_ONLY fixture twice without duplicates", async () => {
    const first = await importTestContent(database);
    const countsAfterFirst = await Promise.all([
      database.geoEntity.count(),
      database.asset.count(),
      database.learningCard.count(),
      database.learningCardRevision.count(),
      database.deck.count(),
      database.deckCard.count(),
    ]);
    const second = await importTestContent(database);
    const countsAfterSecond = await Promise.all([
      database.geoEntity.count(),
      database.asset.count(),
      database.learningCard.count(),
      database.learningCardRevision.count(),
      database.deck.count(),
      database.deckCard.count(),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      marker: "TEST_ONLY",
      entities: 10,
      assets: 10,
      cards: 9,
      decks: 2,
    });
    expect(countsAfterFirst).toEqual([10, 10, 9, 10, 2, 15]);
    expect(countsAfterSecond).toEqual(countsAfterFirst);

    const release = await database.contentRelease.findUniqueOrThrow({
      where: { version: first.version },
    });
    expect(release.metadata).toMatchObject({ marker: "TEST_ONLY" });
  });

  it("models partial recognition, transcontinental taxonomy, and revisions", async () => {
    const [kosovo, russia, kazakhstan, switzerland] = await Promise.all([
      database.geoEntity.findUniqueOrThrow({
        where: { contentKey: "country.kosovo" },
      }),
      database.geoEntity.findUniqueOrThrow({
        where: { contentKey: "country.russia" },
        include: {
          childRelations: true,
          learningCards: {
            orderBy: { semanticVersion: "asc" },
            include: { revisions: true },
          },
        },
      }),
      database.geoEntity.findUniqueOrThrow({
        where: { contentKey: "country.kazakhstan" },
        include: { childRelations: true },
      }),
      database.geoEntity.findUniqueOrThrow({
        where: { contentKey: "country.switzerland" },
        include: {
          learningCards: {
            include: {
              revisions: { orderBy: { revision: "asc" } },
            },
          },
        },
      }),
    ]);

    expect(kosovo).toMatchObject({
      recognitionStatus: "PARTIALLY_RECOGNIZED",
      isoAlpha2: null,
      isoAlpha3: null,
      m49Code: null,
    });
    expect(russia.childRelations).toHaveLength(2);
    expect(kazakhstan.childRelations).toHaveLength(2);
    expect(russia.learningCards).toMatchObject([
      { semanticVersion: 1, status: "RETIRED" },
      {
        semanticVersion: 2,
        status: "ACTIVE",
        supersedesLearningCardId: russia.learningCards[0]?.id,
      },
    ]);
    expect(russia.learningCards[0]?.revisions[0]?.promptAssetId).not.toBe(
      russia.learningCards[1]?.revisions[0]?.promptAssetId,
    );
    expect(switzerland.learningCards).toHaveLength(1);
    expect(switzerland.learningCards[0]?.revisions).toMatchObject([
      { revision: 1, progressPolicy: "PRESERVE" },
      { revision: 2, progressPolicy: "PRESERVE", retiredAt: null },
    ]);
  });

  it("returns a cacheable manifest matching the canonical contract", async () => {
    const response = await request(httpServer)
      .get("/v1/content/manifest")
      .query({ locale: "ru" })
      .expect(200);
    const body = response.body as unknown as Record<string, unknown>;

    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}"$/u);
    expect(body).toMatchObject({
      schemaVersion: 1,
      contentVersion: "test-only-fixture-v1",
      defaultLocale: "ru",
      supportedLocales: ["ru", "en"],
      minimumClientVersion: "1.0.0",
      supportedTemplateSchemaVersions: [1],
      signature: {
        algorithm: "Ed25519",
        keyId: "TEST_ONLY",
      },
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        "$schema",
        "assetBaseUrl",
        "changeCursor",
        "contentVersion",
        "createdAt",
        "defaultLocale",
        "files",
        "minimumClientVersion",
        "schemaVersion",
        "signature",
        "supportedLocales",
        "supportedTemplateSchemaVersions",
      ].sort(),
    );

    await request(httpServer)
      .get("/v1/content/manifest")
      .query({ locale: "ru" })
      .set("If-None-Match", String(response.headers.etag))
      .expect(304);
  });

  it("paginates decks stably and falls back to the default locale", async () => {
    const firstPage = await request(httpServer)
      .get("/v1/decks")
      .query({ locale: "en", limit: 1 })
      .expect(200);
    const firstBody = firstPage.body as unknown as DeckPageBody;
    expect(firstBody).toMatchObject({
      items: [{ code: "ALL", name: "All countries", cardCount: 8 }],
      page: { hasMore: true },
    });
    expect(typeof firstBody.page.nextCursor).toBe("string");

    const secondPage = await request(httpServer)
      .get("/v1/decks")
      .query({
        locale: "en",
        limit: 1,
        cursor: String(firstBody.page.nextCursor),
      })
      .expect(200);
    const secondBody = secondPage.body as unknown as DeckPageBody;
    expect(secondBody).toEqual({
      items: [
        {
          id: "70000000-0000-4000-8000-000000000002",
          code: "EUROPE",
          kind: "TAXONOMY",
          name: "Europe",
          description: "European and transcontinental countries",
          cardCount: 7,
          contentVersion: "test-only-fixture-v1",
        },
      ],
      page: { nextCursor: null, hasMore: false },
    });

    const fallback = await request(httpServer)
      .get("/v1/decks")
      .query({ locale: "fr" })
      .expect(200);
    const fallbackBody = fallback.body as unknown as DeckPageBody;
    expect(fallbackBody.items[0]).toMatchObject({ name: "Все страны" });
  });

  it("returns each active card once with current revisions", async () => {
    const deckId = "70000000-0000-4000-8000-000000000001";
    const firstPage = await request(httpServer)
      .get(`/v1/decks/${deckId}/cards`)
      .query({ locale: "en", limit: 5 })
      .expect(200);
    const firstBody = firstPage.body as unknown as CardPageBody;
    const secondPage = await request(httpServer)
      .get(`/v1/decks/${deckId}/cards`)
      .query({
        locale: "en",
        limit: 5,
        cursor: String(firstBody.page.nextCursor),
      })
      .expect(200);
    const secondBody = secondPage.body as unknown as CardPageBody;
    const cards = [...firstBody.items, ...secondBody.items];
    const ids = cards.map(({ id }) => id);
    const russia = cards.find(({ answer }) => answer.displayName === "Russia");
    const switzerland = cards.find(
      ({ answer }) => answer.displayName === "Switzerland",
    );

    expect(firstBody.page.hasMore).toBe(true);
    expect(secondBody.page).toEqual({
      nextCursor: null,
      hasMore: false,
    });
    expect(cards).toHaveLength(8);
    expect(new Set(ids)).toHaveProperty("size", 8);
    expect(russia).toMatchObject({ semanticVersion: 2 });
    expect(switzerland).toMatchObject({ semanticVersion: 1, revision: 2 });
  });

  it("uses the canonical error envelope for invalid cursors and missing decks", async () => {
    const invalidCursor = await request(httpServer)
      .get("/v1/decks")
      .query({ locale: "ru", cursor: "not-a-cursor" })
      .expect(400);
    const invalidCursorBody = invalidCursor.body as unknown as ErrorBody;
    expect(invalidCursorBody.error.code).toBe("VALIDATION_FAILED");
    expect(invalidCursorBody.error.requestId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(invalidCursorBody.error.details).toEqual({});

    const missing = await request(httpServer)
      .get("/v1/decks/ffffffff-ffff-4fff-8fff-ffffffffffff/cards")
      .query({ locale: "ru" })
      .expect(404);
    const missingBody = missing.body as unknown as ErrorBody;
    expect(missingBody.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(missingBody.error.requestId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(missingBody.error.details).toEqual({});
  });

  it("repeats content pages stably and represents deletion as a tombstone", async () => {
    const manifest = await request(httpServer)
      .get("/v1/content/manifest")
      .query({ locale: "en" })
      .expect(200);
    const after = String(
      (manifest.body as unknown as { changeCursor: string }).changeCursor,
    );
    const retiredResourceId = "10000000-0000-4000-8000-000000000001";
    await database.$transaction([
      database.contentRelease.create({
        data: {
          version: "test-only-fixture-v2",
          schemaVersion: 1,
          status: ContentReleaseStatus.PUBLISHED,
          manifestChecksum: "2".repeat(64),
          metadata: { marker: "TEST_ONLY", manifest: {} },
          publishedAt: new Date(),
        },
      }),
      database.contentChange.create({
        data: {
          contentVersion: "test-only-fixture-v2",
          operation: ContentChangeOperation.RETIRE,
          resourceType: ContentResourceType.ENTITY,
          resourceId: retiredResourceId,
          payload: Prisma.DbNull,
        },
      }),
      database.contentPointer.update({
        where: { key: "active" },
        data: { contentVersion: "test-only-fixture-v2" },
      }),
    ]);

    const first = await request(httpServer)
      .get("/v1/content/changes")
      .query({ locale: "en", after, limit: 100 })
      .expect(200);
    const repeated = await request(httpServer)
      .get("/v1/content/changes")
      .query({ locale: "en", after, limit: 100 })
      .expect(200);

    expect(repeated.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      items: [
        {
          operation: "RETIRE",
          resourceType: "ENTITY",
          resourceId: retiredResourceId,
          contentVersion: "test-only-fixture-v2",
        },
      ],
      hasMore: false,
      contentVersion: "test-only-fixture-v2",
    });
    expect((first.body as { items: unknown[] }).items[0]).not.toHaveProperty(
      "payload",
    );
  });
});
