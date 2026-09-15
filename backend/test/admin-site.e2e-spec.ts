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
import { InMemoryObjectStorage } from "../src/infrastructure/object-storage/in-memory-object-storage";
import { SITE_OBJECT_STORAGE } from "../src/modules/admin-site/site-snapshot-store";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface ErrorBody {
  error: { code: string; details?: Record<string, unknown> };
}

interface DocumentBody {
  slug: string;
  locale: string;
  title: string;
  revision: number;
  publishedVersion: number | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  body: string;
  html: string;
}

interface VersionBody {
  version: number;
  title: string;
  note: string | null;
  current: boolean;
  body?: string;
  html?: string;
}

interface SnapshotIndex {
  documents: { slug: string; locale: string; title: string; version: number }[];
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

describe("Admin site documents (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_site_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let snapshot: InMemoryObjectStorage;
  let viewerCookie: string;
  let editorCookie: string;
  let publisherCookie: string;
  let adminCookie: string;

  async function readSnapshot<T>(key: string): Promise<T | null> {
    const bytes = await snapshot.getObject(key);
    return bytes === null ? null : (JSON.parse(bytes.toString("utf8")) as T);
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for admin site integration tests",
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
        `Admin site test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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
    snapshot = app.get<InMemoryObjectStorage>(SITE_OBJECT_STORAGE);

    const signer = app.get(TestProviderTokenSigner);
    async function login(
      subject: string,
      email: string,
      role: AdminRole,
    ): Promise<string> {
      const idToken = await signer.signGoogle({ subject, email });
      const response = await request(httpServer)
        .post("/v1/admin/auth/google")
        .set("Origin", TRUSTED_ORIGIN)
        .send({ idToken });
      if (response.status !== 200) {
        throw new Error(`Fixture login failed for ${email}`);
      }
      await database.adminUser.update({ where: { email }, data: { role } });
      // The role is read from the session's user on every request, so a
      // cookie issued before the promotion carries the new role.
      return sessionCookieOf(response);
    }
    viewerCookie = await login(
      "site-viewer",
      "viewer2@country-flags.test",
      AdminRole.VIEWER,
    );
    editorCookie = await login(
      "site-editor",
      "editor2@country-flags.test",
      AdminRole.EDITOR,
    );
    publisherCookie = await login(
      "site-publisher",
      "publisher2@country-flags.test",
      AdminRole.PUBLISHER,
    );
    adminCookie = await login(
      "site-admin",
      "admin2@country-flags.test",
      AdminRole.ADMIN,
    );
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

  it("requires an admin session, and says the snapshot store is in-process", async () => {
    expect(
      (await request(httpServer).get("/v1/admin/site/documents")).status,
    ).toBe(401);

    const status = await request(httpServer)
      .get("/v1/admin/site/status")
      .set("Cookie", viewerCookie);
    expect(status.status).toBe(200);
    expect(bodyOf<Record<string, unknown>>(status)).toEqual({
      snapshotConfigured: false,
      snapshotBaseUrl: null,
      siteUrl: null,
      publishedCount: 0,
    });
  });

  it("lets an editor draft and a publisher publish, and writes the snapshot", async () => {
    const refused = await request(httpServer)
      .post("/v1/admin/site/documents")
      .set("Cookie", viewerCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ slug: "privacy", locale: "en", title: "Privacy Policy" });
    expect(refused.status).toBe(403);
    expect(bodyOf<ErrorBody>(refused).error.code).toBe("ADMIN_ROLE_FORBIDDEN");

    const created = await request(httpServer)
      .post("/v1/admin/site/documents")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        slug: "privacy",
        locale: "en",
        title: "Privacy Policy",
        body: "## Accounts\n\nAn account is **optional**.\n",
      });
    expect(created.status).toBe(201);
    const draft = bodyOf<DocumentBody>(created);
    expect(draft).toMatchObject({
      slug: "privacy",
      locale: "en",
      revision: 1,
      publishedVersion: null,
      hasUnpublishedChanges: true,
    });
    expect(draft.html).toContain("<h2>Accounts</h2>");

    const duplicate = await request(httpServer)
      .post("/v1/admin/site/documents")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ slug: "privacy", locale: "en", title: "Again" });
    expect(duplicate.status).toBe(409);
    expect(bodyOf<ErrorBody>(duplicate).error.code).toBe(
      "SITE_DOCUMENT_EXISTS",
    );

    // A stale revision is refused rather than merged.
    const stale = await request(httpServer)
      .patch("/v1/admin/site/documents/privacy/en")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ revision: 7, body: "x" });
    expect(stale.status).toBe(409);
    expect(bodyOf<ErrorBody>(stale).error).toMatchObject({
      code: "SITE_DOCUMENT_REVISION_CONFLICT",
      details: { currentRevision: 1 },
    });

    const updated = await request(httpServer)
      .patch("/v1/admin/site/documents/privacy/en")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        revision: 1,
        body: "## Accounts\n\nAn account is optional.\n",
      });
    expect(updated.status).toBe(200);
    expect(bodyOf<DocumentBody>(updated).revision).toBe(2);

    // Publishing is a PUBLISHER's decision, and it needs the revision too.
    const belowRole = await request(httpServer)
      .post("/v1/admin/site/documents/privacy/en/publish")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ revision: 2 });
    expect(belowRole.status).toBe(403);

    const published = await request(httpServer)
      .post("/v1/admin/site/documents/privacy/en/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ revision: 2, note: "First publication" });
    expect(published.status).toBe(200);
    expect(bodyOf<DocumentBody>(published)).toMatchObject({
      revision: 2,
      publishedVersion: 1,
      hasUnpublishedChanges: false,
    });

    const index = await readSnapshot<SnapshotIndex>("documents/index.json");
    expect(index?.documents).toEqual([
      expect.objectContaining({
        slug: "privacy",
        locale: "en",
        title: "Privacy Policy",
        version: 1,
      }),
    ]);
    const file = await readSnapshot<{ html: string; version: number }>(
      "documents/privacy.en.json",
    );
    expect(file?.version).toBe(1);
    expect(file?.html).toContain("<h2>Accounts</h2>");

    const status = await request(httpServer)
      .get("/v1/admin/site/status")
      .set("Cookie", viewerCookie);
    expect(bodyOf<{ publishedCount: number }>(status).publishedCount).toBe(1);

    // A further edit shows as unpublished until the next publish.
    const edited = await request(httpServer)
      .patch("/v1/admin/site/documents/privacy/en")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ revision: 2, title: "Privacy" });
    expect(bodyOf<DocumentBody>(edited)).toMatchObject({
      revision: 3,
      publishedVersion: 1,
      hasUnpublishedChanges: true,
    });

    const list = await request(httpServer)
      .get("/v1/admin/site/documents")
      .set("Cookie", viewerCookie);
    expect(list.status).toBe(200);
    expect(bodyOf<{ items: DocumentBody[] }>(list).items).toEqual([
      expect.objectContaining({
        slug: "privacy",
        locale: "en",
        title: "Privacy",
        publishedVersion: 1,
        hasUnpublishedChanges: true,
      }),
    ]);
  });

  it("keeps every version, restores one into the draft and unpublishes", async () => {
    const second = await request(httpServer)
      .post("/v1/admin/site/documents/privacy/en/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ revision: 3 });
    expect(second.status).toBe(200);
    expect(bodyOf<DocumentBody>(second).publishedVersion).toBe(2);

    const versions = await request(httpServer)
      .get("/v1/admin/site/documents/privacy/en/versions")
      .set("Cookie", viewerCookie);
    expect(versions.status).toBe(200);
    expect(bodyOf<{ items: VersionBody[] }>(versions).items).toEqual([
      expect.objectContaining({ version: 2, title: "Privacy", current: true }),
      expect.objectContaining({
        version: 1,
        title: "Privacy Policy",
        note: "First publication",
        current: false,
      }),
    ]);

    const first = await request(httpServer)
      .get("/v1/admin/site/documents/privacy/en/versions/1")
      .set("Cookie", viewerCookie);
    expect(first.status).toBe(200);
    expect(bodyOf<VersionBody>(first).body).toContain("**optional**");

    const restored = await request(httpServer)
      .post("/v1/admin/site/documents/privacy/en/versions/1/restore")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ revision: 3 });
    expect(restored.status).toBe(200);
    expect(bodyOf<DocumentBody>(restored)).toMatchObject({
      revision: 4,
      title: "Privacy Policy",
      publishedVersion: 2,
      hasUnpublishedChanges: true,
    });

    // Deleting what the site serves is refused; unpublishing removes the
    // file and the index entry, then deletion is allowed.
    const stillPublished = await request(httpServer)
      .delete("/v1/admin/site/documents/privacy/en")
      .set("Cookie", adminCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(stillPublished.status).toBe(409);
    expect(bodyOf<ErrorBody>(stillPublished).error.code).toBe(
      "SITE_DOCUMENT_PUBLISHED",
    );

    const unpublished = await request(httpServer)
      .post("/v1/admin/site/documents/privacy/en/unpublish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(unpublished.status).toBe(200);
    expect(bodyOf<DocumentBody>(unpublished).publishedVersion).toBeNull();
    expect(await snapshot.getObject("documents/privacy.en.json")).toBeNull();
    expect(
      (await readSnapshot<SnapshotIndex>("documents/index.json"))?.documents,
    ).toEqual([]);

    const belowAdmin = await request(httpServer)
      .delete("/v1/admin/site/documents/privacy/en")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(belowAdmin.status).toBe(403);

    const deleted = await request(httpServer)
      .delete("/v1/admin/site/documents/privacy/en")
      .set("Cookie", adminCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(deleted.status).toBe(204);
    expect(
      (
        await request(httpServer)
          .get("/v1/admin/site/documents/privacy/en")
          .set("Cookie", viewerCookie)
      ).status,
    ).toBe(404);

    const audit = await database.adminAuditEvent.findMany({
      where: { targetType: "site_document" },
      orderBy: { occurredAt: "asc" },
      select: { action: true },
    });
    expect(audit.map((event) => event.action)).toEqual([
      "site.document.created",
      "site.document.updated",
      "site.document.published",
      "site.document.updated",
      "site.document.published",
      "site.document.restored",
      "site.document.unpublished",
      "site.document.deleted",
    ]);
  });

  it("refuses a mutation from an untrusted origin and renders a preview", async () => {
    const elsewhere = await request(httpServer)
      .post("/v1/admin/site/documents")
      .set("Cookie", editorCookie)
      .set("Origin", "https://elsewhere.test")
      .send({ slug: "terms", locale: "en", title: "Terms" });
    expect(elsewhere.status).toBe(403);
    expect(bodyOf<ErrorBody>(elsewhere).error.code).toBe("ORIGIN_NOT_ALLOWED");

    const preview = await request(httpServer)
      .post("/v1/admin/site/documents/preview")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ body: "# Hello\n\n<b>raw</b>" });
    expect(preview.status).toBe(200);
    const html = bodyOf<{ html: string }>(preview).html;
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
  });
});
