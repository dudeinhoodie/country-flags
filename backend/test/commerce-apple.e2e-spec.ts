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
  PrismaClient,
  StoreEnvironment,
  StoreNotificationStatus,
  StoreProductStatus,
  StoreProvider,
  StoreTransactionClaimState,
  UserStatus,
} from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { AccountDeletionService } from "../src/modules/account-lifecycle/account-deletion.service";
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";
import {
  localTestSignedNotification,
  localTestSignedTransaction,
} from "../src/modules/commerce/apple/testing/local-store-transaction";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { TEST_STUDY_USER_ID } from "../src/modules/study-sessions/fixtures/test-study.fixture";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";

const CONTENT_VERSION = "test-only-fixture-v1";
const PAID_DECK_ID = "70000000-0000-4000-8000-00000000000b";
const ENTITLEMENT_KEY = "entitlement.test_only_commerce";
const OFFER_CODE = "TEST_ONLY_COMMERCE_LIFETIME";
const RETIRED_OFFER_CODE = "TEST_ONLY_COMMERCE_LEGACY";
// The bundle identifier a local/CI deployment verifies against, and the store
// environment it is pinned to. A hosted deployment can reach neither.
const BUNDLE_ID = "app.countryflags.mobile.local";
const PRODUCT_ID = "app.countryflags.deck.test_only_commerce.lifetime.v1";
const TRANSACTION_ID = "2000000900000031";
const STRANGER_USER_ID = "80000000-0000-4000-8000-00000000002a";
const STRANGER_TOKEN = "a0000000-0000-4000-8000-00000000002a";
const OWNED_SESSION_ID = "90000000-0000-4000-8000-00000000001a";

interface SnapshotBody {
  entitlementKeys: string[];
  checkedAt: string;
}

interface OfferBody {
  code: string;
  kind: string;
  grants: string[];
  storeProduct?: { provider: string; productId: string };
  title: string | null;
  description: string | null;
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
 * The purchase path, end to end.
 *
 * The transactions here are the kind StoreKit's local testing configuration
 * produces: well-formed, and signed by nobody. A CI deployment is pinned to
 * `LOCAL_TEST` and will look at them; dev and prod cannot be pointed there,
 * which is what makes it safe to prove the whole flow without asking Apple to
 * sign anything.
 */
describe("Apple transactions and entitlements (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_commerce_apple_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let ownerToken: string;
  let strangerToken: string;
  let ownerAccountToken: string;
  let purchase: string;
  let emptyEtag: string;
  let ownedEtag: string;

  function signedPurchase(
    overrides: Partial<Parameters<typeof localTestSignedTransaction>[0]> = {},
  ): string {
    return localTestSignedTransaction({
      transactionId: TRANSACTION_ID,
      productId: PRODUCT_ID,
      bundleId: BUNDLE_ID,
      appAccountToken: ownerAccountToken,
      purchaseDate: new Date("2026-09-04T09:00:00.000Z"),
      ...overrides,
    });
  }

  function submit(
    accessToken: string,
    signedTransaction: string,
  ): request.Test {
    return request(httpServer)
      .post("/v1/me/commerce/apple/transactions")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", "6f9619ff-8b86-d011-b42d-00cf4fc964ff")
      .send({ transactions: [{ signedTransaction }] });
  }

  async function ledgerRow(): Promise<{
    userId: string | null;
    claimState: StoreTransactionClaimState;
    revokedAt: Date | null;
  } | null> {
    return database.storeTransaction.findUnique({
      where: {
        provider_storeEnvironment_transactionId: {
          provider: StoreProvider.APPLE_APP_STORE,
          storeEnvironment: StoreEnvironment.LOCAL_TEST,
          transactionId: TRANSACTION_ID,
        },
      },
      select: { userId: true, claimState: true, revokedAt: true },
    });
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for commerce integration tests",
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
        `Commerce test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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
    const signer = app.get(TestJwtSigner);
    ownerToken = signer.sign(TEST_STUDY_USER_ID);
    strangerToken = signer.sign(STRANGER_USER_ID);

    const owner = await database.user.findUniqueOrThrow({
      where: { id: TEST_STUDY_USER_ID },
      select: { storeAccountToken: true },
    });
    ownerAccountToken = owner.storeAccountToken;
    purchase = signedPurchase();

    await database.user.create({
      data: {
        id: STRANGER_USER_ID,
        preferredLocale: "en",
        status: UserStatus.ACTIVE,
        storeAccountToken: STRANGER_TOKEN,
      },
    });

    const cards = await database.learningCard.findMany({
      where: {
        status: CardStatus.ACTIVE,
        subject: {
          contentKey: { in: ["country.nepal", "country.switzerland"] },
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    await database.entitlementDefinition.create({
      data: { key: ENTITLEMENT_KEY, description: "TEST_ONLY commerce deck" },
    });
    const offer = await database.commerceOffer.create({
      data: {
        code: OFFER_CODE,
        status: CommerceOfferStatus.ACTIVE,
        sortOrder: 10,
        grants: { create: { entitlementKey: ENTITLEMENT_KEY } },
        localizations: {
          create: [
            {
              locale: "en",
              title: "Test only commerce deck",
              description: "A deck a purchase opens",
            },
          ],
        },
      },
      select: { id: true },
    });
    // Retired, and therefore not a way anybody can buy the deck today, even
    // though it still confirms the rights of whoever already did.
    await database.commerceOffer.create({
      data: {
        code: RETIRED_OFFER_CODE,
        status: CommerceOfferStatus.RETIRED,
        sortOrder: 1,
        grants: { create: { entitlementKey: ENTITLEMENT_KEY } },
      },
    });
    await database.storeProduct.create({
      data: {
        offerId: offer.id,
        provider: StoreProvider.APPLE_APP_STORE,
        storeEnvironment: StoreEnvironment.LOCAL_TEST,
        bundleId: BUNDLE_ID,
        productId: PRODUCT_ID,
        status: StoreProductStatus.ACTIVE,
      },
    });
    await database.deck.create({
      data: {
        id: PAID_DECK_ID,
        code: "PAID_COMMERCE_TEST",
        kind: DeckKind.CURATED,
        status: DeckStatus.PUBLISHED,
        accessModel: DeckAccessModel.ENTITLEMENT,
        requiredEntitlementKey: ENTITLEMENT_KEY,
        contentVersion: CONTENT_VERSION,
        localizations: {
          create: [
            {
              locale: "en",
              name: "Paid commerce deck",
              description: "A deck a purchase opens",
            },
          ],
        },
        cards: {
          create: cards.map(({ id }, index) => ({
            learningCardId: id,
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

  it("lists what is for sale, with the store product and never a price", async () => {
    const response = await request(httpServer)
      .get("/v1/commerce/offers?platform=IOS")
      .expect(200);
    const body = response.body as unknown as { items: OfferBody[] };
    const offer = body.items.find(({ code }) => code === OFFER_CODE);

    expect(offer).toMatchObject({
      code: OFFER_CODE,
      kind: "ONE_TIME",
      grants: [ENTITLEMENT_KEY],
      storeProduct: {
        provider: "APPLE_APP_STORE",
        productId: PRODUCT_ID,
      },
      title: "Test only commerce deck",
    });
    expect(body.items.map(({ code }) => code)).not.toContain(
      RETIRED_OFFER_CODE,
    );
    expect(JSON.stringify(body)).not.toMatch(/price|currency/i);
  });

  it("offers nothing for a platform this deployment has no product on", async () => {
    const response = await request(httpServer)
      .get("/v1/commerce/offers?platform=ANDROID")
      .expect(200);
    const body = response.body as unknown as { items: OfferBody[] };
    const offer = body.items.find(({ code }) => code === OFFER_CODE);

    // The offer is still there — it is what a deck's `offerCodes` resolves
    // to — but there is no product to buy it with.
    expect(offer?.storeProduct).toBeUndefined();
  });

  it("answers an empty snapshot with an entity tag a foreground check reuses", async () => {
    const response = await request(httpServer)
      .get("/v1/me/entitlements")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    const body = response.body as unknown as SnapshotBody;
    const etag = response.headers.etag as string;

    emptyEtag = etag;
    expect(body.entitlementKeys).toEqual([]);
    expect(typeof body.checkedAt).toBe("string");
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(response.headers["cache-control"]).toBe("private, no-cache");

    await request(httpServer)
      .get("/v1/me/entitlements")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("If-None-Match", etag)
      .expect(304);
  });

  it("requires an account and an idempotency key before it reads anything", async () => {
    await request(httpServer)
      .post("/v1/me/commerce/apple/transactions")
      .send({ transactions: [{ signedTransaction: purchase }] })
      .expect(401);

    const response = await request(httpServer)
      .post("/v1/me/commerce/apple/transactions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ transactions: [{ signedTransaction: purchase }] })
      .expect(422);

    expect((response.body as unknown as ErrorBody).error.code).toBe(
      "VALIDATION_FAILED",
    );
    await expect(ledgerRow()).resolves.toBeNull();
  });

  it("refuses a transaction signed in another store environment", async () => {
    // A CI deployment is pinned to LOCAL_TEST exactly as prod is pinned to
    // Production, so this is the same refusal a Sandbox purchase gets there.
    const response = await submit(
      ownerToken,
      signedPurchase({
        transactionId: "2000000900000032",
        environment: "Production",
      }),
    ).expect(422);
    const body = response.body as unknown as ErrorBody;

    expect(body.error.code).toBe("TRANSACTION_VERIFICATION_FAILED");
    expect(body.error.details).toEqual({ reason: "ENVIRONMENT_MISMATCH" });
    await expect(database.storeTransaction.count()).resolves.toBe(0);
  });

  it("refuses a product this deployment does not sell", async () => {
    const response = await submit(
      ownerToken,
      signedPurchase({
        transactionId: "2000000900000033",
        productId: "app.countryflags.deck.not_for_sale.lifetime.v1",
      }),
    ).expect(422);
    const body = response.body as unknown as ErrorBody;

    expect(body.error.details).toMatchObject({ reason: "UNKNOWN_PRODUCT" });
    await expect(database.storeTransaction.count()).resolves.toBe(0);
  });

  it("grants the deck from the signed payload alone", async () => {
    const response = await submit(ownerToken, purchase).expect(200);
    const body = response.body as unknown as SnapshotBody;

    expect(body.entitlementKeys).toEqual([ENTITLEMENT_KEY]);
    await expect(database.storeTransaction.count()).resolves.toBe(1);
    await expect(
      database.userEntitlementGrant.count({
        where: { userId: TEST_STUDY_USER_ID, status: "ACTIVE" },
      }),
    ).resolves.toBe(1);
    await expect(ledgerRow()).resolves.toMatchObject({
      userId: TEST_STUDY_USER_ID,
      claimState: StoreTransactionClaimState.CLAIMED,
      revokedAt: null,
    });
  });

  it("opens the cards and a session the moment the call returns", async () => {
    const snapshot = await request(httpServer)
      .get("/v1/me/entitlements")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    ownedEtag = snapshot.headers.etag as string;
    expect(ownedEtag).not.toBe(emptyEtag);

    await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        id: OWNED_SESSION_ID,
        deckId: PAID_DECK_ID,
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
  });

  it("creates nothing at all when the same payload arrives again", async () => {
    const response = await submit(ownerToken, purchase).expect(200);

    expect((response.body as unknown as SnapshotBody).entitlementKeys).toEqual([
      ENTITLEMENT_KEY,
    ]);
    await expect(database.storeTransaction.count()).resolves.toBe(1);
    await expect(
      database.userEntitlementGrant.count({
        where: { userId: TEST_STUDY_USER_ID },
      }),
    ).resolves.toBe(1);
  });

  it("refuses to hand the same purchase to a second live account", async () => {
    const response = await submit(strangerToken, purchase).expect(409);
    const body = response.body as unknown as ErrorBody;

    expect(body.error.code).toBe("PURCHASE_BOUND_TO_ANOTHER_ACCOUNT");
    expect(body.error.details).toEqual({ transactionReference: "****0031" });
    // Nothing about the account holding it, and a request id support can use.
    expect(JSON.stringify(body)).not.toContain(TEST_STUDY_USER_ID);
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      database.userEntitlementGrant.count({
        where: { userId: STRANGER_USER_ID },
      }),
    ).resolves.toBe(0);
  });

  it("releases the purchase when the account holding it is deleted", async () => {
    await app
      .get(AccountDeletionService)
      .delete(TEST_STUDY_USER_ID, "22222222-2222-4222-8222-222222222222");

    await expect(
      database.userEntitlementGrant.count({
        where: { userId: TEST_STUDY_USER_ID },
      }),
    ).resolves.toBe(0);
    // The ledger keeps the row: a non-consumable belongs to the Apple
    // Account that paid for it, and that account outlives this one.
    await expect(ledgerRow()).resolves.toMatchObject({
      userId: null,
      claimState: StoreTransactionClaimState.RELEASED_BY_ACCOUNT_DELETION,
    });
  });

  it("lets a verified restore bind the released purchase to a new account", async () => {
    const response = await submit(strangerToken, purchase).expect(200);

    expect((response.body as unknown as SnapshotBody).entitlementKeys).toEqual([
      ENTITLEMENT_KEY,
    ]);
    await expect(database.storeTransaction.count()).resolves.toBe(1);
    await expect(ledgerRow()).resolves.toMatchObject({
      userId: STRANGER_USER_ID,
      claimState: StoreTransactionClaimState.CLAIMED,
    });
  });

  it("takes the deck back when Apple says the purchase was refunded", async () => {
    const response = await submit(
      strangerToken,
      signedPurchase({
        revocationDate: new Date("2026-09-05T09:00:00.000Z"),
        revocationReason: 0,
      }),
    ).expect(200);

    expect((response.body as unknown as SnapshotBody).entitlementKeys).toEqual(
      [],
    );
    await expect(database.storeTransaction.count()).resolves.toBe(1);
    await request(httpServer)
      .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
      .set("Authorization", `Bearer ${strangerToken}`)
      .expect(403);
  });

  it("moves the entity tag when the rights move, and not otherwise", async () => {
    const response = await request(httpServer)
      .get("/v1/me/entitlements")
      .set("Authorization", `Bearer ${strangerToken}`)
      .expect(200);
    const etag = response.headers.etag as string;

    // The rights changed twice — granted, then refunded — and the tag came
    // back to what an account holding nothing looks like.
    expect(etag).not.toBe(ownedEtag);
    expect(etag).toBe(emptyEtag);
    await request(httpServer)
      .get("/v1/me/entitlements")
      .set("Authorization", `Bearer ${strangerToken}`)
      .set("If-None-Match", etag)
      .expect(304);
  });

  describe("what Apple tells us unprompted", () => {
    const NOTIFICATION_UUID = "c1000000-0000-4000-8000-00000000003a";

    function notify(signedPayload: string): request.Test {
      return request(httpServer)
        .post("/v1/commerce/apple/notifications")
        .send({ signedPayload });
    }

    function refundNotification(
      overrides: Partial<
        Parameters<typeof localTestSignedNotification>[0]
      > = {},
      purchaseOverrides: Partial<
        Parameters<typeof localTestSignedTransaction>[0]
      > = {},
    ): string {
      return localTestSignedNotification({
        notificationUuid: NOTIFICATION_UUID,
        notificationType: "REFUND",
        bundleId: BUNDLE_ID,
        signedTransactionInfo: signedPurchase({
          revocationDate: new Date("2026-09-05T10:00:00.000Z"),
          revocationReason: 0,
          ...purchaseOverrides,
        }),
        ...overrides,
      });
    }

    // No session, no header, no allowlist: the signature is the
    // authentication, and a body that carries none is not a notification.
    it("refuses a body Apple did not sign, and records nothing", async () => {
      await notify("not.a.jws").expect(422);
      await expect(database.storeNotification.count()).resolves.toBe(0);
    });

    it("takes the deck back when the refund arrives from Apple", async () => {
      await submit(strangerToken, signedPurchase()).expect(200);
      await request(httpServer)
        .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
        .set("Authorization", `Bearer ${strangerToken}`)
        .expect(200);

      await notify(refundNotification()).expect(202);

      await request(httpServer)
        .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
        .set("Authorization", `Bearer ${strangerToken}`)
        .expect(403);
      await expect(ledgerRow()).resolves.toMatchObject({
        revokedAt: new Date("2026-09-05T10:00:00.000Z"),
      });
      // The progress the account built is not the account's rights, and a
      // refund takes only the rights.
      await request(httpServer)
        .get("/v1/me/progress")
        .set("Authorization", `Bearer ${strangerToken}`)
        .expect(200);
    });

    it("changes nothing the second time Apple sends the same one", async () => {
      await notify(refundNotification()).expect(202);

      await expect(database.storeNotification.count()).resolves.toBe(1);
      const [row] = await database.storeNotification.findMany({
        select: { status: true, notificationType: true },
      });
      expect(row?.status).toBe(StoreNotificationStatus.PROCESSED);
    });

    it("accepts the test notification an operator sends to prove the URL", async () => {
      await notify(
        localTestSignedNotification({
          notificationUuid: "c1000000-0000-4000-8000-00000000003b",
          notificationType: "TEST",
          bundleId: BUNDLE_ID,
        }),
      ).expect(202);

      const row = await database.storeNotification.findUnique({
        where: {
          notificationUuid: "c1000000-0000-4000-8000-00000000003b",
        },
        select: { status: true },
      });
      expect(row?.status).toBe(StoreNotificationStatus.PROCESSED);
    });

    // Accepted, recorded, acted on by nobody: refusing would make Apple
    // retry a product mismatch every hour for a day and fix nothing.
    //
    // The token names the stranger rather than the suite's default owner,
    // whose account was deleted several tests ago: an account has to be
    // found before the product can be the thing that is wrong with the
    // notification.
    it("quarantines a product this deployment does not sell", async () => {
      await notify(
        refundNotification(
          { notificationUuid: "c1000000-0000-4000-8000-00000000003c" },
          {
            productId: "app.countryflags.deck.nothing.lifetime.v1",
            transactionId: "2000000900000099",
            appAccountToken: STRANGER_TOKEN,
          },
        ),
      ).expect(202);

      const row = await database.storeNotification.findUnique({
        where: {
          notificationUuid: "c1000000-0000-4000-8000-00000000003c",
        },
        select: { status: true, error: true },
      });
      expect(row?.status).toBe(StoreNotificationStatus.QUARANTINED);
      expect(row?.error).toBe("UNKNOWN_PRODUCT");
    });

    // The reason the account token is published at all. Nothing in this test
    // is authenticated as the customer: they never open the app between the
    // purchase and the refund, and Apple's notification carries no session of
    // ours. The token Apple signed into the transaction is the only thing
    // that says whose purchase this is.
    it("places a purchase nobody submitted on the account its token names", async () => {
      const userId = "80000000-0000-4000-8000-00000000002b";
      const accountToken = "a0000000-0000-4000-8000-00000000002b";
      const transactionId = "2000000900000042";
      await database.user.create({
        data: {
          id: userId,
          preferredLocale: "en",
          status: UserStatus.ACTIVE,
          storeAccountToken: accountToken,
        },
      });
      const accessToken = app.get(TestJwtSigner).sign(userId);
      const charged = signedPurchase({
        transactionId,
        appAccountToken: accountToken,
      });

      await notify(
        localTestSignedNotification({
          notificationUuid: "c1000000-0000-4000-8000-00000000004a",
          notificationType: "ONE_TIME_CHARGE",
          bundleId: BUNDLE_ID,
          signedTransactionInfo: charged,
        }),
      ).expect(202);

      await request(httpServer)
        .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      await expect(
        database.storeTransaction.findUniqueOrThrow({
          where: {
            provider_storeEnvironment_transactionId: {
              provider: StoreProvider.APPLE_APP_STORE,
              storeEnvironment: StoreEnvironment.LOCAL_TEST,
              transactionId,
            },
          },
          select: { userId: true, claimState: true },
        }),
      ).resolves.toEqual({
        userId,
        claimState: StoreTransactionClaimState.CLAIMED,
      });

      // And the refund the issue is actually about: it arrives the same way,
      // finds the same account by the same token, and takes the deck back.
      await notify(
        localTestSignedNotification({
          notificationUuid: "c1000000-0000-4000-8000-00000000004b",
          notificationType: "REFUND",
          bundleId: BUNDLE_ID,
          signedTransactionInfo: signedPurchase({
            transactionId,
            appAccountToken: accountToken,
            revocationDate: new Date("2026-09-06T10:00:00.000Z"),
            revocationReason: 0,
          }),
        }),
      ).expect(202);

      await request(httpServer)
        .get(`/v1/decks/${PAID_DECK_ID}/cards?locale=en`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(403);
    });

    // The token names a live account or it names nobody: a purchase whose
    // owner deleted their account is released rather than re-granted to the
    // tombstone that row has become.
    it("quarantines a notification whose token names a deleted account", async () => {
      const userId = "80000000-0000-4000-8000-00000000002c";
      const accountToken = "a0000000-0000-4000-8000-00000000002c";
      const transactionId = "2000000900000043";
      await database.user.create({
        data: {
          id: userId,
          preferredLocale: "und",
          status: UserStatus.DELETED,
          // Both timestamps, because `users_deletion_timestamps_check` will
          // not have a tombstone that never asked to be one.
          deletionRequestedAt: new Date("2026-09-01T00:00:00.000Z"),
          deletedAt: new Date("2026-09-01T00:00:00.000Z"),
          storeAccountToken: accountToken,
        },
      });

      await notify(
        localTestSignedNotification({
          notificationUuid: "c1000000-0000-4000-8000-00000000004c",
          notificationType: "REFUND",
          bundleId: BUNDLE_ID,
          signedTransactionInfo: signedPurchase({
            transactionId,
            appAccountToken: accountToken,
            revocationDate: new Date("2026-09-06T10:00:00.000Z"),
            revocationReason: 0,
          }),
        }),
      ).expect(202);

      const row = await database.storeNotification.findUnique({
        where: { notificationUuid: "c1000000-0000-4000-8000-00000000004c" },
        select: { status: true, error: true },
      });
      expect(row?.status).toBe(StoreNotificationStatus.QUARANTINED);
      expect(row?.error).toBe("UNKNOWN_ACCOUNT");
      await expect(
        database.userEntitlementGrant.count({ where: { userId } }),
      ).resolves.toBe(0);
    });
  });
});
