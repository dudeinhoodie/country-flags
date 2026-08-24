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

interface Finding {
  level: string;
  code: string;
  subject: string;
}

interface ValidationResult {
  status: string;
  report: { blocking: number; warnings: number; findings: Finding[] };
}

interface Diff {
  baseContentVersion: string;
  isEmpty: boolean;
  decks: {
    deckKey: string | null;
    publishedCode: string | null;
    change: string;
    details: string[];
  }[];
  assets: unknown[];
}

interface DraftBody {
  id: string;
  revision: number;
  status: string;
  validationReport: { blocking: number } | null;
  document: {
    decks: { key: string; names: Record<string, unknown> }[];
  };
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
  const cookie = cookies.find((entry) => entry.startsWith("cf_admin_session="));
  if (cookie === undefined) {
    throw new Error("Admin session cookie is missing from the response");
  }
  return cookie;
}

describe("Admin draft validation and diff (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_release_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let editorCookie: string;
  let viewerCookie: string;
  let draftId: string;
  let fixtureVersion: string;

  async function currentDraft(): Promise<DraftBody> {
    const response = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}`)
      .set("Cookie", editorCookie);
    return bodyOf<DraftBody>(response);
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for release integration tests");
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
      throw new Error(`Release test migration failed:\n${migration.stderr}`);
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

    editorCookie = await login("release-editor", "editor6@country-flags.test");
    await database.adminUser.update({
      where: { email: "editor6@country-flags.test" },
      data: { role: AdminRole.EDITOR },
    });
    viewerCookie = await login("release-viewer", "viewer5@country-flags.test");

    fixtureVersion = (await importTestContent(database)).version;
    const created = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    if (created.status !== 201) {
      throw new Error("Fixture draft creation failed");
    }
    draftId = bodyOf<DraftBody>(created).id;
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

  it("reports an untouched draft as ready, and diffs it honestly", async () => {
    const validated = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/validate`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(validated.status).toBe(200);
    const result = bodyOf<ValidationResult>(validated);
    // The fixture release carries a small taxonomy, so decks built from
    // nodes it does not classify warn here; only the release build sees the
    // merged sources that resolve them.
    expect(result.report.blocking).toBe(0);
    expect(result.status).toBe("READY");
    expect(
      result.report.findings.every((finding) => finding.level === "warning"),
    ).toBe(true);

    // The verdict is stored, not just returned.
    expect((await currentDraft()).validationReport?.blocking).toBe(0);

    const diff = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/diff`)
      .set("Cookie", viewerCookie);
    expect(diff.status).toBe(200);
    const diffBody = bodyOf<Diff>(diff);
    expect(diffBody.baseContentVersion).toBe(fixtureVersion);
    // The draft carries the whole editorial catalog while the fixture
    // release publishes a subset of it, so every deck the fixture does not
    // publish is legitimately an addition. Nothing here is "changed":
    // untouched decks that both sides carry must match exactly.
    expect(diffBody.decks.length).toBeGreaterThan(0);
    expect(diffBody.decks.every((entry) => entry.change === "added")).toBe(
      true,
    );
  });

  it("shows a deck rename in the diff, in domain terms", async () => {
    const draft = await currentDraft();
    const deck = draft.document.decks[0];
    expect(deck).toBeDefined();

    const renamed = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draftId}/decks/${deck!.key}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision))
      .send({
        names: {
          ru: { name: "Переименованная колода", description: "Новое описание" },
          en: { name: "Renamed deck", description: "A new description" },
        },
      });
    expect(renamed.status).toBe(200);

    const diff = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/diff`)
      .set("Cookie", editorCookie);
    const diffBody = bodyOf<Diff>(diff);
    expect(diffBody.isEmpty).toBe(false);
    const entry = diffBody.decks.find((item) => item.deckKey === deck!.key);
    expect(entry?.change).toBe("changed");
    expect(entry?.details.join(" ")).toContain("Renamed deck");
  });

  it("blocks a draft whose deck loses a required locale", async () => {
    const draft = await currentDraft();
    const deck = draft.document.decks[0]!;
    // The deck endpoint refuses this, so the document endpoint is used to
    // produce a draft that is schema-valid but editorially broken.
    const document = draft.document as unknown as Record<string, unknown>;
    (document.decks as { key: string; names: Record<string, unknown> }[])[0] = {
      ...deck,
      names: { ru: deck.names.ru },
    };

    const patched = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draftId}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision))
      .send({ document });
    expect(patched.status).toBe(200);

    const validated = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/validate`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    const result = bodyOf<ValidationResult>(validated);
    expect(result.report.blocking).toBeGreaterThan(0);
    expect(result.status).toBe("FAILED");
    expect(
      result.report.findings.some(
        (finding) => finding.code === "DECK_LOCALIZATION_MISSING",
      ),
    ).toBe(true);
  });

  it("refuses validation below EDITOR and without a trusted origin", async () => {
    const asViewer = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/validate`)
      .set("Cookie", viewerCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(asViewer.status).toBe(403);

    const noOrigin = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/validate`)
      .set("Cookie", editorCookie);
    expect(noOrigin.status).toBe(403);
  });

  it("lets a viewer read the diff and the stored report", async () => {
    const diff = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/diff`)
      .set("Cookie", viewerCookie);
    expect(diff.status).toBe(200);

    const anonymous = await request(httpServer).get(
      `/v1/admin/content/drafts/${draftId}/diff`,
    );
    expect(anonymous.status).toBe(401);
  });

  it("never changes the published decks while validating or diffing", async () => {
    const published = await request(httpServer)
      .get("/v1/admin/content/decks?limit=100")
      .set("Cookie", editorCookie);
    const names = bodyOf<{ items: { nameRu: string | null }[] }>(
      published,
    ).items.map((deck) => deck.nameRu);
    expect(names).not.toContain("Переименованная колода");
  });
});
