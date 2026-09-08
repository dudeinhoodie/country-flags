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
import { CatalogSourceService } from "../src/modules/admin-drafts/catalog-source.service";
import { GitHubClient } from "../src/modules/admin-drafts/github-client";
import type { CommittedFile } from "../src/modules/admin-drafts/github-client";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

const BASE_COMMIT = "carry-base-commit";
const MOVED_COMMIT = "carry-moved-commit";
const EDITED_ENTITY = "country.germany";
const OTHER_ENTITY = "country.france";

const COAT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><circle cx="200" cy="250" r="180" fill="#e0b400"/></svg>';

interface CatalogDocument extends Record<string, unknown> {
  entities: Record<string, unknown>[];
}

interface DraftBody {
  id: string;
  revision: number;
  status: string;
  baseContentVersion: string;
  baseCatalogCommit: string;
  catalogCommit: string;
  document: CatalogDocument;
}

interface CarryBody {
  draftId: string;
  revision: number;
  previousBaseCatalogCommit: string;
  baseCatalogCommit: string;
  carried: boolean;
  incoming: { objectType: string; objectKey: string; change: string }[];
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: {
      collisions?: {
        code: string;
        subject: string;
        route?: string;
        target: {
          objectType: string;
          tab: string | null;
          field: string | null;
        };
      }[];
    };
  };
}

interface ValidationResult {
  report: { blocking: number };
}

/**
 * The catalog the repository actually carries.
 *
 * A synthetic one would either be too small to exercise the editorial rules
 * or a second copy of them to maintain; this is the document a real draft is
 * imported from, and moving it is exactly what a deploy does.
 */
const REAL_CATALOG = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../tools/content-pipeline/editorial/catalog.json"),
    "utf8",
  ),
) as CatalogDocument;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The same catalog with one entity's English name overridden. */
function catalogWithOverride(
  entityKey: string,
  value: string,
): CatalogDocument {
  const document = copy(REAL_CATALOG);
  const entity = document.entities.find((entry) => entry.key === entityKey);
  if (entity === undefined) {
    throw new Error(`The catalog has no ${entityKey} to move`);
  }
  entity.overrides = { "names.en.short": value };
  return document;
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

function overrideOf(
  document: CatalogDocument,
  entityKey: string,
): Record<string, unknown> | undefined {
  const entity = document.entities.find((entry) => entry.key === entityKey);
  return entity?.overrides as Record<string, unknown> | undefined;
}

/**
 * Carrying a draft onto a catalog that moved under it (#395).
 *
 * The scenario is the one that lost the owner an afternoon: a coat of arms
 * uploaded into a draft, an edit beside it, and a deploy that brought in
 * somebody else's change to a different entity. Before this, the proposal
 * refused and the only way on was a new draft — which means uploading the
 * drawing again, because the bytes belong to the draft they were uploaded
 * into.
 */
describe("Admin draft carry (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_carry_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let publisherCookie: string;

  /** The catalog this "deployment" carries, moved by the tests themselves. */
  const catalog = {
    document: copy(REAL_CATALOG) as unknown,
    commit: BASE_COMMIT,
  };
  const committed: CommittedFile[][] = [];

  async function currentDraft(draftId: string): Promise<DraftBody> {
    const response = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draftId}`)
      .set("Cookie", publisherCookie);
    return bodyOf<DraftBody>(response);
  }

  /**
   * A draft with a coat of arms uploaded into it and one entity edited:
   * everything the owner would lose if the answer were "start again".
   */
  async function draftWithWork(): Promise<DraftBody> {
    catalog.document = copy(REAL_CATALOG);
    catalog.commit = BASE_COMMIT;

    const created = await request(httpServer)
      .post("/v1/admin/content/drafts")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(created.status).toBe(201);
    const draftId = bodyOf<DraftBody>(created).id;

    const uploaded = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/assets`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .field("entityContentKey", EDITED_ENTITY)
      .field("assetType", "COAT_OF_ARMS")
      .field("sourceUrl", "https://commons.example.test/coat.svg")
      .field("licenseName", "CC0-1.0")
      .field("replacementReason", "The upstream drawing was the wrong one.")
      .attach("file", Buffer.from(COAT_SVG, "utf8"), {
        filename: "coat.svg",
        contentType: "image/svg+xml",
      });
    expect(uploaded.status).toBe(201);

    const before = await currentDraft(draftId);
    const edited = await request(httpServer)
      .patch(`/v1/admin/content/drafts/${draftId}/entities/${EDITED_ENTITY}`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .set("If-Match", String(before.revision))
      .send({ overrides: { "names.en.short": "Germany (checked)" } });
    expect(edited.status).toBe(200);

    return currentDraft(draftId);
  }

  /** Runs validation and answers with the number of blocking findings. */
  async function validate(draftId: string): Promise<number> {
    const validated = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draftId}/validate`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(validated.status).toBe(200);
    return bodyOf<ValidationResult>(validated).report.blocking;
  }

  function propose(draft: DraftBody): request.Test {
    return request(httpServer)
      .post(`/v1/admin/content/drafts/${draft.id}/proposal`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        draftRevision: draft.revision,
        baseContentVersion: draft.baseContentVersion,
        baseCatalogCommit: draft.baseCatalogCommit,
      });
  }

  function carry(draft: DraftBody): request.Test {
    return request(httpServer)
      .post(`/v1/admin/content/drafts/${draft.id}/carry`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        draftRevision: draft.revision,
        baseCatalogCommit: draft.baseCatalogCommit,
      });
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for carry integration tests");
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
      throw new Error(`Carry test migration failed:\n${migration.stderr}`);
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.NODE_ENV = "test";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The catalog a deployment carries is a file in its image, and the
      // whole point of this suite is to move it between requests.
      .overrideProvider(CatalogSourceService)
      .useValue({
        read: () => ({ document: catalog.document, commit: catalog.commit }),
        commit: () => catalog.commit,
      })
      .overrideProvider(GitHubClient)
      .useValue({
        isConfigured: true,
        commitFiles: (
          _branch: string,
          _message: string,
          files: CommittedFile[],
        ) => {
          committed.push(files);
          return Promise.resolve("c".repeat(40));
        },
        openDraftPullRequest: () =>
          Promise.resolve({
            number: 7,
            url: "https://github.invalid/pull/7",
          }),
      })
      .compile();
    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix("v1");
    await expressApp.init();
    app = expressApp;
    httpServer = app.getHttpServer() as Server;
    database = app.get(PrismaService);
    const signer = app.get(TestProviderTokenSigner);

    const idToken = await signer.signGoogle({
      subject: "carry-publisher",
      email: "publisher9@country-flags.test",
    });
    const login = await request(httpServer)
      .post("/v1/admin/auth/google")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ idToken });
    if (login.status !== 200) {
      throw new Error("Fixture login failed for the carry publisher");
    }
    publisherCookie = sessionCookieOf(login);
    await database.adminUser.update({
      where: { email: "publisher9@country-flags.test" },
      data: { role: AdminRole.PUBLISHER },
    });

    await importTestContent(database);
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

  it("carries a draft over an unrelated change, asset and edit intact, and proposes it", async () => {
    const draft = await draftWithWork();
    expect(draft.catalogCommit).toBe(BASE_COMMIT);
    await validate(draft.id);

    // The deploy: somebody else's change to a different entity.
    catalog.document = catalogWithOverride(OTHER_ENTITY, "France (checked)");
    catalog.commit = MOVED_COMMIT;

    // The refusal that used to be the end of the road still stands.
    const refused = await propose(await currentDraft(draft.id));
    expect(refused.status).toBe(409);
    expect(bodyOf<ErrorBody>(refused).error.code).toBe("CATALOG_MOVED_ON");

    const carried = await carry(draft);
    expect(carried.status).toBe(200);
    const result = bodyOf<CarryBody>(carried);
    expect(result.carried).toBe(true);
    expect(result.previousBaseCatalogCommit).toBe(BASE_COMMIT);
    expect(result.baseCatalogCommit).toBe(MOVED_COMMIT);
    expect(result.incoming).toContainEqual({
      objectType: "entity",
      objectKey: OTHER_ENTITY,
      change: "changed",
    });

    const moved = await currentDraft(draft.id);
    expect(moved.baseCatalogCommit).toBe(MOVED_COMMIT);
    expect(moved.catalogCommit).toBe(MOVED_COMMIT);
    // The draft's own edit survived the move...
    expect(overrideOf(moved.document, EDITED_ENTITY)).toEqual({
      "names.en.short": "Germany (checked)",
    });
    // ...and so did the change it was carried onto.
    expect(overrideOf(moved.document, OTHER_ENTITY)).toEqual({
      "names.en.short": "France (checked)",
    });

    // The uploaded drawing never moved: it belongs to the draft, not to the
    // document, which is exactly why "start a new draft" was so expensive.
    const assets = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draft.id}/assets`)
      .set("Cookie", publisherCookie);
    expect(assets.status).toBe(200);
    expect(
      bodyOf<{ items: { entityContentKey: string; assetType: string }[] }>(
        assets,
      ).items,
    ).toContainEqual(
      expect.objectContaining({
        entityContentKey: EDITED_ENTITY,
        assetType: "COAT_OF_ARMS",
      }),
    );

    // A carried draft is a changed draft, so its verdict is re-earned.
    expect(await validate(draft.id)).toBe(0);

    const proposed = await propose(await currentDraft(draft.id));
    expect(proposed.status).toBe(201);

    const files = committed[committed.length - 1] ?? [];
    const catalogFile = files.find((file) =>
      file.path.endsWith("catalog.json"),
    );
    expect(catalogFile).toBeDefined();
    const proposedCatalog = JSON.parse(
      catalogFile!.content.toString("utf8"),
    ) as CatalogDocument;
    // The pull request carries both sides, which is the whole claim: no
    // silent revert, and no lost afternoon.
    expect(overrideOf(proposedCatalog, EDITED_ENTITY)).toEqual({
      "names.en.short": "Germany (checked)",
    });
    expect(overrideOf(proposedCatalog, OTHER_ENTITY)).toEqual({
      "names.en.short": "France (checked)",
    });
    expect(
      files.some((file) => file.path.includes(`${EDITED_ENTITY}/coat_of_arms`)),
    ).toBe(true);
  });

  it("refuses when the catalog moved the same field, and names it", async () => {
    const draft = await draftWithWork();

    // The same entity, the same field, a different answer.
    catalog.document = catalogWithOverride(EDITED_ENTITY, "Federal Republic");
    catalog.commit = MOVED_COMMIT;

    const refused = await carry(draft);
    expect(refused.status).toBe(409);
    const body = bodyOf<ErrorBody>(refused);
    expect(body.error.code).toBe("CATALOG_CARRY_COLLISION");
    const collisions = body.error.details.collisions ?? [];
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({
      code: "FIELD_CHANGED_ON_BOTH_SIDES",
      subject: EDITED_ENTITY,
      target: {
        objectType: "entity",
        tab: "names",
        field: "/names/en/short",
      },
      route: `/drafts/${draft.id}/entities/${EDITED_ENTITY}`,
    });

    // A refused carry writes nothing at all.
    const untouched = await currentDraft(draft.id);
    expect(untouched.revision).toBe(draft.revision);
    expect(untouched.baseCatalogCommit).toBe(BASE_COMMIT);
    expect(overrideOf(untouched.document, EDITED_ENTITY)).toEqual({
      "names.en.short": "Germany (checked)",
    });
    const assets = await request(httpServer)
      .get(`/v1/admin/content/drafts/${draft.id}/assets`)
      .set("Cookie", publisherCookie);
    expect(bodyOf<{ items: unknown[] }>(assets).items.length).toBeGreaterThan(
      0,
    );
  });

  it("writes nothing when the catalog has not moved", async () => {
    const draft = await draftWithWork();

    const answered = await carry(draft);
    expect(answered.status).toBe(200);
    const result = bodyOf<CarryBody>(answered);
    expect(result.carried).toBe(false);
    expect(result.revision).toBe(draft.revision);
    expect(result.incoming).toEqual([]);
  });

  it("refuses a carry below EDITOR and from an untrusted origin", async () => {
    const draft = await draftWithWork();
    catalog.commit = MOVED_COMMIT;

    const signer = app.get(TestProviderTokenSigner);
    const idToken = await signer.signGoogle({
      subject: "carry-viewer",
      email: "viewer9@country-flags.test",
    });
    const login = await request(httpServer)
      .post("/v1/admin/auth/google")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ idToken });
    const viewerCookie = sessionCookieOf(login);

    const asViewer = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draft.id}/carry`)
      .set("Cookie", viewerCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({
        draftRevision: draft.revision,
        baseCatalogCommit: draft.baseCatalogCommit,
      });
    expect(asViewer.status).toBe(403);

    const foreignOrigin = await request(httpServer)
      .post(`/v1/admin/content/drafts/${draft.id}/carry`)
      .set("Cookie", publisherCookie)
      .set("Origin", "https://evil.example")
      .send({
        draftRevision: draft.revision,
        baseCatalogCommit: draft.baseCatalogCommit,
      });
    expect(foreignOrigin.status).toBe(403);
  });

  it("refuses a draft that never recorded the catalog it started from", async () => {
    const draft = await draftWithWork();
    // The state every draft written before this feature is in: JSONB keeps
    // whatever was stored, and nothing can be invented for it after the fact.
    await database.$executeRawUnsafe(
      `UPDATE content_drafts SET base_document = NULL WHERE id = $1::uuid`,
      draft.id,
    );
    catalog.commit = MOVED_COMMIT;

    const refused = await carry(draft);
    expect(refused.status).toBe(409);
    expect(bodyOf<ErrorBody>(refused).error.code).toBe(
      "DRAFT_BASE_NOT_RECORDED",
    );
  });
});
