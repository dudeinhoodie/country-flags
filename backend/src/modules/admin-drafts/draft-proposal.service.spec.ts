import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AssetType, ContentDraftStatus } from "@prisma/client";
import type { AdminUser, ContentDraft } from "@prisma/client";
import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv";

import type { AdminAuditService } from "../admin-auth/admin-audit.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import type { AdminDraftsService } from "./admin-drafts.service";
import type { CatalogSourceService } from "./catalog-source.service";
import type { DraftObjectStore } from "./draft-object-storage";
import type { DraftDiff } from "./draft-diff.service";
import type { CommittedFile, GitHubClient } from "./github-client";
import { DraftProposalService } from "./draft-proposal.service";

const DRAFT_ID = "70000000-0000-4000-8000-00000000000a";
const COMMIT = "a".repeat(40);
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

/**
 * The document a catalog of countries and flags has always been: schema v2,
 * which knows one asset type and no variants.
 */
function v2Document(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: [
      {
        key: "country.germany",
        type: "country",
        status: "active",
        config: { includeInCountryCatalog: true },
        recognitionStatus: "un_member",
      },
    ],
    sourceAliases: {},
    additionalRelations: [],
    decks: [
      {
        key: "deck.all",
        kind: "curated",
        names: {
          ru: { name: "Все", description: "Все страны" },
          en: { name: "All", description: "All countries" },
        },
        members: "all-current",
      },
    ],
  };
}

function draft(): ContentDraft {
  return {
    id: DRAFT_ID,
    status: ContentDraftStatus.READY,
    revision: 4,
    document: v2Document(),
    baseContentVersion: "test-only-fixture-v1",
    baseCatalogCommit: COMMIT,
    proposalUrl: null,
    validationReport: {
      validatedAt: "",
      blocking: 0,
      warnings: 0,
      findings: [],
    },
  } as unknown as ContentDraft;
}

function upload(assetType: AssetType, variant = "current"): unknown {
  return {
    id: "80000000-0000-4000-8000-00000000000a",
    draftId: DRAFT_ID,
    entityContentKey: "country.germany",
    assetType,
    variant,
    objectKey: "drafts/germany.svg",
    mimeType: "image/svg+xml",
    aspectRatio: 1.5,
    licenseName: "Public domain",
    licenseUrl: null,
    sourceUrl: "https://commons.example.test/germany.svg",
    attribution: null,
    replacementReason: "Verified official artwork",
  };
}

/** The published schema, read from contracts rather than mirrored. */
function schemaValidator(version: number): ValidateFunction {
  const path = resolve(
    __dirname,
    `../../../../contracts/schemas/content/editorial-catalog.v${String(
      version,
    )}.schema.json`,
  );
  const schema = JSON.parse(readFileSync(path, "utf8")) as object;
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

describe("DraftProposalService", () => {
  const commitFiles = jest.fn<
    Promise<void>,
    [string, string, CommittedFile[]]
  >();
  const findMany = jest.fn<Promise<unknown[]>, unknown[]>();
  const database = {
    draftAsset: { findMany },
    $transaction: jest.fn(async (run: (client: unknown) => Promise<unknown>) =>
      run({ contentDraft: { update: jest.fn().mockResolvedValue(draft()) } }),
    ),
  };
  const service = new DraftProposalService(
    database as unknown as PrismaService,
    {
      get: jest.fn().mockResolvedValue(draft()),
    } as unknown as AdminDraftsService,
    {
      read: jest
        .fn()
        .mockReturnValue({ document: v2Document(), commit: COMMIT }),
    } as unknown as CatalogSourceService,
    {
      commitFiles,
      openDraftPullRequest: jest
        .fn()
        .mockResolvedValue({ url: "https://example.invalid/pr/1", number: 1 }),
    } as unknown as GitHubClient,
    { record: jest.fn() } as unknown as AdminAuditService,
    {
      get: jest.fn().mockResolvedValue(Buffer.from("<svg/>", "utf8")),
    } as unknown as DraftObjectStore,
  );

  const emptyDiff = {
    baseContentVersion: "test-only-fixture-v1",
    isEmpty: false,
    decks: [],
    assets: [{ entityContentKey: "country.germany" }],
    entities: [],
  } as unknown as DraftDiff;

  async function committedCatalog(): Promise<Record<string, unknown>> {
    await service.propose(
      { id: "admin" } as unknown as AdminUser,
      DRAFT_ID,
      {
        draftRevision: 4,
        baseContentVersion: "test-only-fixture-v1",
        baseCatalogCommit: COMMIT,
      },
      emptyDiff,
      REQUEST_ID,
    );
    const files = commitFiles.mock.calls[0]?.[2] ?? [];
    const catalog = files.find(({ path }) => path.endsWith("catalog.json"));
    if (catalog === undefined) {
      throw new Error("The proposal committed no catalog");
    }
    return JSON.parse(catalog.content.toString("utf8")) as Record<
      string,
      unknown
    >;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The entry a proposal writes names what the drawing depicts and which
  // variant it is. v2 knows neither — its `assetType` is the single value
  // `flag` and it refuses an unknown field — so a document carrying one has
  // to be lifted, or the pull request lands with a catalog its own schema
  // rejects.
  it("lifts the catalog to v3 when it commits a coat of arms", async () => {
    findMany.mockResolvedValue([upload(AssetType.COAT_OF_ARMS)]);

    const catalog = await committedCatalog();

    expect(catalog.schemaVersion).toBe(3);
    const validate = schemaValidator(3);
    expect(validate(catalog)).toBe(true);
    const overrides = catalog.assetOverrides as {
      assetType: string;
      variant: string;
    }[];
    expect(overrides[0]).toMatchObject({
      assetType: "coat_of_arms",
      variant: "current",
    });
  });

  it("lifts it for a flag too, because the entry has a variant either way", async () => {
    findMany.mockResolvedValue([upload(AssetType.FLAG)]);

    const catalog = await committedCatalog();

    expect(catalog.schemaVersion).toBe(3);
    expect(schemaValidator(3)(catalog)).toBe(true);
    // The v2 schema is what it would have been committed against before, and
    // it refuses this document: that refusal is the bug this lift fixes.
    expect(schemaValidator(2)(catalog)).toBe(false);
  });

  it("leaves a document alone when there is nothing to override", async () => {
    findMany.mockResolvedValue([]);

    const catalog = await committedCatalog();

    expect(catalog.schemaVersion).toBe(2);
    expect(schemaValidator(2)(catalog)).toBe(true);
  });
});
