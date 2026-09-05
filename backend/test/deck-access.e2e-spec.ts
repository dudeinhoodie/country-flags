import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  CardStatus,
  CommerceOfferStatus,
  DeckAccessModel,
  DeckKind,
  DeckStatus,
  EntitlementGrantSource,
  EntitlementGrantStatus,
  PrismaClient,
} from "@prisma/client";
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

const CONTENT_VERSION = "test-only-fixture-v1";
const FREE_DECK_ID = "70000000-0000-4000-8000-000000000001";
const PAID_DECK_ID = "70000000-0000-4000-8000-00000000000a";
const ENTITLEMENT_KEY = "entitlement.test_only_paid";
const ACTIVE_OFFER_CODE = "TEST_ONLY_PAID_LIFETIME";
const RETIRED_OFFER_CODE = "TEST_ONLY_PAID_LEGACY";
const OWNED_SESSION_ID = "90000000-0000-4000-8000-00000000000a";
const REFUSED_SESSION_ID = "90000000-0000-4000-8000-00000000000b";
const IMPORTED_SESSION_ID = "90000000-0000-4000-8000-00000000000c";
const REVIEW_EVENT_ID = "92000000-0000-4000-8000-00000000000a";

interface DeckAccessBody {
  model: string;
  requiredEntitlementKey?: string;
  offerCodes?: string[];
}

interface DeckBody {
  id: string;
  code: string;
  cardCount: number;
  access: DeckAccessBody;
}

interface DeckPageBody {
  items: DeckBody[];
}

interface CardPageBody {
  items: Array<{ id: string; answer: { displayName: string } }>;
}

interface SessionCardBody {
  learningCard: {
    id: string;
    revision: number;
    prompt: { asset: { representations: Array<{ sha256: string }> } };
  };
}

interface SessionBody {
  id: string;
  status: string;
  selectedUniqueCount: number;
  cards: SessionCardBody[];
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: Record<string, unknown>;
  };
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/**
 * The entitlement guard, end to end.
 *
 * A paid deck is built on top of the ordinary test content: two of its cards
 * also belong to the free "All countries" deck, which is how the suite proves
 * that buying a deck locks a route rather than a country.
 */
describe("deck entitlement guard (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_deck_access_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let accessToken: string;
  let paidCardIds: string[];
  let ownedSessionCards: SessionCardBody[];

  async function grantEntitlement(): Promise<void> {
    await database.userEntitlementGrant.create({
      data: {
        userId: TEST_STUDY_USER_ID,
        entitlementKey: ENTITLEMENT_KEY,
        sourceType: EntitlementGrantSource.MIGRATION,
        status: EntitlementGrantStatus.ACTIVE,
      },
    });
  }

  async function revokeEntitlement(): Promise<void> {
    await database.userEntitlementGrant.updateMany({
      where: { userId: TEST_STUDY_USER_ID, entitlementKey: ENTITLEMENT_KEY },
      data: {
        status: EntitlementGrantStatus.REVOKED,
        revokedAt: new Date("2026-09-02T10:00:00.000Z"),
        revocationReason: "TEST_ONLY refund",
      },
    });
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for deck access integration tests",
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
        `Deck access test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    // Two cards that already belong to the free deck. Neither country carries
    // a seeded review state, so a review submitted later starts from zero.
    const shared = await database.learningCard.findMany({
      where: {
        status: CardStatus.ACTIVE,
        subject: {
          contentKey: { in: ["country.nepal", "country.switzerland"] },
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    paidCardIds = shared.map(({ id }) => id);
    if (paidCardIds.length !== 2) {
      throw new Error("Deck access fixture expects two shared learning cards");
    }

    await database.entitlementDefinition.create({
      data: { key: ENTITLEMENT_KEY, description: "TEST_ONLY paid deck" },
    });
    await database.commerceOffer.create({
      data: {
        code: ACTIVE_OFFER_CODE,
        status: CommerceOfferStatus.ACTIVE,
        sortOrder: 10,
        grants: { create: { entitlementKey: ENTITLEMENT_KEY } },
      },
    });
    // Retired, so it must not be offered as a way to buy the deck even
    // though it still grants the same right to whoever already bought it.
    await database.commerceOffer.create({
      data: {
        code: RETIRED_OFFER_CODE,
        status: CommerceOfferStatus.RETIRED,
        sortOrder: 1,
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
            {
              locale: "ru",
              name: "Платная тестовая колода",
              description: "Колода, которую открывает право доступа",
            },
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

  it("lists the locked deck to a caller with no account at all", async () => {
    const response = await request(httpServer)
      .get("/v1/decks?locale=en")
      .expect(200);
    const body = response.body as unknown as DeckPageBody;
    const paid = body.items.find(({ id }) => id === PAID_DECK_ID);
    const free = body.items.find(({ id }) => id === FREE_DECK_ID);

    expect(paid).toMatchObject({
      code: "PAID_TEST",
      cardCount: 2,
      access: {
        model: "ENTITLEMENT",
        requiredEntitlementKey: ENTITLEMENT_KEY,
        offerCodes: [ACTIVE_OFFER_CODE],
      },
    });
    expect(free?.access).toEqual({ model: "FREE" });
    expect(JSON.stringify(body)).not.toMatch(/price/i);
  });

  it("serves the locked deck's own metadata unauthenticated", async () => {
    const response = await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}?locale=en`)
      .expect(200);
    const body = response.body as unknown as DeckBody;

    expect(body).toMatchObject({
      id: PAID_DECK_ID,
      cardCount: 2,
      access: { model: "ENTITLEMENT", offerCodes: [ACTIVE_OFFER_CODE] },
    });
    expect(body).not.toHaveProperty("cards");
  });

  it("refuses the locked deck's cards and names the offers that open it", async () => {
    const response = await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
      .expect(403);
    const body = response.body as unknown as ErrorBody;

    expect(body.error.code).toBe("ENTITLEMENT_REQUIRED");
    expect(body.error.details).toEqual({
      deckId: PAID_DECK_ID,
      offerCodes: [ACTIVE_OFFER_CODE],
    });
    expect(JSON.stringify(body)).not.toMatch(/price/i);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["vary"]).toContain("Authorization");
  });

  it("answers 401 for a bearer it cannot verify", async () => {
    const response = await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
      .set("Authorization", "Bearer not-a-real-token")
      .expect(401);
    const body = response.body as unknown as ErrorBody;

    // An expired token means "refresh me", not "you are a guest"; a 403 here
    // would show a paywall to somebody who owns the deck.
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("keeps the shared cards reachable through the free deck", async () => {
    const response = await request(httpServer)
      .get(`/v1/decks/${FREE_DECK_ID}/cards?locale=en&limit=50`)
      .expect(200);
    const body = response.body as unknown as CardPageBody;

    expect(body.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining(paidCardIds),
    );
  });

  it("refuses a new session on the deck the account has not bought", async () => {
    const response = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: REFUSED_SESSION_ID,
        deckId: PAID_DECK_ID,
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(403);
    const body = response.body as unknown as ErrorBody;

    expect(body.error.code).toBe("ENTITLEMENT_REQUIRED");
    expect(body.error.details).toEqual({
      deckId: PAID_DECK_ID,
      offerCodes: [ACTIVE_OFFER_CODE],
    });
    await expect(
      database.studySession.count({ where: { id: REFUSED_SESSION_ID } }),
    ).resolves.toBe(0);
  });

  it("opens the cards and a session once the grant is active", async () => {
    await grantEntitlement();

    const cards = await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect((cards.body as unknown as CardPageBody).items).toHaveLength(2);

    const session = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: OWNED_SESSION_ID,
        deckId: PAID_DECK_ID,
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const body = session.body as unknown as SessionBody;
    ownedSessionCards = body.cards;

    expect(body.selectedUniqueCount).toBe(2);
  });

  it("keeps taking the account's own review history after a revocation", async () => {
    await revokeEntitlement();
    const reviewed = ownedSessionCards[0];
    if (reviewed === undefined) {
      throw new Error("The owned session recorded no card to review");
    }

    const response = await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        payloadVersion: 1,
        events: [
          {
            id: REVIEW_EVENT_ID,
            sessionId: OWNED_SESSION_ID,
            learningCardId: reviewed.learningCard.id,
            deviceId: TEST_STUDY_DEVICE_ID,
            answerMode: "SELF_RATED",
            rating: "GOOD",
            responseTimeMs: 4200,
            clientOccurredAt: "2026-09-02T10:20:00.000Z",
            estimatedServerOccurredAt: "2026-09-02T10:20:00.000Z",
            clientSequence: 1,
            baseStateVersion: 0,
          },
        ],
      })
      .expect(200);
    const body = response.body as unknown as {
      results: Array<{ status: string }>;
    };

    // The right to open a deck and the right to keep your own history are
    // different things, and a refund takes only the first.
    expect(body.results[0]?.status).toBe("ACCEPTED");
  });

  it("lets the open session finish after the grant is revoked", async () => {
    const response = await request(httpServer)
      .post(`/v1/study-sessions/${OWNED_SESSION_ID}/complete`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ completedAt: "2026-09-02T10:30:00.000Z" })
      .expect(200);

    expect((response.body as unknown as SessionBody).status).toBe("COMPLETED");
  });

  it("starts no new session and serves no cards once the grant is gone", async () => {
    await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: REFUSED_SESSION_ID,
        deckId: PAID_DECK_ID,
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(403);

    await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);

    // Discovery survives the revocation: the deck is still in the catalog,
    // still with its offers, which is what an owner needs to buy it again.
    await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}?locale=en`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
  });

  it("still imports a session the client assembled while it owned the deck", async () => {
    const cards = ownedSessionCards.map(({ learningCard }, index) => ({
      learningCardId: learningCard.id,
      learningCardRevision: learningCard.revision,
      assetSha256: learningCard.prompt.asset.representations[0]!.sha256,
      randomSeed: `offline-seed-${index + 1}`,
      distractorPolicyVersion: null,
      snapshot: learningCard,
    }));

    const response = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        id: IMPORTED_SESSION_ID,
        deckId: PAID_DECK_ID,
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "CLIENT_OFFLINE",
        startedAt: "2026-09-02T09:00:00.000Z",
        contentVersion: CONTENT_VERSION,
        cards,
      })
      .expect(201);
    const body = response.body as unknown as SessionBody;

    // Repetitions done while the deck was owned are not deleted by a refund.
    // The import opens nothing: it grants no entitlement and permits no next
    // server session, which the previous test just proved is still refused.
    expect(body.selectedUniqueCount).toBe(cards.length);
  });
});
