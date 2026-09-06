// Must be the first import: it fixes the minimum client version before
// app.module.ts snapshots process.env through ConfigModule.forRoot.
import {
  originalMinimumClientVersions,
  PAID_AWARE_CLIENT,
} from "./paid-content-client.environment";

import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  AssetStatus,
  AssetType,
  CardStatus,
  CommerceOfferStatus,
  ContentChangeOperation,
  ContentResourceType,
  DeckAccessModel,
  DeckKind,
  DeckStatus,
  EntitlementGrantSource,
  EntitlementGrantStatus,
  GeoEntityKind,
  GeoEntityStatus,
  GeoNameType,
  GradingMode,
  PrismaClient,
  ProgressPolicy,
  PublicationStatus,
  RecognitionStatus,
  RevisionChangeClassification,
} from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { TEST_STUDY_USER_ID } from "../src/modules/study-sessions/fixtures/test-study.fixture";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";

const CONTENT_VERSION = "test-only-fixture-v1";
const ASSET_SOURCE_ID = "10000000-0000-4000-8000-000000000001";
const NAMES_SOURCE_ID = "10000000-0000-4000-8000-000000000002";
const GERMANY_ID = "30000000-0000-4000-8000-000000000003";
const GERMANY_FLAG_ASSET_ID = "40000000-0000-4000-8000-000000000003";
const BAVARIA_ID = "3a000000-0000-4000-8000-00000000000b";
const COAT_TEMPLATE_ID = "20000000-0000-4000-8000-00000000000a";
const COAT_ASSET_ID = "4a000000-0000-4000-8000-00000000000a";
const BAVARIA_FLAG_ASSET_ID = "4a000000-0000-4000-8000-00000000000b";
const COAT_CARD_ID = "6a000000-0000-4000-8000-00000000000a";
const BAVARIA_CARD_ID = "6a000000-0000-4000-8000-00000000000b";
const PAID_DECK_ID = "7a000000-0000-4000-8000-00000000000a";
const ENTITLEMENT_KEY = "entitlement.test_only_coats";
const OFFER_CODE = "TEST_ONLY_COATS_LIFETIME";
const COAT_URL =
  "https://fixtures.country-flags.test/test-only-fixture-v1/coats/germany.svg";
const BAVARIA_FLAG_URL =
  "https://fixtures.country-flags.test/test-only-fixture-v1/flags/bavaria.svg";

interface AssetBody {
  id: string;
  type: string;
  representations: Array<{ url: string }>;
}

interface EntityBody {
  id: string;
  assets: AssetBody[];
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

interface CardPageBody {
  items: Array<{
    id: string;
    prompt: { asset: AssetBody };
  }>;
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/**
 * The public content projection, end to end.
 *
 * Germany carries a free flag and a coat of arms that only an entitlement deck
 * teaches; Bavaria is taught by that deck alone. What a stranger may see of
 * either is decided once, by the visibility policy, and this suite asks the
 * three routes that hand content out without knowing who is asking.
 */
describe("public content projection (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_content_projection_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let accessToken: string;
  let changeCursor: string;

  async function seedPaidCoat(): Promise<void> {
    await database.cardTemplate.create({
      data: {
        id: COAT_TEMPLATE_ID,
        code: "COAT_OF_ARMS_TO_COUNTRY",
        schemaVersion: 1,
        promptType: "COAT_OF_ARMS_ASSET",
        answerType: "GEO_ENTITY_NAME",
        gradingMode: GradingMode.SELF_RATED,
        promptSpec: { assetType: "COAT_OF_ARMS" },
        answerSpec: { nameType: "SHORT" },
        backSideFactTypes: [],
        status: PublicationStatus.PUBLISHED,
      },
    });

    // A subdivision nothing free teaches, so the whole entity is closed
    // rather than merely stripped of a drawing.
    await database.geoEntity.create({
      data: {
        id: BAVARIA_ID,
        contentKey: "subdivision.test-only-bavaria",
        kind: GeoEntityKind.SUBDIVISION,
        slug: "test-only-bavaria",
        status: GeoEntityStatus.ACTIVE,
        includeInCountryCatalog: false,
        recognitionStatus: RecognitionStatus.NOT_APPLICABLE,
        metadata: { marker: "TEST_ONLY" },
        contentVersion: CONTENT_VERSION,
        names: {
          create: (["en", "ru"] as const).map((locale) => ({
            locale,
            nameType: GeoNameType.SHORT,
            value: locale === "en" ? "Bavaria" : "Бавария",
            isPrimary: true,
            sourceId: NAMES_SOURCE_ID,
          })),
        },
      },
    });

    for (const [assetId, entityId, assetType, url] of [
      [COAT_ASSET_ID, GERMANY_ID, AssetType.COAT_OF_ARMS, COAT_URL],
      [BAVARIA_FLAG_ASSET_ID, BAVARIA_ID, AssetType.FLAG, BAVARIA_FLAG_URL],
    ] as const) {
      await database.asset.create({
        data: {
          id: assetId,
          geoEntityId: entityId,
          assetType,
          variant: "current",
          objectKey: `test-only/${assetId}.svg`,
          sourceId: ASSET_SOURCE_ID,
          licenseName: "CC0-1.0",
          status: AssetStatus.PUBLISHED,
          contentVersion: CONTENT_VERSION,
          representations: {
            create: {
              sortOrder: 1,
              publicUrl: url,
              mimeType: "image/svg+xml",
              sha256: "b".repeat(64),
            },
          },
        },
      });
    }

    for (const [cardId, entityId, assetId] of [
      [COAT_CARD_ID, GERMANY_ID, COAT_ASSET_ID],
      [BAVARIA_CARD_ID, BAVARIA_ID, BAVARIA_FLAG_ASSET_ID],
    ] as const) {
      await database.learningCard.create({
        data: {
          id: cardId,
          subjectEntityId: entityId,
          templateId: COAT_TEMPLATE_ID,
          semanticVersion: 1,
          status: CardStatus.ACTIVE,
          contentVersion: CONTENT_VERSION,
          revisions: {
            create: {
              revision: 1,
              promptAssetId: assetId,
              promptFingerprint: `${cardId}:1`,
              changeClassification: RevisionChangeClassification.TECHNICAL,
              progressPolicy: ProgressPolicy.PRESERVE,
              contentVersion: CONTENT_VERSION,
              effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
            },
          },
        },
      });
    }

    await database.entitlementDefinition.create({
      data: { key: ENTITLEMENT_KEY, description: "TEST_ONLY coats" },
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
        code: "PAID_COATS",
        kind: DeckKind.CURATED,
        status: DeckStatus.PUBLISHED,
        accessModel: DeckAccessModel.ENTITLEMENT,
        requiredEntitlementKey: ENTITLEMENT_KEY,
        contentVersion: CONTENT_VERSION,
        localizations: {
          create: [
            { locale: "en", name: "Coats", description: "Coats of arms" },
            { locale: "ru", name: "Гербы", description: "Гербы" },
          ],
        },
        cards: {
          create: [
            { learningCardId: COAT_CARD_ID, sortOrder: 1 },
            { learningCardId: BAVARIA_CARD_ID, sortOrder: 2 },
          ],
        },
      },
    });

    // What a publish of this release would have announced: the drawing, the
    // card, the subdivision, the country it hangs off and the deck itself.
    for (const [resourceType, resourceId] of [
      [ContentResourceType.ASSET, COAT_ASSET_ID],
      [ContentResourceType.ASSET, BAVARIA_FLAG_ASSET_ID],
      [ContentResourceType.LEARNING_CARD, COAT_CARD_ID],
      [ContentResourceType.LEARNING_CARD, BAVARIA_CARD_ID],
      [ContentResourceType.ENTITY, BAVARIA_ID],
      [ContentResourceType.ENTITY, GERMANY_ID],
      [ContentResourceType.DECK, PAID_DECK_ID],
    ] as const) {
      await database.contentChange.create({
        data: {
          contentVersion: CONTENT_VERSION,
          operation: ContentChangeOperation.UPSERT,
          resourceType,
          resourceId,
        },
      });
    }
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for content projection integration tests",
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
        `Content projection test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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
    await seedPaidCoat();

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
    process.env.TEST_AUTH_ENABLED = originalTestAuthEnabled;
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

  it("serves Germany's free flag and not the coat only the paid deck teaches", async () => {
    const response = await request(httpServer)
      .get(`/v1/entities/${GERMANY_ID}`)
      .query({ locale: "en" })
      .expect(200);
    const body = response.body as unknown as EntityBody;

    expect(body.assets.map(({ id }) => id)).toEqual([GERMANY_FLAG_ASSET_ID]);
    expect(body.assets[0]?.type).toBe(AssetType.FLAG);
    // Not the id, not the type, and not the address the bytes are at.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(COAT_ASSET_ID);
    expect(serialized).not.toContain(COAT_URL);
    expect(serialized).not.toContain(AssetType.COAT_OF_ARMS);
  });

  it("answers for a place only the paid deck teaches the way it answers for one that does not exist", async () => {
    const missing = await request(httpServer)
      .get("/v1/entities/3a000000-0000-4000-8000-0000000000ff")
      .query({ locale: "en" })
      .expect(404);
    const closed = await request(httpServer)
      .get(`/v1/entities/${BAVARIA_ID}`)
      .query({ locale: "en" })
      .expect(404);

    // Word for word what an id nobody ever minted gets, so the route cannot
    // be used to tell "sold, and not to you" from "never existed".
    const errorOf = (body: unknown): unknown =>
      (body as { error: { code: string; message: string } }).error;
    expect(errorOf(closed.body)).toMatchObject({
      code: (errorOf(missing.body) as { code: string }).code,
      message: (errorOf(missing.body) as { message: string }).message,
    });
    expect(JSON.stringify(closed.body)).not.toContain(BAVARIA_FLAG_URL);
  });

  it("announces nothing paid on the public change feed, and still moves the cursor", async () => {
    const response = await request(httpServer)
      .get("/v1/content/changes")
      .set(PAID_AWARE_CLIENT)
      .query({ locale: "en", after: changeCursor, limit: 100 })
      .expect(200);
    const body = response.body as unknown as ChangePageBody;

    const announced = body.items.map(({ resourceId }) => resourceId);
    expect(announced).toContain(GERMANY_ID);
    // The deck survives: the catalog publishes it to everybody, and this is
    // how an owner learns to come back for its cards.
    expect(announced).toContain(PAID_DECK_ID);
    expect(announced).not.toContain(COAT_ASSET_ID);
    expect(announced).not.toContain(COAT_CARD_ID);
    expect(announced).not.toContain(BAVARIA_ID);
    expect(announced).not.toContain(BAVARIA_FLAG_ASSET_ID);
    expect(announced).not.toContain(BAVARIA_CARD_ID);
    expect(body.nextCursor).not.toEqual(changeCursor);

    // The next page starts after everything the first one read, withheld
    // rows included.
    const next = await request(httpServer)
      .get("/v1/content/changes")
      .set(PAID_AWARE_CLIENT)
      .query({ locale: "en", after: body.nextCursor, limit: 100 })
      .expect(200);
    expect((next.body as unknown as ChangePageBody).items).toEqual([]);
  });

  it("refuses the locked deck's cards to a guest and hands the coat to an owner", async () => {
    await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}/cards`)
      .query({ locale: "en" })
      .expect(403);

    await database.userEntitlementGrant.create({
      data: {
        userId: TEST_STUDY_USER_ID,
        entitlementKey: ENTITLEMENT_KEY,
        sourceType: EntitlementGrantSource.MIGRATION,
        status: EntitlementGrantStatus.ACTIVE,
      },
    });

    const response = await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}/cards`)
      .query({ locale: "en" })
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const body = response.body as unknown as CardPageBody;

    // The guarded route is where the closed drawing is handed over, and the
    // only place it is.
    expect(JSON.stringify(body)).toContain(COAT_URL);
    expect(body.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([COAT_CARD_ID, BAVARIA_CARD_ID]),
    );
  });

  it("publishes a drawing the locked deck previews on purpose", async () => {
    await database.deckCard.update({
      where: {
        deckId_learningCardId: {
          deckId: PAID_DECK_ID,
          learningCardId: COAT_CARD_ID,
        },
      },
      data: { isPreview: true },
    });

    const response = await request(httpServer)
      .get(`/v1/entities/${GERMANY_ID}`)
      .query({ locale: "en" })
      .expect(200);
    const body = response.body as unknown as EntityBody;

    expect(body.assets.map(({ id }) => id)).toEqual([
      GERMANY_FLAG_ASSET_ID,
      COAT_ASSET_ID,
    ]);

    await database.deckCard.update({
      where: {
        deckId_learningCardId: {
          deckId: PAID_DECK_ID,
          learningCardId: COAT_CARD_ID,
        },
      },
      data: { isPreview: false },
    });
  });

  it("keeps the coat public once a free deck teaches it too", async () => {
    const freeDeckId = "70000000-0000-4000-8000-000000000001";
    await database.deckCard.create({
      data: {
        deckId: freeDeckId,
        learningCardId: COAT_CARD_ID,
        sortOrder: 999,
      },
    });

    const response = await request(httpServer)
      .get(`/v1/entities/${GERMANY_ID}`)
      .query({ locale: "en" })
      .expect(200);

    // A drawing one free card prompts with is public for the whole release,
    // whatever else also sells it.
    expect(
      (response.body as unknown as EntityBody).assets.map(({ id }) => id),
    ).toEqual([GERMANY_FLAG_ASSET_ID, COAT_ASSET_ID]);

    await database.deckCard.delete({
      where: {
        deckId_learningCardId: {
          deckId: freeDeckId,
          learningCardId: COAT_CARD_ID,
        },
      },
    });
  });
});
