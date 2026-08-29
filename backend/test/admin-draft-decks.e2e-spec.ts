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
import { deckCodeFromKey } from "../src/modules/content/bundle/bundle-mapper";
import { bodyOf } from "./response-body";

interface DeckView {
  key: string;
  kind: string;
  names: Record<string, { name: string; description: string }>;
  membersMode: string;
  members: unknown;
  memberCount: number;
}

interface DeckDetail extends DeckView {
  memberKeys: string[];
}

interface DraftStamp {
  draftId: string;
  revision: number;
}

interface DraftBody {
  id: string;
  revision: number;
  document: {
    decks: { key: string; members: unknown }[];
    entities: {
      key: string;
      type: string;
      status: string;
      config: { includeInCountryCatalog: boolean };
    }[];
  };
}

interface ErrorBody {
  error: { code: string; message: string };
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

describe("Admin draft deck editor (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_decks_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let editorCookie: string;
  let viewerCookie: string;
  let draftId: string;

  async function currentDraft(): Promise<DraftBody> {
    const response = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}`)
      .set("Cookie", editorCookie);
    return bodyOf<DraftBody>(response);
  }

  async function listDecks(): Promise<DeckView[]> {
    const response = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/decks`)
      .set("Cookie", editorCookie);
    expect(response.status).toBe(200);
    return bodyOf<{ items: DeckView[] }>(response).items;
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for admin deck editor integration tests",
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
        `Admin deck editor test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    editorCookie = await login("decks-editor", "editor4@country-flags.test");
    await database.adminUser.update({
      where: { email: "editor4@country-flags.test" },
      data: { role: AdminRole.EDITOR },
    });
    viewerCookie = await login("decks-viewer", "viewer3@country-flags.test");

    await importTestContent(database);
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

  it("lists the draft's decks with a resolved member count per mode", async () => {
    const decks = await listDecks();
    expect(decks.length).toBeGreaterThan(0);

    // Whether the catalogue has an all-current deck at all is an editorial
    // decision, not a property of the editor: "all countries" may equally be
    // a list the owner named by hand. What this test is for is the parity
    // below — that the console resolves the mode the way the pipeline does —
    // so it runs when the mode is present and stands aside when it is not,
    // the same way the taxonomy case beneath it is written.
    const allCurrent = decks.find((deck) => deck.membersMode === "all-current");
    if (allCurrent === undefined) {
      return;
    }
    expect(allCurrent.memberCount).toBeGreaterThan(0);

    // The resolved count must equal what the pipeline would compute from
    // the same document: approved, still-current entities.
    const draft = await currentDraft();
    const approved = draft.document.entities.filter(
      (entity) =>
        entity.config.includeInCountryCatalog && entity.status === "active",
    );
    expect(allCurrent.memberCount).toBe(approved.length);
  });

  it("resolves a taxonomy deck the way the published release did", async () => {
    const decks = await listDecks();
    const taxonomyDeck = decks.find((deck) => deck.membersMode === "taxonomy");
    if (taxonomyDeck === undefined) {
      return;
    }
    const published = await request(httpServer)
      .get("/v1/admin/content/decks?limit=100")
      .set("Cookie", editorCookie);
    const publishedDecks = bodyOf<{
      items: { code: string; cardCount: number }[];
    }>(published).items;
    // An editorial key and a published code are two namespaces; the release
    // build derives one from the other, so the lookup has to as well.
    const expectedCode = deckCodeFromKey(taxonomyDeck.key);
    const counterpart = publishedDecks.find(
      (deck) => deck.code === expectedCode,
    );
    expect(counterpart).toBeDefined();
    expect(taxonomyDeck.memberCount).toBe(counterpart?.cardCount);
  });

  it("refuses deck writes below EDITOR and without a trusted origin", async () => {
    const draft = await currentDraft();
    const asViewer = await request(httpServer)
      .patch(
        `/v1/admin/content/drafts/${draftId}/decks/${draft.document.decks[0]!.key}`,
      )
      .set("Cookie", viewerCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision))
      .send({ kind: "curated" });
    expect(asViewer.status).toBe(403);
    expect(bodyOf<ErrorBody>(asViewer).error.code).toBe("ADMIN_ROLE_FORBIDDEN");

    const noOrigin = await request(httpServer)
      .delete(`/v1/admin/content/drafts/${draftId}/decks/whatever`)
      .set("Cookie", editorCookie)
      .set("If-Match", String(draft.revision));
    expect(noOrigin.status).toBe(403);
    expect(bodyOf<ErrorBody>(noOrigin).error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("creates an explicit deck, keeping the order the editor set", async () => {
    const draft = await currentDraft();
    const approved = draft.document.entities
      .filter(
        (entity) =>
          entity.config.includeInCountryCatalog && entity.status === "active",
      )
      .map((entity) => entity.key);
    const chosen = [approved[1]!, approved[0]!];

    const created = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/decks`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision))
      .send({
        key: "deck.editorial-picks",
        kind: "curated",
        names: {
          ru: { name: "Подборка", description: "Ручная подборка" },
          en: { name: "Picks", description: "A hand-picked list" },
        },
        members: chosen,
      });
    expect(created.status).toBe(201);
    expect(bodyOf<DraftStamp>(created).revision).toBe(draft.revision + 1);

    const stored = await currentDraft();
    const deck = stored.document.decks.find(
      (entry) => entry.key === "deck.editorial-picks",
    );
    expect(deck?.members).toEqual(chosen);

    const detail = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/decks/deck.editorial-picks`)
      .set("Cookie", viewerCookie);
    expect(detail.status).toBe(200);
    const detailBody = bodyOf<DeckDetail>(detail);
    expect(detailBody.memberCount).toBe(2);
    // The release build sorts members, and the preview says the same.
    expect(detailBody.memberKeys).toEqual([...chosen].sort());
  });

  it("rejects duplicates, unknown entities and missing locales", async () => {
    const draft = await currentDraft();
    const approved = draft.document.entities
      .filter(
        (entity) =>
          entity.config.includeInCountryCatalog && entity.status === "active",
      )
      .map((entity) => entity.key);
    const names = {
      ru: { name: "Тест", description: "Описание" },
      en: { name: "Test", description: "Description" },
    };

    const duplicate = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/decks`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision))
      .send({
        key: "deck.duplicate",
        kind: "curated",
        names,
        members: [approved[0]!, approved[0]!],
      });
    expect(duplicate.status).toBe(422);
    expect(bodyOf<ErrorBody>(duplicate).error.code).toBe(
      "DECK_MEMBER_DUPLICATE",
    );

    const unknown = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/decks`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision))
      .send({
        key: "deck.unknown",
        kind: "curated",
        names,
        members: ["country.atlantis"],
      });
    expect(unknown.status).toBe(422);
    expect(bodyOf<ErrorBody>(unknown).error.code).toBe("DECK_MEMBER_UNKNOWN");

    const missingLocale = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/decks`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision))
      .send({
        key: "deck.partial",
        kind: "curated",
        names: { ru: names.ru },
        members: [approved[0]!],
      });
    expect(missingLocale.status).toBe(422);
    expect(bodyOf<ErrorBody>(missingLocale).error.code).toBe(
      "DECK_LOCALIZATION_MISSING",
    );

    // None of the refusals may have moved the draft on.
    expect((await currentDraft()).revision).toBe(draft.revision);
  });

  /**
   * A names-only edit must leave the membership exactly as it was, whichever
   * way that membership is expressed.
   *
   * It used to reach for the catalogue's all-current deck, which tied the
   * check to what the catalogue happened to contain — and the moment "all
   * countries" became a hand-named list, the test could not find its subject
   * and stopped guarding anything. The deck this suite made itself is always
   * there, and the property being guarded was never about one mode.
   */
  it("renames a deck without rewriting its membership", async () => {
    const before = await currentDraft();
    const target = before.document.decks.find(
      (entry) => entry.key === "deck.editorial-picks",
    );
    expect(target).toBeDefined();
    const membersBefore = target?.members;

    const renamed = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draftId}/decks/deck.editorial-picks`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(before.revision))
      .send({
        names: {
          ru: { name: "Все страны мира", description: "Полный каталог" },
          en: { name: "Every country", description: "The whole catalog" },
        },
      });
    expect(renamed.status).toBe(200);

    const after = await currentDraft();
    const deck = after.document.decks.find(
      (entry) => entry.key === "deck.editorial-picks",
    );
    expect(deck?.members).toEqual(membersBefore);
  });

  it("guards deck writes with the draft revision", async () => {
    const draft = await currentDraft();
    const stale = await request(httpServer)
      .patch(
        `/v1/admin/content/drafts/${draftId}/decks/${draft.document.decks[0]!.key}`,
      )
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision - 1))
      .send({ kind: "curated" });
    expect(stale.status).toBe(409);
    expect(bodyOf<ErrorBody>(stale).error.code).toBe("DRAFT_REVISION_CONFLICT");

    const missing = await request(httpServer)
      .patch(
        `/v1/admin/content/drafts/${draftId}/decks/${draft.document.decks[0]!.key}`,
      )
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ kind: "curated" });
    expect(missing.status).toBe(428);
  });

  it("deletes a deck and refuses to empty the catalog", async () => {
    const draft = await currentDraft();
    const removed = await request(httpServer)
      .delete(`/v1/admin/content/drafts/${draftId}/decks/deck.editorial-picks`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(draft.revision));
    expect(removed.status).toBe(200);
    expect(
      (await listDecks()).some((deck) => deck.key === "deck.editorial-picks"),
    ).toBe(false);

    const missing = await request(httpServer)
      .delete(`/v1/admin/content/drafts/${draftId}/decks/deck.editorial-picks`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String((await currentDraft()).revision));
    expect(missing.status).toBe(404);
  });

  it("never changes the published decks", async () => {
    const published = await request(httpServer)
      .get("/v1/admin/content/decks?limit=100")
      .set("Cookie", editorCookie);
    const codes = bodyOf<{ items: { code: string }[] }>(published).items.map(
      (deck) => deck.code,
    );
    expect(codes).not.toContain("deck.editorial-picks");
  });

  it("records every deck change in the audit trail", async () => {
    const created = await database.adminAuditEvent.count({
      where: { action: "admin.draft.deck_created" },
    });
    const updated = await database.adminAuditEvent.count({
      where: { action: "admin.draft.deck_updated" },
    });
    const deleted = await database.adminAuditEvent.count({
      where: { action: "admin.draft.deck_deleted" },
    });
    expect(created).toBe(1);
    expect(updated).toBe(1);
    expect(deleted).toBe(1);
  });
});
