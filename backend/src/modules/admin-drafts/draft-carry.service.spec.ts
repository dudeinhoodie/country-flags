import { resolve } from "node:path";

import { ContentDraftStatus } from "@prisma/client";
import type { AdminUser, ContentDraft, Prisma } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { MetricsService } from "../../common/telemetry/metrics.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import type { AdminDraftsService } from "./admin-drafts.service";
import type { CatalogSourceService } from "./catalog-source.service";
import { DraftCarryService } from "./draft-carry.service";
import { EditorialDocumentService } from "./editorial-document.service";
import type { ValidationFinding } from "./draft-validation.service";

const DRAFT_ID = "70000000-0000-4000-8000-00000000000a";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OLD_COMMIT = "a".repeat(40);
const NEW_COMMIT = "b".repeat(40);
const ACTOR = { id: "admin" } as unknown as AdminUser;

function schemaPath(version: number): string {
  return resolve(
    __dirname,
    `../../../../contracts/schemas/content/editorial-catalog.v${String(
      version,
    )}.schema.json`,
  );
}

/** The real schema check, so a merge that produces nonsense fails here. */
const documents = new EditorialDocumentService({
  getOrThrow: (key: string) =>
    key === "ADMIN_EDITORIAL_SCHEMA_V3_PATH" ? schemaPath(3) : schemaPath(2),
} as unknown as ConstructorParameters<typeof EditorialDocumentService>[0]);

function catalog(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    sourceAliases: {},
    additionalRelations: [],
    entities: [
      {
        key: "country.germany",
        type: "country",
        status: "active",
        config: { includeInCountryCatalog: true },
        recognitionStatus: "un_member",
      },
      {
        key: "country.france",
        type: "country",
        status: "active",
        config: { includeInCountryCatalog: true },
        recognitionStatus: "un_member",
      },
    ],
    decks: [
      {
        key: "deck.all",
        kind: "curated",
        names: {
          ru: { name: "Все", description: "Все страны" },
          en: { name: "All", description: "All countries" },
        },
        members: ["country.germany", "country.france"],
      },
    ],
  };
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The draft: Germany edited, imported from the catalog as it then was. */
function draft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  const edited = copy(catalog());
  (edited.entities as Record<string, unknown>[])[0]!.recognitionStatus =
    "observer";
  return {
    id: DRAFT_ID,
    status: ContentDraftStatus.READY,
    revision: 4,
    document: edited,
    baseDocument: catalog(),
    baseContentVersion: "test-only-fixture-v1",
    baseCatalogCommit: OLD_COMMIT,
    schemaVersion: 2,
    proposalUrl: null,
    validationReport: null,
    updatedAt: new Date("2026-09-08T10:00:00.000Z"),
    updatedByAdminUserId: "someone-else",
    ...overrides,
  } as unknown as ContentDraft;
}

/** The catalog as the running revision carries it: France moved, not Germany. */
function movedCatalog(): Record<string, unknown> {
  const moved = copy(catalog());
  (moved.entities as Record<string, unknown>[])[1]!.status = "historical";
  return moved;
}

interface Harness {
  service: DraftCarryService;
  applyDraftChange: jest.Mock;
  findMany: jest.Mock;
}

function harness(
  stored: ContentDraft,
  current: { document: Record<string, unknown>; commit: string },
): Harness {
  const findMany = jest.fn().mockResolvedValue([]);
  const applyDraftChange = jest
    .fn()
    .mockImplementation(
      (
        _actor: AdminUser,
        _draftId: string,
        _revision: number,
        change: () => Prisma.ContentDraftUpdateManyMutationInput,
      ) =>
        Promise.resolve({
          ...stored,
          ...change(),
          revision: stored.revision + 1,
          status: ContentDraftStatus.DRAFT,
        }),
    );
  const service = new DraftCarryService(
    { draftAsset: { findMany } } as unknown as PrismaService,
    {
      get: jest.fn().mockResolvedValue(stored),
      applyDraftChange,
    } as unknown as AdminDraftsService,
    {
      read: jest.fn().mockReturnValue(current),
    } as unknown as CatalogSourceService,
    documents,
    new MetricsService(),
  );
  return { service, applyDraftChange, findMany };
}

interface Refusal {
  status: number;
  code: string;
  details: Record<string, unknown>;
}

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ApiException)) {
      throw error;
    }
    const body = error.getResponse() as {
      error: { code: string; details: Record<string, unknown> };
    };
    return {
      status: error.getStatus(),
      code: body.error.code,
      details: body.error.details,
    };
  }
  throw new Error("The call was expected to be refused");
}

describe("DraftCarryService", () => {
  const expected = { draftRevision: 4, baseCatalogCommit: OLD_COMMIT };

  it("moves the base forward and keeps the draft's own edit", async () => {
    const { service, applyDraftChange } = harness(draft(), {
      document: movedCatalog(),
      commit: NEW_COMMIT,
    });

    const result = await service.carry(ACTOR, DRAFT_ID, expected, REQUEST_ID);

    expect(result.carried).toBe(true);
    expect(result.baseCatalogCommit).toBe(NEW_COMMIT);
    expect(result.previousBaseCatalogCommit).toBe(OLD_COMMIT);
    expect(result.incoming).toEqual([
      { objectType: "entity", objectKey: "country.france", change: "changed" },
    ]);

    const calls = applyDraftChange.mock.calls as [
      unknown,
      unknown,
      unknown,
      () => {
        document: Record<string, unknown>;
        baseCatalogCommit: string;
        baseDocument: Record<string, unknown>;
      },
    ][];
    const written = calls[0]![3]();
    const entities = written.document.entities as Record<string, unknown>[];
    expect(entities[0]?.recognitionStatus).toBe("observer");
    expect(entities[1]?.status).toBe("historical");
    expect(written.baseCatalogCommit).toBe(NEW_COMMIT);
    // The base moves with it, or the next carry would measure against a
    // document nobody is working from any more.
    expect(written.baseDocument).toEqual(movedCatalog());
  });

  it("writes nothing when the catalog has not moved", async () => {
    const { service, applyDraftChange } = harness(draft(), {
      document: catalog(),
      commit: OLD_COMMIT,
    });

    const result = await service.carry(ACTOR, DRAFT_ID, expected, REQUEST_ID);

    expect(result.carried).toBe(false);
    expect(result.revision).toBe(4);
    expect(applyDraftChange).not.toHaveBeenCalled();
  });

  it("refuses a collision with the field named and a route to it", async () => {
    const collided = copy(catalog());
    (collided.entities as Record<string, unknown>[])[0]!.recognitionStatus =
      "limited_recognition";
    const { service, applyDraftChange } = harness(draft(), {
      document: collided,
      commit: NEW_COMMIT,
    });

    const refusal = await refusalOf(
      service.carry(ACTOR, DRAFT_ID, expected, REQUEST_ID),
    );

    expect(refusal.code).toBe("CATALOG_CARRY_COLLISION");
    expect(refusal.status).toBe(409);
    const details = refusal.details as {
      draftBase: string;
      current: string;
      collisions: ValidationFinding[];
    };
    expect(details).toMatchObject({
      draftBase: OLD_COMMIT,
      current: NEW_COMMIT,
    });
    expect(details.collisions[0]).toMatchObject({
      code: "FIELD_CHANGED_ON_BOTH_SIDES",
      subject: "country.germany",
      target: { tab: "overview", field: "/recognitionStatus" },
      route: `/drafts/${DRAFT_ID}/entities/country.germany`,
    });
    // Nothing is written: the draft, its edits and its uploads stay as they
    // were, which is the whole point of refusing rather than merging.
    expect(applyDraftChange).not.toHaveBeenCalled();
  });

  it("refuses a draft that never recorded the catalog it started from", async () => {
    const { service } = harness(draft({ baseDocument: null }), {
      document: movedCatalog(),
      commit: NEW_COMMIT,
    });

    const refusal = await refusalOf(
      service.carry(ACTOR, DRAFT_ID, expected, REQUEST_ID),
    );

    expect(refusal.code).toBe("DRAFT_BASE_NOT_RECORDED");
  });

  it("refuses a draft that already has a pull request", async () => {
    const { service } = harness(
      draft({ proposalUrl: "https://github.invalid/pull/1" }),
      { document: movedCatalog(), commit: NEW_COMMIT },
    );

    const refusal = await refusalOf(
      service.carry(ACTOR, DRAFT_ID, expected, REQUEST_ID),
    );

    expect(refusal.code).toBe("DRAFT_ALREADY_PROPOSED");
  });

  it("refuses a stale caller with both revisions and who moved it", async () => {
    const { service } = harness(draft(), {
      document: movedCatalog(),
      commit: NEW_COMMIT,
    });

    const refusal = await refusalOf(
      service.carry(
        ACTOR,
        DRAFT_ID,
        { ...expected, draftRevision: 3 },
        REQUEST_ID,
      ),
    );

    expect(refusal.code).toBe("DRAFT_REVISION_CONFLICT");
    expect(refusal.details).toMatchObject({
      expectedRevision: 3,
      currentRevision: 4,
      updatedByAdminUserId: "someone-else",
    });
  });

  it("refuses a caller that expects a different base than the draft carries", async () => {
    const { service } = harness(draft(), {
      document: movedCatalog(),
      commit: NEW_COMMIT,
    });

    const refusal = await refusalOf(
      service.carry(
        ACTOR,
        DRAFT_ID,
        { ...expected, baseCatalogCommit: NEW_COMMIT },
        REQUEST_ID,
      ),
    );

    expect(refusal.code).toBe("BASE_CATALOG_MISMATCH");
  });
});
