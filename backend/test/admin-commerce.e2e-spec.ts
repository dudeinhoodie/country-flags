// Must be the first import: it fixes the admin environment before
// app.module.ts snapshots process.env through ConfigModule.forRoot.
import {
  originalAdminEnvironment,
  TRUSTED_ORIGIN,
} from "./admin-auth.environment";

import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { AdminRole, PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface ErrorBody {
  error: { code: string; details?: Record<string, unknown> };
}

interface StoreProductBody {
  id: string;
  provider: string;
  storeEnvironment: string;
  bundleId: string;
  productId: string;
  productType: string;
  status: string;
}

interface OfferBody {
  id: string;
  code: string;
  kind: string;
  status: string;
  grants: string[];
  products: StoreProductBody[];
}

interface OfferListBody {
  items: OfferBody[];
  total: number;
}

interface EntitlementListBody {
  items: { key: string; status: string; deckCodes: string[] }[];
  total: number;
}

interface CommerceStatusBody {
  storeEnvironment: string;
  activeOfferCount: number;
  offersWithoutValidatedProduct: number;
}

interface SyncRunBody {
  id: string;
  status: string;
  startedAt: string;
}

interface TransactionBody {
  id: string;
  maskedTransactionId: string;
  productId: string;
  claimState: string;
  grantedEntitlementKeys: string[];
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function sessionCookieOf(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const cookies: string[] = Array.isArray(header)
    ? header
    : typeof header === "string"
      ? [header]
      : [];
  const sessionCookie = cookies.find((cookie) =>
    cookie.startsWith("cf_admin_session="),
  );
  if (sessionCookie === undefined) {
    throw new Error("Admin session cookie is missing from the response");
  }
  return sessionCookie;
}

describe("Admin commerce section (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_commerce_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestProviderTokenSigner;

  const cookies = new Map<AdminRole, string>();
  const userIds = new Map<AdminRole, string>();

  // `NODE_ENV=test` means the deployment environment is `ci`, and the store
  // this deployment talks to follows from it (17-paid-decks-storekit §14).
  const STORE_ENVIRONMENT = "LOCAL_TEST";
  const BUNDLE_ID = "app.countryflags.mobile.dev";
  const PRODUCT_ID = "app.countryflags.deck.european_coats.lifetime.v1";

  const ACCOUNTS: { role: AdminRole; subject: string; email: string }[] = [
    {
      role: AdminRole.ADMIN,
      subject: "commerce-admin",
      email: "commerce-root@country-flags.test",
    },
    {
      role: AdminRole.PUBLISHER,
      subject: "commerce-publisher",
      email: "commerce-publisher@country-flags.test",
    },
    {
      role: AdminRole.EDITOR,
      subject: "commerce-editor",
      email: "commerce-editor@country-flags.test",
    },
    {
      role: AdminRole.VIEWER,
      subject: "commerce-viewer",
      email: "commerce-viewer@country-flags.test",
    },
  ];

  function cookieFor(role: AdminRole): string {
    const cookie = cookies.get(role);
    if (cookie === undefined) {
      throw new Error(`No session was established for ${role}`);
    }
    return cookie;
  }

  async function createOffer(code: string, grants: string[]): Promise<string> {
    const response = await request(httpServer)
      .post("/v1/admin/commerce/offers")
      .set("Cookie", cookieFor(AdminRole.EDITOR))
      .set("Origin", TRUSTED_ORIGIN)
      .send({ code, grants });
    expect(response.status).toBe(201);
    return bodyOf<OfferBody>(response).id;
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for admin commerce tests");
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
        `Admin commerce test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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
    httpServer = app.getHttpServer() as Server;
    database = app.get(PrismaService);
    signer = app.get(TestProviderTokenSigner);

    for (const account of ACCOUNTS) {
      const idToken = await signer.signGoogle({
        subject: account.subject,
        email: account.email,
      });
      const response = await request(httpServer)
        .post("/v1/admin/auth/google")
        .set("Origin", TRUSTED_ORIGIN)
        .send({ idToken });
      if (response.status !== 200) {
        throw new Error(`Fixture login failed for ${account.email}`);
      }
      const body = bodyOf<{ id: string }>(response);
      userIds.set(account.role, body.id);
      if (account.role !== AdminRole.VIEWER) {
        await database.adminUser.update({
          where: { id: body.id },
          data: { role: account.role },
        });
      }
      cookies.set(account.role, sessionCookieOf(response));
    }

    await database.entitlementDefinition.createMany({
      data: [
        { key: "entitlement.european_coats" },
        { key: "entitlement.african_flags" },
        { key: "entitlement.world_maps" },
      ],
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

  it("shows a VIEWER the storefront's health and the store it talks to", async () => {
    const response = await request(httpServer)
      .get("/v1/admin/commerce/status")
      .set("Cookie", cookieFor(AdminRole.VIEWER));

    expect(response.status).toBe(200);
    const body = bodyOf<CommerceStatusBody>(response);
    // The badge on every commerce screen comes from here.
    expect(body.storeEnvironment).toBe(STORE_ENVIRONMENT);
    expect(body).not.toHaveProperty("price");
  });

  it("lets an EDITOR declare no entitlement; that is a PUBLISHER's", async () => {
    const refused = await request(httpServer)
      .post("/v1/admin/commerce/entitlements")
      .set("Cookie", cookieFor(AdminRole.EDITOR))
      .set("Origin", TRUSTED_ORIGIN)
      .send({ key: "entitlement.state_flags" });
    expect(refused.status).toBe(403);
    expect(bodyOf<ErrorBody>(refused).error.code).toBe("ADMIN_ROLE_FORBIDDEN");

    const created = await request(httpServer)
      .post("/v1/admin/commerce/entitlements")
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({ key: "entitlement.state_flags" });
    expect(created.status).toBe(201);

    const listed = await request(httpServer)
      .get("/v1/admin/commerce/entitlements")
      .set("Cookie", cookieFor(AdminRole.VIEWER));
    expect(listed.status).toBe(200);
    expect(
      bodyOf<EntitlementListBody>(listed).items.map((item) => item.key),
    ).toContain("entitlement.state_flags");

    const audit = await database.adminAuditEvent.findMany({
      where: { action: "admin.commerce.entitlement_created" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorAdminUserId).toBe(userIds.get(AdminRole.PUBLISHER));
  });

  it("maps a product and activates an offer, and only a PUBLISHER may do either", async () => {
    const offerId = await createOffer("EUROPEAN_COATS_LIFETIME", [
      "entitlement.european_coats",
    ]);

    const refusedMapping = await request(httpServer)
      .post(`/v1/admin/commerce/offers/${offerId}/products`)
      .set("Cookie", cookieFor(AdminRole.EDITOR))
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        provider: "APPLE_APP_STORE",
        storeEnvironment: STORE_ENVIRONMENT,
        bundleId: BUNDLE_ID,
        productId: PRODUCT_ID,
      });
    expect(refusedMapping.status).toBe(403);

    // An offer cannot go on sale before something can sell it.
    const premature = await request(httpServer)
      .patch(`/v1/admin/commerce/offers/${offerId}`)
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({ status: "ACTIVE" });
    expect(premature.status).toBe(422);
    expect(bodyOf<ErrorBody>(premature).error.code).toBe(
      "STORE_PRODUCT_NOT_VALIDATED",
    );

    const mapped = await request(httpServer)
      .post(`/v1/admin/commerce/offers/${offerId}/products`)
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        provider: "APPLE_APP_STORE",
        storeEnvironment: STORE_ENVIRONMENT,
        bundleId: BUNDLE_ID,
        productId: PRODUCT_ID,
      });
    expect(mapped.status).toBe(201);
    const product = bodyOf<StoreProductBody>(mapped);
    expect(product.productType).toBe("NON_CONSUMABLE");
    expect(product.status).toBe("DRAFT");
    expect(product).not.toHaveProperty("price");

    const validated = await request(httpServer)
      .patch(`/v1/admin/commerce/products/${product.id}`)
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({ status: "VALIDATED" });
    expect(validated.status).toBe(200);

    const refusedActivation = await request(httpServer)
      .patch(`/v1/admin/commerce/offers/${offerId}`)
      .set("Cookie", cookieFor(AdminRole.EDITOR))
      .set("Origin", TRUSTED_ORIGIN)
      .send({ status: "ACTIVE" });
    expect(refusedActivation.status).toBe(403);

    const activated = await request(httpServer)
      .patch(`/v1/admin/commerce/offers/${offerId}`)
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({ status: "ACTIVE" });
    expect(activated.status).toBe(200);
    expect(bodyOf<OfferBody>(activated).status).toBe("ACTIVE");

    // Every mutation left a trace naming who made it.
    const audit = await database.adminAuditEvent.findMany({
      where: { targetId: offerId },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((event) => event.action)).toEqual([
      "admin.commerce.offer_created",
      "admin.commerce.offer_status_changed",
    ]);
    expect(audit[1]?.actorAdminUserId).toBe(userIds.get(AdminRole.PUBLISHER));

    const seenByViewer = await request(httpServer)
      .get("/v1/admin/commerce/offers")
      .set("Cookie", cookieFor(AdminRole.VIEWER));
    expect(seenByViewer.status).toBe(200);
    const offers = bodyOf<OfferListBody>(seenByViewer).items;
    expect(offers.find((offer) => offer.id === offerId)?.products).toHaveLength(
      1,
    );
  });

  /// Mapping a Sandbox product while looking at production is the mistake
  /// this section exists to prevent, so the server refuses it rather than
  /// trusting a screen to have shown the right badge.
  it("refuses a product that belongs to a different store", async () => {
    const offerId = await createOffer("AFRICAN_FLAGS_LIFETIME", [
      "entitlement.african_flags",
    ]);

    const response = await request(httpServer)
      .post(`/v1/admin/commerce/offers/${offerId}/products`)
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        provider: "APPLE_APP_STORE",
        storeEnvironment: "PRODUCTION",
        bundleId: "app.countryflags.mobile",
        productId: "app.countryflags.deck.african_flags.lifetime.v1",
      });

    expect(response.status).toBe(422);
    const body = bodyOf<ErrorBody>(response);
    expect(body.error.code).toBe("STORE_ENVIRONMENT_MISMATCH");
    expect(body.error.details?.storeEnvironment).toBe(STORE_ENVIRONMENT);
  });

  it("refuses to shrink the grants of an offer that has been on sale", async () => {
    const offerId = await createOffer("BUNDLE_LIFETIME", [
      "entitlement.european_coats",
      "entitlement.african_flags",
    ]);
    await database.commerceOffer.update({
      where: { id: offerId },
      data: { status: "ACTIVE" },
    });

    const response = await request(httpServer)
      .patch(`/v1/admin/commerce/offers/${offerId}`)
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({ grants: ["entitlement.european_coats"] });

    expect(response.status).toBe(422);
    expect(bodyOf<ErrorBody>(response).error.code).toBe(
      "COMMERCE_OFFER_GRANTS_SHRUNK",
    );

    const grown = await request(httpServer)
      .patch(`/v1/admin/commerce/offers/${offerId}`)
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        grants: [
          "entitlement.african_flags",
          "entitlement.european_coats",
          "entitlement.world_maps",
        ],
      });
    expect(grown.status).toBe(200);
    expect(bodyOf<OfferBody>(grown).grants).toEqual([
      "entitlement.african_flags",
      "entitlement.european_coats",
      "entitlement.world_maps",
    ]);
  });

  it("keeps the store sync an ADMIN's, and lets anyone watch it", async () => {
    const refused = await request(httpServer)
      .post("/v1/admin/commerce/store-sync-runs")
      .set("Cookie", cookieFor(AdminRole.PUBLISHER))
      .set("Origin", TRUSTED_ORIGIN)
      .send({});
    expect(refused.status).toBe(403);

    const started = await request(httpServer)
      .post("/v1/admin/commerce/store-sync-runs")
      .set("Cookie", cookieFor(AdminRole.ADMIN))
      .set("Origin", TRUSTED_ORIGIN)
      .send({});
    expect(started.status).toBe(202);
    const run = bodyOf<SyncRunBody>(started);
    expect(run.status).toBe("QUEUED");

    const second = await request(httpServer)
      .post("/v1/admin/commerce/store-sync-runs")
      .set("Cookie", cookieFor(AdminRole.ADMIN))
      .set("Origin", TRUSTED_ORIGIN)
      .send({});
    expect(second.status).toBe(409);
    expect(bodyOf<ErrorBody>(second).error.code).toBe(
      "STORE_SYNC_RUN_IN_FLIGHT",
    );

    const watched = await request(httpServer)
      .get(`/v1/admin/commerce/store-sync-runs/${run.id}`)
      .set("Cookie", cookieFor(AdminRole.VIEWER));
    expect(watched.status).toBe(200);
    expect(bodyOf<SyncRunBody>(watched).id).toBe(run.id);
  });

  it("shows a transaction to an ADMIN alone, masked and unsigned", async () => {
    const user = await database.user.create({ data: {} });
    const transaction = await database.storeTransaction.create({
      data: {
        provider: "APPLE_APP_STORE",
        storeEnvironment: STORE_ENVIRONMENT,
        transactionId: "2000000912345678",
        originalTransactionId: "2000000912345678",
        productId: PRODUCT_ID,
        userId: user.id,
        purchasedAt: new Date("2026-09-04T12:20:00Z"),
        signedPayloadHash: "a".repeat(64),
        verifiedAt: new Date("2026-09-04T12:20:01Z"),
      },
    });
    await database.userEntitlementGrant.create({
      data: {
        userId: user.id,
        entitlementKey: "entitlement.european_coats",
        sourceType: "STORE_TRANSACTION",
        sourceTransactionId: transaction.id,
      },
    });

    for (const role of [
      AdminRole.VIEWER,
      AdminRole.EDITOR,
      AdminRole.PUBLISHER,
    ]) {
      const denied = await request(httpServer)
        .get(`/v1/admin/commerce/transactions/${transaction.id}`)
        .set("Cookie", cookieFor(role));
      expect(denied.status).toBe(403);
    }

    const response = await request(httpServer)
      .get(`/v1/admin/commerce/transactions/${transaction.id}`)
      .set("Cookie", cookieFor(AdminRole.ADMIN));
    expect(response.status).toBe(200);
    const body = bodyOf<TransactionBody>(response);
    expect(body.maskedTransactionId).toBe("****5678");
    expect(body.grantedEntitlementKeys).toEqual(["entitlement.european_coats"]);
    // Nothing here can be replayed, and nothing names the buyer.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("2000000912345678");
    expect(serialized).not.toContain("a".repeat(64));
    expect(serialized).not.toContain(user.id);
  });

  it("refuses every commerce screen to a request without a session", async () => {
    const response = await request(httpServer).get("/v1/admin/commerce/status");
    expect(response.status).toBe(401);
  });
});
