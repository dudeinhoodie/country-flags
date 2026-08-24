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
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface AssetBody {
  id: string;
  mimeType: string;
  sha256: string;
  aspectRatio: number | null;
  width: number | null;
  replacementReason: string | null;
  validationStatus: string;
}

interface ErrorBody {
  error: { code: string; message: string };
}

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#2222ff"/></svg>';
const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2" onload="steal()"><rect/></svg>';

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
  const cookie = cookies.find((entry) => entry.startsWith("cf_admin_session="));
  if (cookie === undefined) {
    throw new Error("Admin session cookie is missing from the response");
  }
  return cookie;
}

describe("Admin draft asset upload (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_assets_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let editorCookie: string;
  let viewerCookie: string;
  let draftId: string;

  function uploadRequest(cookie: string): request.Test {
    return request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/assets`)
      .set("Cookie", cookie)
      .set("Origin", TRUSTED_ORIGIN)
      .field("entityContentKey", "country.test")
      .field("assetType", "FLAG")
      .field("sourceUrl", "https://commons.example.test/flag.svg")
      .field("licenseName", "CC0-1.0")
      .field("replacementReason", "The upstream shade was wrong.");
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for asset upload tests");
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
        `Asset upload test migration failed:\n${migration.stderr}`,
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

    editorCookie = await login("assets-editor", "editor5@country-flags.test");
    await database.adminUser.update({
      where: { email: "editor5@country-flags.test" },
      data: { role: AdminRole.EDITOR },
    });
    viewerCookie = await login("assets-viewer", "viewer4@country-flags.test");

    await importTestContent(database);
    const created = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    if (created.status !== 201) {
      throw new Error("Fixture draft creation failed");
    }
    draftId = bodyOf<{ id: string }>(created).id;
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

  it("accepts a safe SVG and computes its facts server-side", async () => {
    const response = await uploadRequest(editorCookie).attach(
      "file",
      Buffer.from(SAFE_SVG, "utf8"),
      // The name and type claimed here are deliberately wrong: the bytes decide.
      { filename: "flag.png", contentType: "image/png" },
    );
    expect(response.status).toBe(201);
    const asset = bodyOf<AssetBody>(response);
    expect(asset.mimeType).toBe("image/svg+xml");
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.aspectRatio).toBeCloseTo(1.5, 5);
    expect(asset.validationStatus).toBe("VALID");
    expect(asset.replacementReason).toBe("The upstream shade was wrong.");

    const preview = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/assets/${asset.id}/preview`)
      .set("Cookie", viewerCookie);
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toContain("image/svg+xml");
    expect(preview.headers["cache-control"]).toContain("no-store");
    expect(preview.headers["content-security-policy"]).toContain("default-src");
  });

  it("is idempotent for identical bytes", async () => {
    const first = await uploadRequest(editorCookie).attach(
      "file",
      Buffer.from(SAFE_SVG, "utf8"),
      { filename: "flag.svg", contentType: "image/svg+xml" },
    );
    const second = await uploadRequest(editorCookie).attach(
      "file",
      Buffer.from(SAFE_SVG, "utf8"),
      { filename: "flag.svg", contentType: "image/svg+xml" },
    );
    expect(bodyOf<AssetBody>(second).id).toBe(bodyOf<AssetBody>(first).id);
    expect(await database.draftAsset.count({ where: { draftId } })).toBe(1);
  });

  it("refuses hostile drawings, foreign formats and empty files", async () => {
    const hostile = await uploadRequest(editorCookie).attach(
      "file",
      Buffer.from(HOSTILE_SVG, "utf8"),
      { filename: "flag.svg", contentType: "image/svg+xml" },
    );
    expect(hostile.status).toBe(422);
    expect(bodyOf<ErrorBody>(hostile).error.code).toBe("ASSET_REJECTED");

    const gif = await uploadRequest(editorCookie).attach(
      "file",
      Buffer.from("GIF89a not really an image", "utf8"),
      { filename: "flag.svg", contentType: "image/svg+xml" },
    );
    expect(gif.status).toBe(422);

    const empty = await uploadRequest(editorCookie).attach(
      "file",
      Buffer.alloc(0),
      { filename: "flag.svg", contentType: "image/svg+xml" },
    );
    expect(empty.status).toBe(422);
  });

  it("requires provenance and the replacement reason", async () => {
    const response = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/assets`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .field("entityContentKey", "country.test")
      .field("assetType", "FLAG")
      .attach("file", Buffer.from(SAFE_SVG, "utf8"), {
        filename: "flag.svg",
        contentType: "image/svg+xml",
      });
    expect(response.status).toBe(422);
    expect(bodyOf<ErrorBody>(response).error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses uploads below EDITOR and from an untrusted origin", async () => {
    const asViewer = await uploadRequest(viewerCookie).attach(
      "file",
      Buffer.from(SAFE_SVG, "utf8"),
      { filename: "flag.svg", contentType: "image/svg+xml" },
    );
    expect(asViewer.status).toBe(403);

    const foreignOrigin = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/assets`)
      .set("Cookie", editorCookie)
      .set("Origin", "https://evil.example")
      .field("entityContentKey", "country.test")
      .field("assetType", "FLAG")
      .field("sourceUrl", "https://commons.example.test/flag.svg")
      .field("licenseName", "CC0-1.0")
      .field("replacementReason", "Trying from elsewhere.")
      .attach("file", Buffer.from(SAFE_SVG, "utf8"), {
        filename: "flag.svg",
        contentType: "image/svg+xml",
      });
    expect(foreignOrigin.status).toBe(403);
    expect(bodyOf<ErrorBody>(foreignOrigin).error.code).toBe(
      "ORIGIN_NOT_ALLOWED",
    );
  });

  it("keeps draft objects out of the published bucket and audits the upload", async () => {
    const assets = await database.draftAsset.findMany({ where: { draftId } });
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      // The key never leaves the drafts prefix, so a cleanup or a public
      // read of the content bucket cannot reach it.
      expect(asset.objectKey.startsWith(`drafts/${draftId}/`)).toBe(true);
      expect(asset.objectKey).not.toContain("content-bundles/");
    }
    expect(
      await database.adminAuditEvent.count({
        where: { action: "admin.draft.asset_uploaded" },
      }),
    ).toBeGreaterThan(0);
  });

  it("removes an asset from the draft", async () => {
    const [asset] = await database.draftAsset.findMany({ where: { draftId } });
    expect(asset).toBeDefined();
    const removed = await request(httpServer)
      .delete(`/v1/admin/content/drafts/${draftId}/assets/${asset!.id}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(removed.status).toBe(204);
    expect(await database.draftAsset.count({ where: { draftId } })).toBe(0);
    expect(
      await database.adminAuditEvent.count({
        where: { action: "admin.draft.asset_removed" },
      }),
    ).toBe(1);
  });
});
