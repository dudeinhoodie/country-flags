// Must be the first import: it fixes the admin environment before
// app.module.ts snapshots process.env through ConfigModule.forRoot.
import {
  originalAdminEnvironment,
  TRUSTED_ORIGIN,
} from "./admin-auth.environment";

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { AdminRole, PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface DeckDocument {
  key: string;
  names: Record<string, { name: string; description: string }>;
  [key: string]: unknown;
}

interface EditorialDocument {
  schemaVersion: number;
  decks: DeckDocument[];
  [key: string]: unknown;
}

interface DraftBody {
  id: string;
  baseContentVersion: string;
  baseCatalogCommit: string;
  schemaVersion: number;
  revision: number;
  status: string;
  document: EditorialDocument;
}

interface ErrorBody {
  error: { code: string };
}

const CATALOG_PATH = resolve(
  __dirname,
  "../../tools/content-pipeline/editorial/catalog.json",
);

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

function changedLineCount(before: string, after: string): number {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (beforeLines.length !== afterLines.length) {
    return -1;
  }
  let changed = 0;
  for (let index = 0; index < beforeLines.length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      changed += 1;
    }
  }
  return changed;
}

describe("Admin editorial drafts (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_drafts_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let editorCookie: string;
  let viewerCookie: string;
  let fixtureVersion: string;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for admin drafts integration tests",
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
        `Admin drafts test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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
    const signer = app.get(TestProviderTokenSigner);

    async function login(subject: string, email: string): Promise<string> {
      const idToken = await signer.signGoogle({ subject, email });
      const response = await request(httpServer)
        .post("/v1/admin/auth/google")
        .set("Origin", TRUSTED_ORIGIN)
        .send({ idToken });
      if (response.status !== 200) {
        throw new Error(`Fixture login failed for ${email}`);
      }
      return sessionCookieOf(response);
    }

    editorCookie = await login("drafts-editor", "editor3@country-flags.test");
    await database.adminUser.update({
      where: { email: "editor3@country-flags.test" },
      data: { role: AdminRole.EDITOR },
    });
    viewerCookie = await login("drafts-viewer", "viewer2@country-flags.test");
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

  it("refuses draft creation below the EDITOR role and without a trusted origin", async () => {
    const asViewer = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", viewerCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(asViewer.status).toBe(403);
    expect(bodyOf<ErrorBody>(asViewer).error.code).toBe("ADMIN_ROLE_FORBIDDEN");

    const noOrigin = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", editorCookie);
    expect(noOrigin.status).toBe(403);
    expect(bodyOf<ErrorBody>(noOrigin).error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("refuses to create a draft before any release is active", async () => {
    const response = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe("NO_ACTIVE_RELEASE");

    fixtureVersion = (await importTestContent(database)).version;
  });

  it("imports the catalog into a draft and exports it byte-identically", async () => {
    const created = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(created.status).toBe(201);
    const draft = bodyOf<DraftBody>(created);
    expect(draft.baseContentVersion).toBe(fixtureVersion);
    expect(draft.baseCatalogCommit).toBe("dev");
    expect(draft.schemaVersion).toBe(1);
    expect(draft.revision).toBe(1);
    expect(draft.status).toBe("DRAFT");

    const exported = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draft.id}/export`)
      .set("Cookie", viewerCookie);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-disposition"]).toContain("catalog.json");
    expect(exported.text).toBe(readFileSync(CATALOG_PATH, "utf8"));
  });

  it("edits one deck through optimistic concurrency, confining the diff", async () => {
    const created = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    const draft = bodyOf<DraftBody>(created);
    const originalExport = (
      await request(httpServer)
        .get(`/v1/admin/content/drafts/${draft.id}/export`)
        .set("Cookie", editorCookie)
    ).text;

    const document = draft.document;
    const deck = document.decks.find((entry) => entry.names.ru !== undefined);
    expect(deck).toBeDefined();
    deck!.names.ru!.name = `${deck!.names.ru!.name} (правка)`;

    const updated = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draft.id}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", '"1"')
      .send({ document });
    expect(updated.status).toBe(200);
    expect(bodyOf<DraftBody>(updated).revision).toBe(2);

    const editedExport = (
      await request(httpServer)
        .get(`/v1/admin/content/drafts/${draft.id}/export`)
        .set("Cookie", editorCookie)
    ).text;
    expect(editedExport).not.toBe(originalExport);
    expect(changedLineCount(originalExport, editedExport)).toBe(1);

    // Stale revision: a second writer must not overwrite the first.
    const stale = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draft.id}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", '"1"')
      .send({ document });
    expect(stale.status).toBe(409);
    expect(bodyOf<ErrorBody>(stale).error.code).toBe("DRAFT_REVISION_CONFLICT");

    const missingHeader = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draft.id}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ document });
    expect(missingHeader.status).toBe(428);
  });

  it("rejects a document that violates the editorial schema", async () => {
    const created = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    const draft = bodyOf<DraftBody>(created);
    const document = draft.document;
    (document.decks[0] as Record<string, unknown>).kind = "bogus";

    const response = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draft.id}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", '"1"')
      .send({ document });
    expect(response.status).toBe(422);
    expect(bodyOf<ErrorBody>(response).error.code).toBe(
      "DRAFT_DOCUMENT_INVALID",
    );

    const untouched = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draft.id}`)
      .set("Cookie", editorCookie);
    expect(bodyOf<DraftBody>(untouched).revision).toBe(1);
  });

  it("serves the draft list to viewers but refuses their edits", async () => {
    const list = await request(httpServer)
      .get("/v1/admin/content/drafts")
      .set("Cookie", viewerCookie);
    expect(list.status).toBe(200);
    const listBody = bodyOf<{ items: { id: string }[]; total: number }>(list);
    expect(listBody.total).toBeGreaterThan(0);
    expect(listBody.items.length).toBeGreaterThan(0);

    const patch = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${listBody.items[0]!.id}`)
      .set("Cookie", viewerCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", '"1"')
      .send({ document: {} });
    expect(patch.status).toBe(403);
    expect(bodyOf<ErrorBody>(patch).error.code).toBe("ADMIN_ROLE_FORBIDDEN");
  });

  it("writes the draft lifecycle into the audit trail", async () => {
    const created = await database.adminAuditEvent.count({
      where: { action: "admin.draft.created" },
    });
    expect(created).toBeGreaterThanOrEqual(3);
    const updated = await database.adminAuditEvent.count({
      where: { action: "admin.draft.document_updated" },
    });
    expect(updated).toBe(1);
  });
});
