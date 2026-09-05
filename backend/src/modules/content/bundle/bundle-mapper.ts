import { createHash } from "node:crypto";

import {
  AssetStatus,
  AssetType,
  CardStatus,
  FactType,
  GeoEntityKind,
  GeoEntityStatus,
  GeoRelationType,
  GradingMode,
  ProgressPolicy,
  PublicationStatus,
  RecognitionStatus,
  RevisionChangeClassification,
} from "@prisma/client";

import type {
  DomainCardTemplate,
  DomainEntity,
  DomainFactCollection,
} from "./bundle-domain";

const ENTITY_KIND_BY_TYPE: Record<DomainEntity["type"], GeoEntityKind> = {
  country: GeoEntityKind.COUNTRY,
  territory: GeoEntityKind.TERRITORY,
  subdivision: GeoEntityKind.SUBDIVISION,
  region: GeoEntityKind.REGION,
  subregion: GeoEntityKind.SUBREGION,
  // "area" (uninhabited/special areas such as Antarctica) has no direct Prisma
  // equivalent; OTHER is the closest generic bucket.
  area: GeoEntityKind.OTHER,
};

const ENTITY_STATUS_BY_STATUS: Record<DomainEntity["status"], GeoEntityStatus> =
  {
    active: GeoEntityStatus.ACTIVE,
    historical: GeoEntityStatus.HISTORICAL,
    hidden: GeoEntityStatus.HIDDEN,
    // Prisma has no RETIRED entity status; treat it as HIDDEN.
    retired: GeoEntityStatus.HIDDEN,
  };

const RELATION_TYPE_MAP: Record<string, GeoRelationType> = {
  contains: GeoRelationType.CONTAINS,
  associated_with: GeoRelationType.ASSOCIATED_WITH,
};

const FACT_TYPE_MAP: Record<DomainFactCollection["factType"], FactType> = {
  capitals: FactType.CAPITAL,
  currencies: FactType.CURRENCY,
  languages: FactType.LANGUAGE,
  population: FactType.POPULATION,
};

const GRADING_MODE_MAP: Record<DomainCardTemplate["gradingMode"], GradingMode> =
  {
    self_rated: GradingMode.SELF_RATED,
    multiple_choice: GradingMode.MULTIPLE_CHOICE,
    text: GradingMode.TEXT,
  };

const PUBLICATION_STATUS_MAP: Record<
  DomainCardTemplate["status"],
  PublicationStatus
> = {
  draft: PublicationStatus.DRAFT,
  published: PublicationStatus.PUBLISHED,
  retired: PublicationStatus.RETIRED,
};

const CARD_STATUS_MAP: Record<"active" | "retired", CardStatus> = {
  active: CardStatus.ACTIVE,
  retired: CardStatus.RETIRED,
};

const CHANGE_CLASSIFICATION_MAP: Record<
  "technical" | "equivalent",
  RevisionChangeClassification
> = {
  technical: RevisionChangeClassification.TECHNICAL,
  equivalent: RevisionChangeClassification.EQUIVALENT,
};

export function mapEntityKind(type: DomainEntity["type"]): GeoEntityKind {
  return ENTITY_KIND_BY_TYPE[type];
}

export function mapEntityStatus(
  status: DomainEntity["status"],
): GeoEntityStatus {
  return ENTITY_STATUS_BY_STATUS[status];
}

export function mapRecognitionStatus(status: string): RecognitionStatus {
  const value = status.toUpperCase() as RecognitionStatus;
  if (!(value in RecognitionStatus)) {
    throw new Error(`Unknown recognition status ${status}`);
  }
  return value;
}

export function mapRelationType(relationType: string): GeoRelationType {
  const value = RELATION_TYPE_MAP[relationType];
  if (value === undefined) {
    throw new Error(`Unknown relation type ${relationType}`);
  }
  return value;
}

export function mapFactType(
  factType: DomainFactCollection["factType"],
): FactType {
  return FACT_TYPE_MAP[factType];
}

export function mapGradingMode(
  gradingMode: DomainCardTemplate["gradingMode"],
): GradingMode {
  return GRADING_MODE_MAP[gradingMode];
}

export function mapBackSideFactTypes(
  factTypes: string[] | undefined,
): FactType[] {
  return (factTypes ?? []).map((factType) => {
    const value = factType.toUpperCase() as FactType;
    if (!(value in FactType)) {
      throw new Error(`Unknown back-side fact type ${factType}`);
    }
    return value;
  });
}

export function mapPublicationStatus(
  status: DomainCardTemplate["status"],
): PublicationStatus {
  return PUBLICATION_STATUS_MAP[status];
}

export function mapCardStatus(status: "active" | "retired"): CardStatus {
  return CARD_STATUS_MAP[status];
}

export function mapChangeClassification(
  classification: "technical" | "equivalent",
): RevisionChangeClassification {
  return CHANGE_CLASSIFICATION_MAP[classification];
}

export function mapProgressPolicy(): ProgressPolicy {
  return ProgressPolicy.PRESERVE;
}

const ASSET_TYPE_MAP: Record<string, AssetType> = {
  flag: AssetType.FLAG,
  coat_of_arms: AssetType.COAT_OF_ARMS,
  map: AssetType.MAP,
};

export function mapAssetType(assetType: string): AssetType {
  const mapped = ASSET_TYPE_MAP[assetType];
  if (mapped === undefined) {
    throw new Error(`Unknown asset type ${assetType}`);
  }
  return mapped;
}

export function mapAssetStatus(): AssetStatus {
  return AssetStatus.PUBLISHED;
}

export function slugFromEntityKey(entityKey: string): string {
  const [, ...rest] = entityKey.split(".");
  return rest.join("-");
}

/** What `Deck.code` is allowed to be, from `contracts/openapi/components.yaml`. */
export const DECK_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/u;

/**
 * The code a deck is served under, derived from its content key.
 *
 * A content key is lower case and namespaced (`deck.europe`) while the contract
 * serves a deck under `^[A-Z][A-Z0-9_]*$`, so the key is the code in a
 * different alphabet: `deck.europe` is served as `EUROPE`. Deriving it is what
 * keeps the two identifiers from drifting apart — the editorial catalogue names
 * a deck once — and it is the same derivation the iOS mock applies to the same
 * bundle, so the mock and a real publish agree on what a deck is called.
 *
 * Not every key can be expressed: one that starts with a digit derives a code
 * the contract refuses, and two keys can derive the same one. The validator
 * rejects both before a publish begins.
 */
export function deckCodeFromKey(deckKey: string): string {
  const [, ...rest] = deckKey.split(".");
  return rest
    .join(".")
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "_");
}

interface KnownSource {
  name: string;
  url: string;
  licenseName: string;
}

const KNOWN_SOURCES: Record<string, KnownSource> = {
  annexare: {
    name: "annexare/Countries",
    url: "https://github.com/annexare/Countries",
    licenseName: "MIT",
  },
  cldr: {
    name: "Unicode CLDR",
    url: "https://github.com/unicode-org/cldr-json",
    licenseName: "Unicode-3.0",
  },
  "un-m49": {
    name: "UN M49 standard",
    url: "https://unstats.un.org/unsd/methodology/m49/overview/",
    licenseName: "UN terms of use",
  },
  "world-bank": {
    name: "World Bank Open Data",
    url: "https://data.worldbank.org/",
    licenseName: "CC-BY-4.0",
  },
  wikidata: {
    name: "Wikidata",
    url: "https://www.wikidata.org/",
    licenseName: "CC0-1.0",
  },
  "flag-icons": {
    name: "lipis/flag-icons",
    url: "https://github.com/lipis/flag-icons",
    licenseName: "MIT",
  },
  editorial: {
    name: "Country Flags editorial overrides",
    url: "https://country-flags.app/content/editorial",
    licenseName: "CC0-1.0",
  },
};

export function resolveSourceMetadata(sourceKey: string): KnownSource {
  return (
    KNOWN_SOURCES[sourceKey] ?? {
      name: sourceKey,
      url: `https://country-flags.app/content-sources/${sourceKey}`,
      licenseName: "See source registry",
    }
  );
}

/** Deterministic UUID (v5-like) so re-publishing the same sourceKey never creates a duplicate Source row. */
export function deterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sourceIdForKey(sourceKey: string): string {
  return deterministicUuid(`content-source:${sourceKey}`);
}
