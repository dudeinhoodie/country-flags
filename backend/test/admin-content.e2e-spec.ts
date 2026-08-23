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
import { PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface AdminEntitySummary {
  id: string;
  slug: string;
  isoAlpha2: string | null;
  nameRu: string | null;
  nameEn: string | null;
  flag: { licenseName: string; representations: { url: string }[] } | null;
}

interface AdminEntityDetail extends AdminEntitySummary {
  names: { locale: string; value: string; isPrimary: boolean }[];
  assets: unknown[];
}

interface AdminDeckSummary {
  id: string;
  code: string;
  cardCount: number;
  nameRu: string | null;
}

interface ListBody<Item> {
  items: Item[];
  total: number;
}

interface AdminContentStatusBody {
  activeVersion: string | null;
  entityCount: number;
  deckCount: number;
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

describe("Admin read-only published content (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_content_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let cookie: string;
  let activeVersion: string;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for admin content integration tests",
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
        `Admin content test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    const imported = await importTestContent(database);
    activeVersion = imported.version;

    const signer = app.get(TestProviderTokenSigner);
    const idToken = await signer.signGoogle({
      subject: "content-viewer",
      email: "viewer@country-flags.test",
    });
    const login = await request(httpServer)
      .post("/v1/admin/auth/google")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ idToken });
    if (login.status !== 200) {
      throw new Error("Fixture admin login failed");
    }
    cookie = sessionCookieOf(login);
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

  it("requires an admin session for every content read", async () => {
    for (const path of [
      "/v1/admin/content/status",
      "/v1/admin/content/entities",
      "/v1/admin/content/decks",
    ]) {
      const response = await request(httpServer).get(path);
      expect(response.status).toBe(401);
    }
  });

  it("reports the same active version the clients see", async () => {
    const status = await request(httpServer)
      .get("/v1/admin/content/status")
      .set("Cookie", cookie);
    expect(status.status).toBe(200);
    const body = bodyOf<AdminContentStatusBody>(status);
    expect(body.activeVersion).toBe(activeVersion);
    expect(body.entityCount).toBeGreaterThan(0);
    expect(body.deckCount).toBeGreaterThan(0);

    const manifest = await request(httpServer).get(
      "/v1/content/manifest?locale=ru",
    );
    expect(manifest.status).toBe(200);
    const manifestBody = bodyOf<Record<string, unknown>>(manifest);
    expect(manifestBody.contentVersion).toBe(body.activeVersion);
  });

  it("lists published entities with flags, license and search", async () => {
    const list = await request(httpServer)
      .get("/v1/admin/content/entities")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    const body = bodyOf<ListBody<AdminEntitySummary>>(list);
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBeGreaterThan(0);

    const withFlag = body.items.find((item) => item.flag !== null);
    expect(withFlag).toBeDefined();
    expect(withFlag?.flag?.licenseName).toBeTruthy();
    expect(withFlag?.flag?.representations.length).toBeGreaterThan(0);

    const needle = withFlag?.nameRu ?? withFlag?.nameEn ?? withFlag?.slug;
    const search = await request(httpServer)
      .get("/v1/admin/content/entities")
      .query({ q: needle })
      .set("Cookie", cookie);
    expect(search.status).toBe(200);
    const searchBody = bodyOf<ListBody<AdminEntitySummary>>(search);
    expect(searchBody.items.some((item) => item.id === withFlag?.id)).toBe(
      true,
    );
    expect(searchBody.total).toBeLessThanOrEqual(body.total);
  });

  it("serves an entity detail that matches the public read model", async () => {
    const list = await request(httpServer)
      .get("/v1/admin/content/entities?limit=1")
      .set("Cookie", cookie);
    const first = bodyOf<ListBody<AdminEntitySummary>>(list).items[0];
    expect(first).toBeDefined();

    const detail = await request(httpServer)
      .get(`/v1/admin/content/entities/${first!.id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    const detailBody = bodyOf<AdminEntityDetail>(detail);
    expect(detailBody.names.length).toBeGreaterThan(0);

    const publicEntity = await request(httpServer).get(
      `/v1/entities/${first!.id}?locale=ru`,
    );
    expect(publicEntity.status).toBe(200);
    const publicBody = bodyOf<{ name: { short: string } }>(publicEntity);
    expect(
      detailBody.names.some((name) => name.value === publicBody.name.short),
    ).toBe(true);
  });

  it("lists published decks with the same composition clients get", async () => {
    const list = await request(httpServer)
      .get("/v1/admin/content/decks")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    const body = bodyOf<ListBody<AdminDeckSummary>>(list);
    expect(body.total).toBeGreaterThan(0);

    const publicDecks = await request(httpServer).get(
      "/v1/decks?locale=ru&limit=100",
    );
    expect(publicDecks.status).toBe(200);
    const publicBody = bodyOf<{
      items: { id: string; cardCount: number }[];
    }>(publicDecks);
    expect(body.total).toBe(publicBody.items.length);
    for (const publicDeck of publicBody.items) {
      const adminDeck = body.items.find((item) => item.id === publicDeck.id);
      expect(adminDeck).toBeDefined();
      expect(adminDeck?.cardCount).toBe(publicDeck.cardCount);
    }
  });

  it("serves a deck detail with localizations and rule spec", async () => {
    const list = await request(httpServer)
      .get("/v1/admin/content/decks?limit=1")
      .set("Cookie", cookie);
    const first = bodyOf<ListBody<AdminDeckSummary>>(list).items[0];
    expect(first).toBeDefined();

    const detail = await request(httpServer)
      .get(`/v1/admin/content/decks/${first!.id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    const detailBody = bodyOf<{
      localizations: { locale: string; name: string }[];
    }>(detail);
    expect(
      detailBody.localizations.some(
        (localization) => localization.locale.toLowerCase() === "ru",
      ),
    ).toBe(true);

    const missing = await request(httpServer)
      .get("/v1/admin/content/decks/8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10")
      .set("Cookie", cookie);
    expect(missing.status).toBe(404);
  });
});
