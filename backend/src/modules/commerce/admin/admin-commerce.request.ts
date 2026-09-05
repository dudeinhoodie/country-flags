import {
  CommerceOfferKind,
  CommerceOfferStatus,
  StoreEnvironment,
  StoreProductStatus,
  StoreProductType,
  StoreProvider,
} from "@prisma/client";

import {
  exactRequestKeys,
  requestRecord,
  requiredString,
  validationError,
} from "../../../common/http/request-validation";

/**
 * What the console may say about commerce, and nothing else.
 *
 * There is no price here, and there is deliberately no way to add one: the
 * store owns what a thing costs, this console records what a purchase
 * grants, and a price the backend accepted would be a second answer to a
 * question only the store can answer (17-paid-decks-storekit §12.4).
 */

const ENTITLEMENT_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const ENTITLEMENT_NAMESPACE = "entitlement.";
const OFFER_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function enumValue<T extends Record<string, string>>(
  enumeration: T,
  value: unknown,
  field: string,
): T[keyof T] {
  const values = Object.values(enumeration);
  if (typeof value !== "string" || !values.includes(value)) {
    validationError(field, `must be one of: ${values.join(", ")}`);
  }
  return value as T[keyof T];
}

export interface EntitlementCreateInput {
  key: string;
  description?: string;
}

export function parseEntitlementCreateRequest(
  body: unknown,
): EntitlementCreateInput {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["key", "description"], "body");
  const key = requiredString(root.key, "key", 1, 120, ENTITLEMENT_KEY_PATTERN);
  // The key is its own namespace on purpose (§3.1). While an entitlement was
  // called `deck.europe_coats` beside a deck called `deck.european_coats`,
  // the two differed by one letter — and for the state flags they did not
  // differ at all. Different namespaces make that confusion impossible
  // rather than merely unlikely.
  if (!key.startsWith(ENTITLEMENT_NAMESPACE)) {
    validationError("key", `must start with "${ENTITLEMENT_NAMESPACE}"`);
  }
  const description = root.description;
  return {
    key,
    ...(description === undefined
      ? {}
      : { description: requiredString(description, "description", 1, 500) }),
  };
}

export interface OfferLocalizationInput {
  name: string;
  description: string;
}

function parseLocalizations(
  value: unknown,
  field: string,
): Record<string, OfferLocalizationInput> {
  const record = requestRecord(value, field);
  const localizations: Record<string, OfferLocalizationInput> = {};
  for (const [locale, localized] of Object.entries(record)) {
    if (!LOCALE_PATTERN.test(locale)) {
      validationError(`${field}.${locale}`, "is not a valid locale");
    }
    const entry = requestRecord(localized, `${field}.${locale}`);
    exactRequestKeys(entry, ["name", "description"], `${field}.${locale}`);
    localizations[locale] = {
      name: requiredString(entry.name, `${field}.${locale}.name`, 1, 200),
      description: requiredString(
        entry.description,
        `${field}.${locale}.description`,
        1,
        2000,
      ),
    };
  }
  return localizations;
}

function parseGrants(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    validationError(field, "must be a non-empty array of entitlement keys");
  }
  const grants = value.map((entry, index) =>
    requiredString(entry, `${field}[${index}]`, 1, 120),
  );
  const unique = new Set(grants);
  if (unique.size !== grants.length) {
    validationError(field, "must not repeat an entitlement key");
  }
  return [...unique].sort();
}

function parseSortOrder(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -1_000_000 ||
    value > 1_000_000
  ) {
    validationError(field, "must be an integer");
  }
  return value;
}

export interface OfferCreateInput {
  code: string;
  kind: CommerceOfferKind;
  grants: string[];
  sortOrder?: number;
  notes?: string;
  localizations?: Record<string, OfferLocalizationInput>;
}

export function parseOfferCreateRequest(body: unknown): OfferCreateInput {
  const root = requestRecord(body, "body");
  exactRequestKeys(
    root,
    ["code", "kind", "grants", "sortOrder", "notes", "localizations"],
    "body",
  );
  const { kind, sortOrder, notes, localizations } = root;
  return {
    code: requiredString(root.code, "code", 1, 100, OFFER_CODE_PATTERN),
    kind:
      kind === undefined
        ? CommerceOfferKind.ONE_TIME
        : enumValue(CommerceOfferKind, kind, "kind"),
    grants: parseGrants(root.grants, "grants"),
    ...(sortOrder === undefined
      ? {}
      : { sortOrder: parseSortOrder(sortOrder, "sortOrder") }),
    ...(notes === undefined
      ? {}
      : { notes: requiredString(notes, "notes", 1, 2000) }),
    ...(localizations === undefined
      ? {}
      : { localizations: parseLocalizations(localizations, "localizations") }),
  };
}

export interface OfferUpdateInput {
  status?: CommerceOfferStatus;
  grants?: string[];
  sortOrder?: number | null;
  notes?: string | null;
  localizations?: Record<string, OfferLocalizationInput>;
}

export function parseOfferUpdateRequest(body: unknown): OfferUpdateInput {
  const root = requestRecord(body, "body");
  const allowed = ["status", "grants", "sortOrder", "notes", "localizations"];
  exactRequestKeys(root, allowed, "body");
  if (!allowed.some((key) => key in root)) {
    validationError("body", `must contain one of: ${allowed.join(", ")}`);
  }
  const { status, grants, sortOrder, notes, localizations } = root;
  return {
    ...(status === undefined
      ? {}
      : { status: enumValue(CommerceOfferStatus, status, "status") }),
    ...(grants === undefined ? {} : { grants: parseGrants(grants, "grants") }),
    ...(sortOrder === undefined
      ? {}
      : {
          sortOrder:
            sortOrder === null ? null : parseSortOrder(sortOrder, "sortOrder"),
        }),
    ...(notes === undefined
      ? {}
      : {
          notes:
            notes === null ? null : requiredString(notes, "notes", 1, 2000),
        }),
    ...(localizations === undefined
      ? {}
      : { localizations: parseLocalizations(localizations, "localizations") }),
  };
}

export interface StoreProductCreateInput {
  provider: StoreProvider;
  storeEnvironment: StoreEnvironment;
  bundleId: string;
  productId: string;
  productType: StoreProductType;
}

export function parseStoreProductCreateRequest(
  body: unknown,
): StoreProductCreateInput {
  const root = requestRecord(body, "body");
  exactRequestKeys(
    root,
    ["provider", "storeEnvironment", "bundleId", "productId", "productType"],
    "body",
  );
  const productType = root.productType;
  return {
    provider: enumValue(StoreProvider, root.provider, "provider"),
    // Asked for rather than inferred: naming the store you mean is what the
    // server then checks against the store this deployment actually talks to.
    storeEnvironment: enumValue(
      StoreEnvironment,
      root.storeEnvironment,
      "storeEnvironment",
    ),
    bundleId: requiredString(root.bundleId, "bundleId", 1, 200),
    productId: requiredString(root.productId, "productId", 1, 200),
    productType:
      productType === undefined
        ? StoreProductType.NON_CONSUMABLE
        : enumValue(StoreProductType, productType, "productType"),
  };
}

export interface StoreProductUpdateInput {
  status: StoreProductStatus;
}

export function parseStoreProductUpdateRequest(
  body: unknown,
): StoreProductUpdateInput {
  const root = requestRecord(body, "body");
  // Status only. The product id, its type, its bundle and its environment are
  // what identify the thing; editing one of them would silently repoint an
  // offer at a different product, and the store would never know.
  exactRequestKeys(root, ["status"], "body");
  if (!("status" in root)) {
    validationError("body", "must contain: status");
  }
  return {
    status: enumValue(StoreProductStatus, root.status, "status"),
  };
}
