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
  entityContentKey: string;
  assetType: string;
  variant: string;
  mimeType: string;
  sha256: string;
  aspectRatio: number | null;
  width: number | null;
  licenseName: string | null;
  replacementReason: string | null;
  validationStatus: string;
  validFrom: string | null;
  validTo: string | null;
  localizations: Record<string, { displayName?: string; description?: string }>;
}

interface ErrorBody {
  error: { code: string; message: string };
}

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#2222ff"/></svg>';
const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2" onload="steal()"><rect/></svg>';
// One entity now carries several drawings, so the fixtures have to be
// several drawings: the object key is the checksum, and identical bytes
// would be the same stored object.
const FLAG_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#c81428"/></svg>';
const COAT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><circle cx="200" cy="250" r="180" fill="#e0b400"/></svg>';
// Legitimate as a flag; as a coat of arms it is the shape whose crown,
// supporters and ribbon disappear when a near-square card fits it.
const BANNER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 100"><rect width="800" height="100" fill="#1e5aa8"/></svg>';

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

  // From here on the draft starts empty again: the removal test above took
  // the last flag out of it.
  describe("one entity, several symbols", () => {
    async function draftRevision(): Promise<number> {
      const response = await request(httpServer)
        .get(`/v1/admin/content/drafts/${draftId}`)
        .set("Cookie", editorCookie);
      return bodyOf<{ revision: number }>(response).revision;
    }

    function upload(
      body: string,
      fields: Record<string, string>,
    ): request.Test {
      const post = request(httpServer)
        .post(`/v1/admin/content/drafts/${draftId}/assets`)
        .set("Cookie", editorCookie)
        .set("Origin", TRUSTED_ORIGIN)
        .field("sourceUrl", "https://commons.example.test/symbol.svg")
        .field("licenseName", "CC0-1.0")
        .field("replacementReason", "The upstream drawing was wrong.");
      for (const [key, value] of Object.entries(fields)) {
        post.field(key, value);
      }
      return post.attach("file", Buffer.from(body, "utf8"), {
        filename: "symbol.svg",
        contentType: "image/svg+xml",
      });
    }

    let coatId: string;

    it("holds a flag and a coat of arms for one entity at once", async () => {
      const flag = await upload(FLAG_SVG, {
        entityContentKey: "country.test",
        assetType: "FLAG",
      });
      expect(flag.status).toBe(201);

      const coat = await upload(COAT_SVG, {
        entityContentKey: "country.test",
        assetType: "COAT_OF_ARMS",
      });
      expect(coat.status).toBe(201);
      coatId = bodyOf<AssetBody>(coat).id;
      expect(coatId).not.toBe(bodyOf<AssetBody>(flag).id);

      // Neither overwrote the other: they differ by type, which is part of
      // a draft symbol's identity.
      const listed = await request(httpServer)
        .get(`/v1/admin/content/drafts/${draftId}/assets`)
        .set("Cookie", editorCookie);
      const items = bodyOf<{ items: AssetBody[] }>(listed).items.filter(
        (asset) => asset.entityContentKey === "country.test",
      );
      expect(items.map((asset) => asset.assetType).sort()).toEqual([
        "COAT_OF_ARMS",
        "FLAG",
      ]);
    });

    it("holds a coat of arms to a safe area a flag does not need", async () => {
      const asCoat = await upload(BANNER_SVG, {
        entityContentKey: "country.banner",
        assetType: "COAT_OF_ARMS",
      });
      expect(asCoat.status).toBe(422);
      expect(bodyOf<ErrorBody>(asCoat).error.code).toBe(
        "COAT_OF_ARMS_ASPECT_UNSAFE",
      );

      // The same drawing is an ordinary flag.
      const asFlag = await upload(BANNER_SVG, {
        entityContentKey: "country.banner",
        assetType: "FLAG",
      });
      expect(asFlag.status).toBe(201);
    });

    it("round-trips the symbol's own name and story", async () => {
      const before = await draftRevision();
      const drawing = await database.draftAsset.findUniqueOrThrow({
        where: { id: coatId },
        select: { sha256: true },
      });
      const patched = await request(httpServer)
        .patch(`/v1/admin/content/drafts/${draftId}/assets/${coatId}`)
        .set("Cookie", editorCookie)
        .set("Origin", TRUSTED_ORIGIN)
        .set("If-Match", String(before))
        .send({
          licenseName: "CC BY-SA 4.0",
          validFrom: "1950-09-20",
          localizations: {
            en: { displayName: "Federal eagle", description: "Adopted 1950." },
            ru: { displayName: "Федеральный орёл" },
          },
        });
      expect(patched.status).toBe(200);
      // The drawing lives in its own table, but the draft has moved: a tab
      // holding the old revision is stale.
      expect(bodyOf<{ revision: number }>(patched).revision).toBe(before + 1);

      const listed = await request(httpServer)
        .get(`/v1/admin/content/drafts/${draftId}/assets`)
        .set("Cookie", editorCookie);
      const coat = bodyOf<{ items: AssetBody[] }>(listed).items.find(
        (asset) => asset.id === coatId,
      );
      expect(coat?.licenseName).toBe("CC BY-SA 4.0");
      expect(coat?.validFrom).toBe("1950-09-20");
      expect(coat?.localizations).toEqual({
        en: { displayName: "Federal eagle", description: "Adopted 1950." },
        ru: { displayName: "Федеральный орёл" },
      });
      // The bytes are untouched: correcting a licence is not replacing a
      // drawing.
      expect(coat?.sha256).toBe(drawing.sha256);
    });

    it("refuses a patch that does not say which revision it read", async () => {
      const missing = await request(httpServer)
        .patch(`/v1/admin/content/drafts/${draftId}/assets/${coatId}`)
        .set("Cookie", editorCookie)
        .set("Origin", TRUSTED_ORIGIN)
        .send({ attribution: "Wikimedia Commons" });
      expect(missing.status).toBe(428);

      const stale = await request(httpServer)
        .patch(`/v1/admin/content/drafts/${draftId}/assets/${coatId}`)
        .set("Cookie", editorCookie)
        .set("Origin", TRUSTED_ORIGIN)
        .set("If-Match", "1")
        .send({ attribution: "Wikimedia Commons" });
      expect(stale.status).toBe(409);
      expect(bodyOf<ErrorBody>(stale).error.code).toBe(
        "DRAFT_REVISION_CONFLICT",
      );
    });

    it("refuses a validity that ends before it starts", async () => {
      const inverted = await request(httpServer)
        .patch(`/v1/admin/content/drafts/${draftId}/assets/${coatId}`)
        .set("Cookie", editorCookie)
        .set("Origin", TRUSTED_ORIGIN)
        .set("If-Match", String(await draftRevision()))
        .send({ validTo: "1949-01-01" });
      expect(inverted.status).toBe(422);
      expect(bodyOf<ErrorBody>(inverted).error.code).toBe(
        "ASSET_VALIDITY_INVERTED",
      );
    });

    it("retires a symbol without deleting it", async () => {
      const retired = await request(httpServer)
        .patch(`/v1/admin/content/drafts/${draftId}/assets/${coatId}`)
        .set("Cookie", editorCookie)
        .set("Origin", TRUSTED_ORIGIN)
        .set("If-Match", String(await draftRevision()))
        .send({ validTo: "1990-10-03" });
      expect(retired.status).toBe(200);

      // The row is still the draft's answer for that entity, and the act
      // reads as a retirement rather than as another metadata edit.
      const stored = await database.draftAsset.findUnique({
        where: { id: coatId },
      });
      expect(stored).not.toBeNull();
      expect(stored?.validTo?.toISOString().slice(0, 10)).toBe("1990-10-03");
      expect(
        await database.adminAuditEvent.count({
          where: { action: "admin.draft.asset_retired", targetId: coatId },
        }),
      ).toBe(1);
    });

    it("refuses the same bytes filed as a different symbol", async () => {
      const again = await upload(COAT_SVG, {
        entityContentKey: "country.other",
        assetType: "COAT_OF_ARMS",
      });
      expect(again.status).toBe(422);
      expect(bodyOf<ErrorBody>(again).error.code).toBe(
        "ASSET_BYTES_ALREADY_USED",
      );
    });
  });
});
