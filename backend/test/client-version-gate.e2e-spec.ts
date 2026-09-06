// Must be the first import: it fixes the minimum client version before
// app.module.ts snapshots process.env through ConfigModule.forRoot, which is
// the whole subject of this suite.
import {
  originalMinimumClientVersions,
  PAID_AWARE_CLIENT as CURRENT_CLIENT,
  PAID_UNAWARE_CLIENT as OLD_CLIENT,
  UNIDENTIFIED_CLIENT as ANONYMOUS_CLIENT,
} from "./paid-content-client.environment";

import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  CardStatus,
  CommerceOfferStatus,
  ContentChangeOperation,
  ContentResourceType,
  DeckAccessModel,
  DeckKind,
  DeckStatus,
  PrismaClient,
} from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { importTestContent } from "../src/modules/content/import/test-content-importer";

const CONTENT_VERSION = "test-only-fixture-v1";
const FREE_DECK_ID = "70000000-0000-4000-8000-000000000001";
const PAID_DECK_ID = "70000000-0000-4000-8000-00000000000a";
const ENTITLEMENT_KEY = "entitlement.test_only_paid";
const OFFER_CODE = "TEST_ONLY_PAID_LIFETIME";

interface DeckBody {
  id: string;
  code: string;
  access: { model: string };
}

interface DeckPageBody {
  items: DeckBody[];
}

interface ChangeBody {
  operation: string;
  resourceType: string;
  resourceId: string;
}

interface ChangePageBody {
  items: ChangeBody[];
  nextCursor: string;
  hasMore: boolean;
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/**
 * The minimum-client-version gate, end to end.
 *
 * The failure it exists to prevent is an ordering mistake rather than an
 * attack: publish a paid deck before the client that understands one exists,
 * and every installed app draws the locked deck as an ordinary free one,
 * offers to study it and walks the user into a 403 it has no words for
 * (docs/17-paid-decks-storekit.md §20).
 *
 * So the question here is never "may this user open the deck" — the
 * entitlement guard owns that and is tested next door. It is "can this build
 * make sense of the answer", and a build that cannot is served the app it has
 * always had: every free deck, every RETIRE, and nothing that mentions a deck
 * it cannot draw.
 */
describe("minimum client version gate (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const databaseName =
    `country_flags_client_gate_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let changeCursor: string;
  let previewCardId: string;
  let lockedCardId: string;

  async function changesFor(
    headers: Record<string, string>,
  ): Promise<ChangePageBody> {
    const response = await request(httpServer)
      .get("/v1/content/changes")
      .set(headers)
      .query({ locale: "en", after: changeCursor, limit: 100 })
      .expect(200);
    return response.body as ChangePageBody;
  }

  async function decksFor(
    headers: Record<string, string>,
  ): Promise<DeckPageBody> {
    const response = await request(httpServer)
      .get("/v1/decks")
      .set(headers)
      .query({ locale: "en", limit: 100 })
      .expect(200);
    return response.body as DeckPageBody;
  }

  /**
   * A locked deck holding two cards nothing free reaches: one the editor
   * published as the deck's shop window, one closed. Both are moved out of
   * the free deck rather than invented, so the fixture stays the release the
   * other suites use.
   */
  async function seedLockedDeck(): Promise<void> {
    const memberships = await database.deckCard.findMany({
      where: {
        deckId: FREE_DECK_ID,
        learningCard: { status: CardStatus.ACTIVE },
      },
      orderBy: { sortOrder: "asc" },
      take: 2,
      select: { learningCardId: true },
    });
    if (memberships.length !== 2) {
      throw new Error("Client gate fixture expects two free deck cards");
    }
    previewCardId = memberships[0]!.learningCardId;
    lockedCardId = memberships[1]!.learningCardId;
    // Out of every free deck, not just the one they were read from: a card a
    // second free deck still reaches is public, and would prove nothing here.
    await database.deckCard.deleteMany({
      where: { learningCardId: { in: [previewCardId, lockedCardId] } },
    });

    await database.entitlementDefinition.create({
      data: { key: ENTITLEMENT_KEY, description: "TEST_ONLY paid deck" },
    });
    await database.commerceOffer.create({
      data: {
        code: OFFER_CODE,
        status: CommerceOfferStatus.ACTIVE,
        sortOrder: 10,
        grants: { create: { entitlementKey: ENTITLEMENT_KEY } },
      },
    });
    await database.deck.create({
      data: {
        id: PAID_DECK_ID,
        code: "PAID_TEST",
        kind: DeckKind.CURATED,
        status: DeckStatus.PUBLISHED,
        accessModel: DeckAccessModel.ENTITLEMENT,
        requiredEntitlementKey: ENTITLEMENT_KEY,
        contentVersion: CONTENT_VERSION,
        localizations: {
          create: [
            {
              locale: "en",
              name: "Paid test deck",
              description: "A deck an entitlement opens",
            },
          ],
        },
        cards: {
          create: [
            { learningCardId: previewCardId, sortOrder: 1, isPreview: true },
            { learningCardId: lockedCardId, sortOrder: 2, isPreview: false },
          ],
        },
      },
    });

    // What publishing this release would have announced.
    for (const [operation, resourceType, resourceId] of [
      [ContentChangeOperation.UPSERT, ContentResourceType.DECK, FREE_DECK_ID],
      [ContentChangeOperation.UPSERT, ContentResourceType.DECK, PAID_DECK_ID],
      [
        ContentChangeOperation.UPSERT,
        ContentResourceType.LEARNING_CARD,
        previewCardId,
      ],
      [
        ContentChangeOperation.UPSERT,
        ContentResourceType.LEARNING_CARD,
        lockedCardId,
      ],
      // A withdrawal, which every build has to hear about whatever it can
      // draw: a client that is never told keeps withdrawn content for good.
      [ContentChangeOperation.RETIRE, ContentResourceType.DECK, PAID_DECK_ID],
    ] as const) {
      await database.contentChange.create({
        data: {
          contentVersion: CONTENT_VERSION,
          operation,
          resourceType,
          resourceId,
        },
      });
    }
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for client version gate integration tests",
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
          DIRECT_DATABASE_URL: testDatabaseUrl,
        },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Client gate test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.NODE_ENV = "test";
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
    await seedLockedDeck();

    const manifest = await request(httpServer)
      .get("/v1/content/manifest")
      .query({ locale: "en" })
      .expect(200);
    changeCursor = String(
      (manifest.body as unknown as { changeCursor: string }).changeCursor,
    );
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.NODE_ENV = originalNodeEnvironment;
    process.env.PAID_CONTENT_MINIMUM_CLIENT_VERSIONS =
      originalMinimumClientVersions;
    await app?.close();
    if (admin !== undefined) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
  });

  describe("the catalog", () => {
    it("shows a current build the locked deck, exactly as it does today", async () => {
      const body = await decksFor(CURRENT_CLIENT);
      const paid = body.items.find(({ id }) => id === PAID_DECK_ID);

      expect(paid).toMatchObject({
        code: "PAID_TEST",
        access: { model: "ENTITLEMENT" },
      });
      expect(body.items.some(({ id }) => id === FREE_DECK_ID)).toBe(true);
    });

    it("shows an older build every free deck and no locked one", async () => {
      const current = await decksFor(CURRENT_CLIENT);
      const old = await decksFor(OLD_CLIENT);

      expect(old.items.some(({ id }) => id === PAID_DECK_ID)).toBe(false);
      expect(old.items.map(({ id }) => id)).toEqual(
        current.items
          .filter(({ access }) => access.model === "FREE")
          .map(({ id }) => id),
      );
      // The catalog it has always seen, not an error and not an empty list.
      expect(old.items.length).toBeGreaterThan(0);
      expect(old.items.every(({ access }) => access.model === "FREE")).toBe(
        true,
      );
    });

    it("treats a caller that sends no version as the oldest build there is", async () => {
      const anonymous = await decksFor(ANONYMOUS_CLIENT);

      expect(anonymous.items.some(({ id }) => id === PAID_DECK_ID)).toBe(false);
    });

    it("says the answer depends on the client headers, so no cache confuses two builds", async () => {
      const response = await request(httpServer)
        .get("/v1/decks")
        .set(OLD_CLIENT)
        .query({ locale: "en" })
        .expect(200);

      expect(response.headers["vary"]).toContain("x-client-app-version");
      expect(response.headers["vary"]).toContain("x-client-platform");
    });

    it("answers an older build's request for the locked deck the way it answers for one that was never published", async () => {
      await request(httpServer)
        .get(`/v1/decks/${PAID_DECK_ID}`)
        .set(OLD_CLIENT)
        .query({ locale: "en" })
        .expect(404);
      await request(httpServer)
        .get(`/v1/decks/${PAID_DECK_ID}`)
        .set(CURRENT_CLIENT)
        .query({ locale: "en" })
        .expect(200);
    });

    it("leaves an older build's free decks entirely alone", async () => {
      await request(httpServer)
        .get(`/v1/decks/${FREE_DECK_ID}`)
        .set(OLD_CLIENT)
        .query({ locale: "en" })
        .expect(200);
      await request(httpServer)
        .get(`/v1/decks/${FREE_DECK_ID}/cards`)
        .set(OLD_CLIENT)
        .query({ locale: "en", limit: 5 })
        .expect(200);
    });
  });

  describe("the change feed", () => {
    it("announces the locked deck and its shop window to a current build", async () => {
      const body = await changesFor(CURRENT_CLIENT);
      const upserts = body.items
        .filter(({ operation }) => operation === "UPSERT")
        .map(({ resourceId }) => resourceId);

      expect(upserts).toContain(PAID_DECK_ID);
      expect(upserts).toContain(previewCardId);
      // The closed card is withheld from everybody; that rule predates this
      // gate and is not weakened by it.
      expect(upserts).not.toContain(lockedCardId);
    });

    it("announces no locked deck to an older build, and no preview either", async () => {
      const body = await changesFor(OLD_CLIENT);
      const upserts = body.items
        .filter(({ operation }) => operation === "UPSERT")
        .map(({ resourceId }) => resourceId);

      expect(upserts).not.toContain(PAID_DECK_ID);
      // A preview is the locked deck's shop window, and this build has no
      // window to put it in.
      expect(upserts).not.toContain(previewCardId);
      expect(upserts).not.toContain(lockedCardId);
      expect(upserts).toContain(FREE_DECK_ID);
    });

    it("still tells an older build what was withdrawn", async () => {
      const body = await changesFor(OLD_CLIENT);
      const retired = body.items.filter(
        ({ operation }) => operation === "RETIRE",
      );

      expect(retired.map(({ resourceId }) => resourceId)).toContain(
        PAID_DECK_ID,
      );
    });

    it("moves an older build's cursor past what it was not shown", async () => {
      // Or a release that is mostly locked would be an infinite page of
      // nothing, and the client would never reach the free content after it.
      const first = await changesFor(OLD_CLIENT);
      const second = await request(httpServer)
        .get("/v1/content/changes")
        .set(OLD_CLIENT)
        .query({ locale: "en", after: first.nextCursor, limit: 100 })
        .expect(200);

      expect(first.nextCursor).not.toEqual(changeCursor);
      expect((second.body as unknown as ChangePageBody).items).toEqual([]);
    });

    it("treats a caller that sends no version as the oldest build there is", async () => {
      const body = await changesFor(ANONYMOUS_CLIENT);

      expect(
        body.items
          .filter(({ operation }) => operation === "UPSERT")
          .map(({ resourceId }) => resourceId),
      ).not.toContain(PAID_DECK_ID);
    });

    it("says the answer depends on the client headers", async () => {
      const response = await request(httpServer)
        .get("/v1/content/changes")
        .set(OLD_CLIENT)
        .query({ locale: "en", after: changeCursor })
        .expect(200);

      expect(response.headers["vary"]).toContain("x-client-app-version");
    });
  });
});
