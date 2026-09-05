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

interface DraftStamp {
  draftId: string;
  revision: number;
  status: string;
}

interface UploadBody {
  asset: { id: string; assetType: string };
  processing: { state: string };
  draft: DraftStamp;
}

interface LocaleCompleteness {
  required: string[];
  present: string[];
  missing: string[];
  complete: boolean;
}

interface AssetSlot {
  assetType: string;
  state: string;
  delivery: string | null;
  provenanceComplete: boolean;
  processing: string | null;
  localizations: LocaleCompleteness;
  usedByDeckKeys: string[];
  unlocksTemplates: string[];
}

interface EntityListItem {
  key: string;
  type: string;
  parentKey: string | null;
  hasFlag: boolean;
  hasCoatOfArms: boolean;
  locales: LocaleCompleteness;
  usedInDeckCount: number;
  delivery: string;
  blockingCount: number;
  warningCount: number;
}

interface EntityDetail {
  entity: { key: string };
  draftRevision: number;
  delivery: string;
  locales: LocaleCompleteness;
  assets: AssetSlot[];
  usages: {
    deckKey: string;
    accessModel: string;
    templateCode: string;
    delivery: string;
    isPreview: boolean;
  }[];
  validation: { blocking: number; warnings: number; findings: Finding[] };
}

interface Finding {
  level: string;
  code: string;
  subject: string;
  message: string;
  target: {
    objectType: string;
    objectKey: string;
    tab: string | null;
    field: string | null;
  };
  route?: string;
}

interface Candidate {
  cardId: string;
  entityKey: string;
  templateCode: string;
  assetType: string | null;
  hasAsset: boolean;
  available: boolean;
  inDeck: boolean;
  delivery: string | null;
  disabledReason: { code: string; message: string } | null;
}

interface DeckDetail {
  key: string;
  resolvedMemberCards: {
    cardId: string;
    entityKey: string;
    delivery: string;
    hasAsset: boolean;
    missingAssetType: string | null;
    isPreview: boolean;
  }[];
  previewCards: { cardId: string }[];
  summary: {
    cardCount: number;
    templateCodes: string[];
    missingAssetCount: number;
    previewCardCount: number;
    delivery: { public: number; publicPreview: number; paidOnly: number };
    blocking: number;
    warnings: number;
  };
  access: {
    model: string;
    requiredEntitlementKey: string | null;
    published: { model: string } | null;
    entitlementKnown: boolean;
    offerCodes: string[];
    storeProducts: unknown[];
    sellable: boolean;
  };
  validation: { blocking: number; findings: Finding[] };
  draftRevision: number;
}

interface ConflictBody {
  error: {
    code: string;
    details: {
      draftId: string;
      expectedRevision: number;
      currentRevision: number;
      updatedAt: string;
      updatedByAdminUserId: string;
    };
  };
}

const COAT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><circle cx="200" cy="250" r="180" fill="#e0b400"/></svg>';

const GERMANY = "country.germany";
const PAID_DECK = "deck.european-coats";
const COAT_TEMPLATE = "COAT_OF_ARMS_TO_COUNTRY";
const COAT_CARD = `${GERMANY}#${COAT_TEMPLATE}@1`;

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

/**
 * The aggregated admin read models (#356).
 *
 * The screens these serve draw a hundred rows at a time, so the contract has
 * to answer everything a row shows in one request — and the delivery badge on
 * it has to be the same verdict the public projection reaches, not a second
 * implementation of the rule (ADR-019 §7.4).
 */
describe("Admin aggregated read models (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_readmodels_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let editorCookie: string;
  let draftId: string;
  let revision: number;

  async function entityDetail(key: string): Promise<EntityDetail> {
    const response = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/entities/${key}`)
      .set("Cookie", editorCookie);
    expect(response.status).toBe(200);
    return bodyOf<EntityDetail>(response);
  }

  async function deckDetail(key: string): Promise<DeckDetail> {
    const response = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/decks/${key}`)
      .set("Cookie", editorCookie);
    expect(response.status).toBe(200);
    return bodyOf<DeckDetail>(response);
  }

  async function candidates(query: string): Promise<Candidate[]> {
    const response = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/card-candidates?${query}`)
      .set("Cookie", editorCookie);
    expect(response.status).toBe(200);
    return bodyOf<{ items: Candidate[] }>(response).items;
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for admin read model tests");
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
        `Admin read model test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    const idToken = await signer.signGoogle({
      subject: "read-models-editor",
      email: "editor9@country-flags.test",
    });
    const login = await request(httpServer)
      .post("/v1/admin/auth/google")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ idToken });
    if (login.status !== 200) {
      throw new Error("Fixture login failed");
    }
    editorCookie = sessionCookieOf(login);
    await database.adminUser.update({
      where: { email: "editor9@country-flags.test" },
      data: { role: AdminRole.EDITOR },
    });

    await importTestContent(database);
    const created = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    if (created.status !== 201) {
      throw new Error("Fixture draft creation failed");
    }
    const draft = bodyOf<{ id: string; revision: number }>(created);
    draftId = draft.id;
    revision = draft.revision;

    // A coat of arms only a paid deck will teach: the case the badge exists
    // for. It is uploaded first so the deck below can be built out of it.
    const upload = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/assets`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", `"${String(revision)}"`)
      .field("entityContentKey", GERMANY)
      .field("assetType", "COAT_OF_ARMS")
      .field("sourceUrl", "https://commons.example.test/coat.svg")
      .field("licenseName", "CC0-1.0")
      .field("replacementReason", "The upstream drawing is cropped.")
      .attach("file", Buffer.from(COAT_SVG, "utf8"), {
        filename: "coat.svg",
        contentType: "image/svg+xml",
      });
    if (upload.status !== 201) {
      throw new Error(
        `Fixture coat upload failed: ${JSON.stringify(upload.body)}`,
      );
    }
    revision = bodyOf<UploadBody>(upload).draft.revision;

    const deck = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/decks`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", `"${String(revision)}"`)
      .send({
        key: PAID_DECK,
        kind: "curated",
        names: {
          ru: { name: "Гербы Европы", description: "Гербы стран Европы" },
          en: { name: "European coats", description: "Coats of arms" },
        },
        members: [
          {
            entityKey: GERMANY,
            templateCode: COAT_TEMPLATE,
            templateSchemaVersion: 1,
          },
        ],
        defaultTemplateCode: COAT_TEMPLATE,
        defaultTemplateSchemaVersion: 1,
        access: {
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.european_coats",
        },
      });
    if (deck.status !== 201) {
      throw new Error(
        `Fixture deck creation failed: ${JSON.stringify(deck.body)}`,
      );
    }
    revision = bodyOf<DraftStamp>(deck).revision;
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

  it("answers the upload with its processing state and the draft it moved", async () => {
    const before = revision;
    const upload = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/assets`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .field("entityContentKey", "country.france")
      .field("assetType", "COAT_OF_ARMS")
      .field("sourceUrl", "https://commons.example.test/fr-coat.svg")
      .field("licenseName", "CC0-1.0")
      .field("replacementReason", "The upstream drawing is cropped.")
      .attach(
        "file",
        Buffer.from(COAT_SVG.replace("#e0b400", "#3050c0"), "utf8"),
        { filename: "coat.svg", contentType: "image/svg+xml" },
      );

    expect(upload.status).toBe(201);
    const body = bodyOf<UploadBody>(upload);
    expect(body.processing.state).toBe("READY");
    expect(body.draft.draftId).toBe(draftId);
    expect(body.draft.revision).toBe(before + 1);
    revision = body.draft.revision;
  });

  it("hands the entity list every column it draws, in one request", async () => {
    const response = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/entities?limit=1000`)
      .set("Cookie", editorCookie);
    expect(response.status).toBe(200);
    const body = bodyOf<{
      items: EntityListItem[];
      total: number;
      draftRevision: number;
    }>(response);

    expect(body.draftRevision).toBe(revision);
    const germany = body.items.find((item) => item.key === GERMANY);
    expect(germany).toBeDefined();
    expect(germany?.hasFlag).toBe(true);
    // Uploaded into this draft, so the row already knows about it.
    expect(germany?.hasCoatOfArms).toBe(true);
    expect(germany?.usedInDeckCount).toBeGreaterThan(0);
    expect(germany?.delivery).toBe("PUBLIC");
    expect(germany?.locales.required).toEqual(["ru", "en"]);
    expect(typeof germany?.blockingCount).toBe("number");
  });

  it("filters the entity list on the server", async () => {
    const missing = await request(httpServer)
      .get(
        `/v1/admin/content/drafts/${draftId}/entities?missingCoatOfArms=true&limit=1000`,
      )
      .set("Cookie", editorCookie);
    expect(missing.status).toBe(200);
    const rows = bodyOf<{ items: EntityListItem[]; total: number }>(missing);
    expect(rows.items.every((item) => !item.hasCoatOfArms)).toBe(true);
    expect(rows.items.some((item) => item.key === GERMANY)).toBe(false);

    const searched = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/entities?search=germany`)
      .set("Cookie", editorCookie);
    expect(bodyOf<{ items: EntityListItem[] }>(searched).items).toHaveLength(1);

    const refused = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}/entities?type=galaxy`)
      .set("Cookie", editorCookie);
    expect(refused.status).toBe(422);
  });

  it("calls a coat only an entitlement deck teaches paid-only, and the flag beside it public", async () => {
    const detail = await entityDetail(GERMANY);

    const coat = detail.assets.find(
      (slot) => slot.assetType === "COAT_OF_ARMS",
    );
    expect(coat?.state).toBe("draft");
    expect(coat?.delivery).toBe("PAID_ONLY");
    expect(coat?.provenanceComplete).toBe(true);
    expect(coat?.processing).toBe("READY");
    expect(coat?.usedByDeckKeys).toEqual([PAID_DECK]);

    // The same country's flag is taught by the free catalogue, so it stays
    // public: what is paid is the route to the drawing, not the country.
    const flag = detail.assets.find((slot) => slot.assetType === "FLAG");
    expect(flag?.state).toBe("published");
    expect(flag?.delivery).toBe("PUBLIC");
    expect(detail.delivery).toBe("PUBLIC");

    // An empty slot says what filling it would unlock.
    const map = detail.assets.find((slot) => slot.assetType === "MAP");
    expect(map?.state).toBe("empty");
    expect(map?.delivery).toBeNull();
    expect(
      detail.assets.find((slot) => slot.assetType === "COAT_OF_ARMS")
        ?.unlocksTemplates,
    ).toContain(COAT_TEMPLATE);

    expect(
      detail.usages.map((usage) => `${usage.deckKey}:${usage.delivery}`),
    ).toContain(`${PAID_DECK}:PAID_ONLY`);
  });

  it("keeps the draft's coat out of the public projection entirely", async () => {
    const entity = await database.geoEntity.findUnique({
      where: { contentKey: GERMANY },
      select: { id: true },
    });
    expect(entity).not.toBeNull();

    const published = await request(httpServer).get(
      `/v1/entities/${entity?.id ?? ""}`,
    );
    expect(published.status).toBe(200);
    const body = bodyOf<{ assets: { assetType: string }[] }>(published);
    // A draft upload is not content. Nothing an editor stages reaches a
    // reader before the release that publishes it.
    expect(
      body.assets.some((asset) => asset.assetType === "COAT_OF_ARMS"),
    ).toBe(false);
  });

  it("turns the same coat into a public preview when the deck shows it", async () => {
    const patched = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draftId}/decks/${PAID_DECK}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", `"${String(revision)}"`)
      .send({ previewCardIds: [COAT_CARD] });
    expect(patched.status).toBe(200);
    revision = bodyOf<DraftStamp>(patched).revision;

    const detail = await entityDetail(GERMANY);
    expect(
      detail.assets.find((slot) => slot.assetType === "COAT_OF_ARMS")?.delivery,
    ).toBe("PUBLIC_PREVIEW");

    // And back again, so the rest of the suite sees the deck it was given.
    const reverted = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draftId}/decks/${PAID_DECK}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", `"${String(revision)}"`)
      .send({ previewCardIds: [] });
    expect(reverted.status).toBe(200);
    revision = bodyOf<DraftStamp>(reverted).revision;
  });

  it("resolves the deck, its delivery and its store state in one read", async () => {
    const detail = await deckDetail(PAID_DECK);

    expect(detail.summary.cardCount).toBe(1);
    expect(detail.summary.templateCodes).toEqual([COAT_TEMPLATE]);
    expect(detail.summary.delivery.paidOnly).toBe(1);
    expect(detail.summary.missingAssetCount).toBe(0);
    expect(detail.resolvedMemberCards[0]?.cardId).toBe(COAT_CARD);
    expect(detail.resolvedMemberCards[0]?.delivery).toBe("PAID_ONLY");
    expect(detail.resolvedMemberCards[0]?.hasAsset).toBe(true);
    expect(detail.previewCards).toEqual([]);
    expect(detail.draftRevision).toBe(revision);

    expect(detail.access.model).toBe("ENTITLEMENT");
    expect(detail.access.requiredEntitlementKey).toBe("deck.european_coats");
    // Nothing sells it yet, and the console has to say so rather than let a
    // publisher find out at the gate.
    expect(detail.access.entitlementKnown).toBe(false);
    expect(detail.access.storeProducts).toEqual([]);
    expect(detail.access.sellable).toBe(false);
    expect(detail.access.published).toBeNull();
  });

  it("searches the card library on the server and says why a card is unavailable", async () => {
    const rows = await candidates(
      `deckKey=${PAID_DECK}&templateCode=${COAT_TEMPLATE}&limit=200`,
    );

    const germany = rows.find((row) => row.entityKey === GERMANY);
    expect(germany?.inDeck).toBe(true);
    expect(germany?.available).toBe(false);
    expect(germany?.disabledReason?.code).toBe("ALREADY_IN_DECK");
    expect(germany?.delivery).toBe("PAID_ONLY");

    const withoutCoat = rows.find(
      (row) => !row.hasAsset && row.entityKey !== GERMANY,
    );
    expect(withoutCoat?.available).toBe(false);
    expect(withoutCoat?.disabledReason?.code).toBe("ASSET_MISSING");
    expect(withoutCoat?.disabledReason?.message).toContain("coat_of_arms");

    // A region is structure: no template teaches it, so it is not offered.
    expect(rows.some((row) => row.entityKey.startsWith("region."))).toBe(false);

    const ready = await candidates("readiness=ready&limit=5");
    expect(ready.every((row) => row.available)).toBe(true);
    const blocked = await candidates("readiness=blocked&limit=5");
    expect(blocked.every((row) => !row.available)).toBe(true);
    expect(blocked.every((row) => row.disabledReason !== null)).toBe(true);
  });

  it("gives every validation finding a route, a tab and a field", async () => {
    const validated = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/validate`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(validated.status).toBe(200);
    const report = bodyOf<{ report: { findings: Finding[] } }>(
      validated,
    ).report;

    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(finding.target.objectKey).toBe(finding.subject);
      expect(finding.route?.startsWith(`/drafts/${draftId}`)).toBe(true);
    }
    const deckFinding = report.findings.find(
      (finding) => finding.target.objectType === "deck",
    );
    if (deckFinding !== undefined) {
      expect(deckFinding.route).toBe(
        `/drafts/${draftId}/decks/${deckFinding.subject}`,
      );
    }
  });

  it("refuses a stale write with both revisions and who moved the draft", async () => {
    const stale = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draftId}/entities/${GERMANY}`)
      .set("Cookie", editorCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", '"1"')
      .send({ status: "hidden" });

    expect(stale.status).toBe(409);
    const body = bodyOf<ConflictBody>(stale);
    expect(body.error.code).toBe("DRAFT_REVISION_CONFLICT");
    expect(body.error.details.draftId).toBe(draftId);
    expect(body.error.details.expectedRevision).toBe(1);
    expect(body.error.details.currentRevision).toBeGreaterThan(1);
    expect(body.error.details.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.error.details.updatedByAdminUserId).toHaveLength(36);
  });
});
