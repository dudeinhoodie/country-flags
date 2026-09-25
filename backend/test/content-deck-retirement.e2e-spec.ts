import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  ContentChangeOperation,
  ContentResourceType,
  DeckKind,
  DeckStatus,
  PrismaClient,
} from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { InMemoryObjectStorage } from "../src/infrastructure/object-storage/in-memory-object-storage";
import { publishBundle } from "../src/modules/content/bundle/bundle-publisher";
import { rollbackContentVersion } from "../src/modules/content/bundle/bundle-rollback";
import { buildBundle } from "../src/modules/content/bundle/test-support/bundle-fixture-builder";

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

interface DeckPageBody {
  items: Array<{ id: string; code: string }>;
}

/**
 * A deck the catalogue stops carrying stops being served (#440).
 *
 * The diff used to compare the stored decks by code (`SPECIAL_AREAS`) with the
 * bundle's by key (`deck.special-areas`), then look the "dropped" codes up as
 * if they were keys. Nothing matched, so a deck removed from the catalogue
 * stayed in `GET /v1/decks` for good and could still be studied.
 */
describe("a deck dropped from the catalogue (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const databaseName =
    `country_flags_deck_retire_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let tempDir: string;
  const storage = new InMemoryObjectStorage();

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = "e2e-key";
  const signing = {
    keyId,
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
  const publicKeys = {
    [keyId]: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };

  const testland = {
    key: "country.testland",
    slug: "testland",
    en: "Testland",
    ru: "Тестландия",
  };
  const testopia = {
    key: "country.testopia",
    slug: "testopia",
    en: "Testopia",
    ru: "Тестопия",
  };
  // A key whose code differs from it by more than case, the way the real
  // `deck.special-areas` does.
  const specialAreas = {
    key: "deck.special-areas",
    name: "Special areas",
    memberKeys: [testopia.key],
  };

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for deck retirement tests");
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
        `Deck retirement test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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
    tempDir = mkdtempSync(join(tmpdir(), "deck-retirement-e2e-"));
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
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function publish(
    version: string,
    extraDecks: Array<typeof specialAreas>,
  ): Promise<void> {
    const directory = join(tempDir, version);
    buildBundle(directory, signing, {
      contentVersion: version,
      entities: [testland, testopia],
      extraDecks,
    });
    await publishBundle(directory, publicKeys, database, storage);
  }

  async function servedDeckCodes(): Promise<string[]> {
    const response = await request(httpServer)
      .get("/v1/decks")
      .query({ locale: "en", limit: 100 })
      .expect(200);
    return (response.body as DeckPageBody).items.map((deck) => deck.code);
  }

  it("retires the deck, stops serving it and keeps the progress made on it", async () => {
    await publish("decks-v1", [specialAreas]);
    expect(await servedDeckCodes()).toEqual(["ALL", "SPECIAL_AREAS"]);

    const deck = await database.deck.findUniqueOrThrow({
      where: { code: "SPECIAL_AREAS" },
      include: { cards: true },
    });
    const user = await database.user.create({ data: {} });
    await database.userDeckMastery.create({
      data: {
        userId: user.id,
        deckId: deck.id,
        masteredCardCount: 1,
        totalCardCount: 1,
      },
    });

    await publish("decks-v2", []);

    expect(await servedDeckCodes()).toEqual(["ALL"]);
    await request(httpServer)
      .get(`/v1/decks/${deck.id}`)
      .query({ locale: "en" })
      .expect(404);

    // Retired, not deleted: the row, what it held and what somebody made of
    // it are all still there.
    const retired = await database.deck.findUniqueOrThrow({
      where: { code: "SPECIAL_AREAS" },
      include: { cards: true, mastery: true },
    });
    expect(retired.status).toBe(DeckStatus.RETIRED);
    expect(retired.cards).toHaveLength(deck.cards.length);
    expect(retired.mastery).toMatchObject([
      { userId: user.id, masteredCardCount: 1, totalCardCount: 1 },
    ]);

    // Clients learn it from the change feed, and only it: comparing codes
    // with keys the other way round would have retired every deck.
    const deckChanges = await database.contentChange.findMany({
      where: {
        contentVersion: "decks-v2",
        resourceType: ContentResourceType.DECK,
      },
    });
    const all = await database.deck.findUniqueOrThrow({
      where: { code: "ALL" },
    });
    expect(all.status).toBe(DeckStatus.PUBLISHED);
    expect(
      deckChanges
        .filter((change) => change.operation === ContentChangeOperation.RETIRE)
        .map((change) => change.resourceId),
    ).toEqual([deck.id]);
    expect(
      deckChanges
        .filter((change) => change.operation === ContentChangeOperation.UPSERT)
        .map((change) => change.resourceId),
    ).toEqual([all.id]);
  });

  it("serves the same deck again after a rollback to a release that had it", async () => {
    await rollbackContentVersion(database, storage, "decks-v1");

    expect(await servedDeckCodes()).toEqual(["ALL", "SPECIAL_AREAS"]);
    const restored = await database.deck.findUniqueOrThrow({
      where: { code: "SPECIAL_AREAS" },
      include: { mastery: true },
    });
    expect(restored.status).toBe(DeckStatus.PUBLISHED);
    expect(restored.mastery).toHaveLength(1);
  });

  /**
   * Decks dropped while retirement was broken are still published under the
   * release that last carried them, so the next publish has to find them by
   * status rather than by the active version. A person's own deck is not the
   * catalogue's to retire.
   */
  it("retires a deck an earlier release left published, and never a person's own", async () => {
    const owner = await database.user.create({ data: {} });
    const [ghost, custom] = await Promise.all([
      database.deck.create({
        data: {
          code: "GHOST",
          kind: DeckKind.TAXONOMY,
          status: DeckStatus.PUBLISHED,
          contentVersion: "decks-v2",
        },
      }),
      database.deck.create({
        data: {
          code: "MY_DECK",
          kind: DeckKind.CUSTOM,
          ownerUserId: owner.id,
          status: DeckStatus.PUBLISHED,
          contentVersion: "decks-v2",
        },
      }),
    ]);

    await publish("decks-v3", [specialAreas]);

    // The ghost is gone from what is served, and the change feed names it as
    // the one deck retired. The catalogue is not listed here on purpose: a
    // person's own deck is a row the schema allows but nothing publishes
    // yet, so it carries no name for `GET /v1/decks` to render.
    await request(httpServer)
      .get(`/v1/decks/${ghost.id}`)
      .query({ locale: "en" })
      .expect(404);
    const retirements = await database.contentChange.findMany({
      where: {
        contentVersion: "decks-v3",
        resourceType: ContentResourceType.DECK,
        operation: ContentChangeOperation.RETIRE,
      },
    });
    expect(retirements.map((change) => change.resourceId)).toEqual([ghost.id]);
    const [ghostAfter, customAfter] = await Promise.all([
      database.deck.findUniqueOrThrow({ where: { id: ghost.id } }),
      database.deck.findUniqueOrThrow({ where: { id: custom.id } }),
    ]);
    expect(ghostAfter.status).toBe(DeckStatus.RETIRED);
    expect(customAfter.status).toBe(DeckStatus.PUBLISHED);
  });
});
