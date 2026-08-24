import { HttpStatus } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import {
  exactRequestKeys,
  requestRecord,
  requiredString,
  validationError,
} from "../../common/http/request-validation";

export interface DraftUpdateRequest {
  document: Record<string, unknown>;
}

export function parseDraftUpdateRequest(body: unknown): DraftUpdateRequest {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["document"], "body");
  const document = root.document;
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    validationError("document", "must be an object");
  }
  return { document: document as Record<string, unknown> };
}

/**
 * Optimistic concurrency carrier. Missing header → 428: the client must
 * say which revision it edited, or a stale tab could overwrite a colleague.
 */
export function parseIfMatchRevision(header: string | undefined): number {
  if (header === undefined) {
    throw new ApiException(
      HttpStatus.PRECONDITION_REQUIRED,
      "IF_MATCH_REQUIRED",
      "The If-Match header with the draft revision is required",
    );
  }
  const raw = header.trim().replace(/^"|"$/g, "");
  if (!/^[0-9]+$/.test(raw)) {
    validationError("If-Match", "must be a draft revision number");
  }
  return Number(raw);
}

const DECK_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const DECK_KINDS = ["curated", "taxonomy"] as const;

export interface DeckLocalizationInput {
  name: string;
  description: string;
}

export interface DeckInput {
  key: string;
  kind: (typeof DECK_KINDS)[number];
  names: Record<string, DeckLocalizationInput>;
  members: "all-current" | string[] | { taxonomy: string };
}

function parseDeckNames(
  value: unknown,
  field: string,
): Record<string, DeckLocalizationInput> {
  const record = requestRecord(value, field);
  const names: Record<string, DeckLocalizationInput> = {};
  for (const [locale, localized] of Object.entries(record)) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
      validationError(`${field}.${locale}`, "is not a valid locale");
    }
    const entry = requestRecord(localized, `${field}.${locale}`);
    exactRequestKeys(entry, ["name", "description"], `${field}.${locale}`);
    names[locale] = {
      name: requiredString(entry.name, `${field}.${locale}.name`, 1, 200),
      description: requiredString(
        entry.description,
        `${field}.${locale}.description`,
        1,
        2000,
      ),
    };
  }
  if (Object.keys(names).length === 0) {
    validationError(field, "must contain at least one locale");
  }
  return names;
}

function parseDeckMembers(value: unknown, field: string): DeckInput["members"] {
  if (value === "all-current") {
    return "all-current";
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      requiredString(entry, `${field}[${String(index)}]`, 1, 200),
    );
  }
  const record = requestRecord(value, field);
  exactRequestKeys(record, ["taxonomy"], field);
  return {
    taxonomy: requiredString(record.taxonomy, `${field}.taxonomy`, 1, 200),
  };
}

export function parseDeckCreateRequest(body: unknown): DeckInput {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["key", "kind", "names", "members"], "body");
  const kind = root.kind;
  if (typeof kind !== "string" || !DECK_KINDS.includes(kind as never)) {
    validationError("kind", `must be one of: ${DECK_KINDS.join(", ")}`);
  }
  return {
    key: requiredString(root.key, "key", 1, 200, DECK_KEY_PATTERN),
    kind: kind as DeckInput["kind"],
    names: parseDeckNames(root.names, "names"),
    members: parseDeckMembers(root.members, "members"),
  };
}

export function parseDeckUpdateRequest(
  body: unknown,
): Partial<Omit<DeckInput, "key">> {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["kind", "names", "members"], "body");
  const changes: Partial<Omit<DeckInput, "key">> = {};
  if (root.kind !== undefined) {
    const kind = root.kind;
    if (typeof kind !== "string" || !DECK_KINDS.includes(kind as never)) {
      validationError("kind", `must be one of: ${DECK_KINDS.join(", ")}`);
    }
    changes.kind = kind as DeckInput["kind"];
  }
  if (root.names !== undefined) {
    changes.names = parseDeckNames(root.names, "names");
  }
  if (root.members !== undefined) {
    changes.members = parseDeckMembers(root.members, "members");
  }
  if (Object.keys(changes).length === 0) {
    validationError("body", "must contain kind, names or members");
  }
  return changes;
}

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export interface ProposalRequestInput {
  draftRevision: number;
  baseContentVersion: string;
  baseCatalogCommit: string;
}

/**
 * The client states what it believed when it decided to propose. Any
 * disagreement is a 409 rather than a pull request on top of somebody
 * else's change.
 */
export function parseProposalRequest(body: unknown): ProposalRequestInput {
  const root = requestRecord(body, "body");
  exactRequestKeys(
    root,
    ["draftRevision", "baseContentVersion", "baseCatalogCommit"],
    "body",
  );
  const revision = root.draftRevision;
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    validationError("draftRevision", "must be a positive integer");
  }
  return {
    draftRevision: revision,
    baseContentVersion: requiredString(
      root.baseContentVersion,
      "baseContentVersion",
      1,
      64,
    ),
    baseCatalogCommit: requiredString(
      root.baseCatalogCommit,
      "baseCatalogCommit",
      1,
      200,
    ),
  };
}

export interface PublishRunInput {
  contentVersion: string;
  minimumClientVersion: string;
}

export function parsePublishRunRequest(body: unknown): PublishRunInput {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["contentVersion", "minimumClientVersion"], "body");
  return {
    contentVersion: requiredString(
      root.contentVersion,
      "contentVersion",
      1,
      64,
      VERSION_PATTERN,
    ),
    // A client below this gets an update screen instead of a catalog, so a
    // typo here is a product decision, not a formatting slip.
    minimumClientVersion: requiredString(
      root.minimumClientVersion,
      "minimumClientVersion",
      5,
      32,
      SEMVER_PATTERN,
    ),
  };
}

export interface DraftAssetUploadInput {
  entityContentKey: string;
  assetType: "FLAG" | "COAT_OF_ARMS";
  variant: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl?: string;
  attribution?: string;
  replacementReason: string;
}

const UPLOADABLE_ASSET_TYPES = ["FLAG", "COAT_OF_ARMS"] as const;

/**
 * Multipart fields arrive as strings. Source, license and the reason a human
 * replaced the drawing are required rather than optional: a published asset
 * nobody can account for is worse than no asset.
 */
export function parseDraftAssetUpload(body: unknown): DraftAssetUploadInput {
  const root = requestRecord(body, "body");
  exactRequestKeys(
    root,
    [
      "entityContentKey",
      "assetType",
      "variant",
      "sourceUrl",
      "licenseName",
      "licenseUrl",
      "attribution",
      "replacementReason",
    ],
    "body",
  );
  const assetType = root.assetType;
  if (
    typeof assetType !== "string" ||
    !UPLOADABLE_ASSET_TYPES.includes(assetType as never)
  ) {
    validationError(
      "assetType",
      `must be one of: ${UPLOADABLE_ASSET_TYPES.join(", ")}`,
    );
  }
  return {
    entityContentKey: requiredString(
      root.entityContentKey,
      "entityContentKey",
      1,
      200,
    ),
    assetType: assetType as DraftAssetUploadInput["assetType"],
    variant:
      root.variant === undefined
        ? "default"
        : requiredString(root.variant, "variant", 1, 50),
    sourceUrl: requiredString(root.sourceUrl, "sourceUrl", 1, 2000),
    licenseName: requiredString(root.licenseName, "licenseName", 1, 200),
    ...(root.licenseUrl === undefined
      ? {}
      : { licenseUrl: requiredString(root.licenseUrl, "licenseUrl", 1, 2000) }),
    ...(root.attribution === undefined
      ? {}
      : {
          attribution: requiredString(root.attribution, "attribution", 1, 500),
        }),
    replacementReason: requiredString(
      root.replacementReason,
      "replacementReason",
      1,
      2000,
    ),
  };
}
