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

const ENTITY_TYPES = [
  "country",
  "territory",
  "area",
  "subdivision",
  "region",
  "subregion",
] as const;
const ENTITY_STATUSES = ["active", "historical", "retired", "hidden"] as const;
const ENTITY_IDENTIFIER_KEYS = [
  "isoAlpha2",
  "isoAlpha3",
  "m49",
  "isoSubdivision",
  "localCode",
  "fipsCode",
  "wikidataId",
  "editorialKey",
  "customCode",
] as const;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Same shape the editorial schema allows for an override path. */
const OVERRIDE_PATH_PATTERN = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9_-]+)*$/;

export interface EntityUpdateInput {
  type?: (typeof ENTITY_TYPES)[number];
  status?: (typeof ENTITY_STATUSES)[number];
  includeInCountryCatalog?: boolean;
  recognitionStatus?: string;
  /** `null` clears the date; the document simply drops the field. */
  recognitionAsOf?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  /** `null` clears the administrative parent. */
  parentKey?: string | null;
  facts?: EntityFactsInput;
  identifiers?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

function parseIsoDate(value: unknown, field: string): string {
  const raw = requiredString(value, field, 10, 10);
  if (!ISO_DATE_PATTERN.test(raw)) {
    validationError(field, "must be an ISO date (YYYY-MM-DD)");
  }
  return raw;
}

function parseEntityIdentifiers(
  value: unknown,
  field: string,
): Record<string, string> {
  const record = requestRecord(value, field);
  exactRequestKeys(record, [...ENTITY_IDENTIFIER_KEYS], field);
  const identifiers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    identifiers[key] = requiredString(raw, `${field}.${key}`, 1, 100);
  }
  return identifiers;
}

/**
 * Overrides are dotted-path patches (`names.ru.short` → value) with the
 * pipeline's highest priority. The paths are open by design — the editorial
 * layer may pin any merged field — so only their shape is checked here; the
 * document schema and the build decide what a path may carry.
 */
function parseEntityOverrides(
  value: unknown,
  field: string,
): Record<string, unknown> {
  const record = requestRecord(value, field);
  for (const [path, override] of Object.entries(record)) {
    if (path.length > 200 || !OVERRIDE_PATH_PATTERN.test(path)) {
      validationError(`${field}.${path}`, "is not a valid override path");
    }
    if (override === undefined) {
      validationError(`${field}.${path}`, "must carry a value");
    }
  }
  return record;
}

export function parseEntityUpdateRequest(body: unknown): EntityUpdateInput {
  const root = requestRecord(body, "body");
  exactRequestKeys(
    root,
    [
      "type",
      "status",
      "includeInCountryCatalog",
      "recognitionStatus",
      "recognitionAsOf",
      "validFrom",
      "validTo",
      "parentKey",
      "facts",
      "identifiers",
      "overrides",
    ],
    "body",
  );
  const changes: EntityUpdateInput = {};
  if (root.type !== undefined) {
    if (
      typeof root.type !== "string" ||
      !ENTITY_TYPES.includes(root.type as never)
    ) {
      validationError("type", `must be one of: ${ENTITY_TYPES.join(", ")}`);
    }
    changes.type = root.type as (typeof ENTITY_TYPES)[number];
  }
  if (root.status !== undefined) {
    if (
      typeof root.status !== "string" ||
      !ENTITY_STATUSES.includes(root.status as never)
    ) {
      validationError(
        "status",
        `must be one of: ${ENTITY_STATUSES.join(", ")}`,
      );
    }
    changes.status = root.status as (typeof ENTITY_STATUSES)[number];
  }
  if (root.includeInCountryCatalog !== undefined) {
    if (typeof root.includeInCountryCatalog !== "boolean") {
      validationError("includeInCountryCatalog", "must be a boolean");
    }
    changes.includeInCountryCatalog = root.includeInCountryCatalog;
  }
  if (root.recognitionStatus !== undefined) {
    changes.recognitionStatus = requiredString(
      root.recognitionStatus,
      "recognitionStatus",
      1,
      100,
    );
  }
  if (root.recognitionAsOf !== undefined) {
    changes.recognitionAsOf =
      root.recognitionAsOf === null
        ? null
        : parseIsoDate(root.recognitionAsOf, "recognitionAsOf");
  }
  if (root.validFrom !== undefined) {
    changes.validFrom =
      root.validFrom === null
        ? null
        : parseIsoDate(root.validFrom, "validFrom");
  }
  if (root.validTo !== undefined) {
    changes.validTo =
      root.validTo === null ? null : parseIsoDate(root.validTo, "validTo");
  }
  if (root.parentKey !== undefined) {
    changes.parentKey =
      root.parentKey === null
        ? null
        : requiredString(root.parentKey, "parentKey", 1, 200);
  }
  if (root.facts !== undefined) {
    changes.facts = parseEntityFacts(root.facts, "facts");
  }
  if (root.identifiers !== undefined) {
    changes.identifiers = assertIdentifierShapes(
      parseEntityIdentifiers(root.identifiers, "identifiers"),
      "identifiers",
    );
  }
  if (root.overrides !== undefined) {
    changes.overrides = parseEntityOverrides(root.overrides, "overrides");
  }
  if (Object.keys(changes).length === 0) {
    validationError("body", "must change at least one field");
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

/**
 * What a rollback names: a version, and nothing else.
 *
 * No minimum client version — the release being returned to already carries
 * its own, and accepting one here would let an operator change what a
 * published release demands without republishing it.
 */
export function parseReleaseRollbackRequest(body: unknown): {
  toVersion: string;
} {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["toVersion"], "body");
  return {
    toVersion: requiredString(
      root.toVersion,
      "toVersion",
      1,
      64,
      VERSION_PATTERN,
    ),
  };
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

// ---------------------------------------------------------------------------
// PD-08 (#317): administrative parents, subdivision identifiers and the facts
// a curator writes by hand. Kept as one block at the end of the file so it
// merges cleanly beside the other work in flight on this parser.
// ---------------------------------------------------------------------------

/**
 * What each identifier is allowed to look like, mirroring the editorial
 * schema. The point of the patterns is that `US-CA` cannot be typed into an
 * ISO country field: written into `isoAlpha2` it would put a state
 * everywhere a reader expects a country.
 */
const ENTITY_IDENTIFIER_RULES: Record<
  string,
  { pattern?: RegExp; maxLength?: number; expected: string }
> = {
  isoAlpha2: {
    pattern: /^[A-Za-z]{2}$/,
    expected: "must be a two-letter ISO 3166-1 country code",
  },
  isoAlpha3: {
    pattern: /^[A-Za-z]{3}$/,
    expected: "must be a three-letter ISO 3166-1 country code",
  },
  m49: { pattern: /^[0-9]{3}$/, expected: "must be a three-digit M49 code" },
  isoSubdivision: {
    pattern: /^[A-Za-z]{2}-[A-Za-z0-9]{1,3}$/,
    expected: "must be an ISO 3166-2 subdivision code such as US-CA",
  },
  localCode: { maxLength: 40, expected: "must be at most 40 characters" },
  fipsCode: { maxLength: 10, expected: "must be at most 10 characters" },
};

export function assertIdentifierShapes(
  identifiers: Record<string, string>,
  field: string,
): Record<string, string> {
  for (const [key, value] of Object.entries(identifiers)) {
    const rule = ENTITY_IDENTIFIER_RULES[key];
    if (rule === undefined) {
      continue;
    }
    if (
      (rule.pattern !== undefined && !rule.pattern.test(value)) ||
      (rule.maxLength !== undefined && value.length > rule.maxLength)
    ) {
      validationError(`${field}.${key}`, rule.expected);
    }
  }
  return identifiers;
}

/** Locale → value, the way a fact is written in more than one language. */
export type EntityLocalizedInput = Record<string, string>;

export interface EntityMeasuredInput {
  value: number;
  unit?: string;
  observedAt?: string;
}

export interface EntityFactsInput {
  capital?: EntityLocalizedInput;
  largestCity?: EntityLocalizedInput;
  motto?: EntityLocalizedInput;
  statehoodDate?: string;
  population?: EntityMeasuredInput;
  area?: EntityMeasuredInput;
  languages?: EntityLocalizedInput[];
}

const FACT_LOCALE_PATTERN = /^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8})?$/;

function parseLocalizedValue(
  value: unknown,
  field: string,
): EntityLocalizedInput {
  const record = requestRecord(value, field);
  const localized: EntityLocalizedInput = {};
  for (const [locale, raw] of Object.entries(record)) {
    if (!FACT_LOCALE_PATTERN.test(locale)) {
      validationError(`${field}.${locale}`, "is not a locale");
    }
    localized[locale] = requiredString(raw, `${field}.${locale}`, 1, 200);
  }
  if (Object.keys(localized).length === 0) {
    validationError(field, "must carry at least one locale");
  }
  return localized;
}

function parseMeasuredValue(
  value: unknown,
  field: string,
): EntityMeasuredInput {
  const record = requestRecord(value, field);
  exactRequestKeys(record, ["value", "unit", "observedAt"], field);
  if (typeof record.value !== "number" || !Number.isFinite(record.value)) {
    validationError(`${field}.value`, "must be a number");
  }
  return {
    value: record.value,
    ...(record.unit === undefined
      ? {}
      : { unit: requiredString(record.unit, `${field}.unit`, 1, 40) }),
    ...(record.observedAt === undefined
      ? {}
      : { observedAt: parseIsoDate(record.observedAt, `${field}.observedAt`) }),
  };
}

/**
 * The facts a curator owns. They replace as a whole: the form always sends
 * every field it edits, so clearing a motto is sending the object without
 * one, exactly as the override map behaves.
 */
export function parseEntityFacts(
  value: unknown,
  field: string,
): EntityFactsInput {
  const record = requestRecord(value, field);
  exactRequestKeys(
    record,
    [
      "capital",
      "largestCity",
      "motto",
      "statehoodDate",
      "population",
      "area",
      "languages",
    ],
    field,
  );
  const facts: EntityFactsInput = {};
  for (const name of ["capital", "largestCity", "motto"] as const) {
    if (record[name] !== undefined) {
      facts[name] = parseLocalizedValue(record[name], `${field}.${name}`);
    }
  }
  for (const name of ["population", "area"] as const) {
    if (record[name] !== undefined) {
      facts[name] = parseMeasuredValue(record[name], `${field}.${name}`);
    }
  }
  if (record.statehoodDate !== undefined) {
    facts.statehoodDate = parseIsoDate(
      record.statehoodDate,
      `${field}.statehoodDate`,
    );
  }
  if (record.languages !== undefined) {
    if (!Array.isArray(record.languages)) {
      validationError(`${field}.languages`, "must be an array");
    }
    if (record.languages.length > 20) {
      validationError(`${field}.languages`, "must hold at most 20 languages");
    }
    facts.languages = record.languages.map((language, index) =>
      parseLocalizedValue(language, `${field}.languages[${String(index)}]`),
    );
  }
  return facts;
}
