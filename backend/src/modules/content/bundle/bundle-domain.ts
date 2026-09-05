import { parseJsonFile, type LoadedBundle } from "./bundle-reader";

export interface DomainEntityName {
  short: string;
  official?: string;
  aliases?: string[];
}

export interface DomainEntity {
  key: string;
  type:
    | "country"
    | "territory"
    | "area"
    | "subdivision"
    | "region"
    | "subregion";
  status: "active" | "historical" | "retired" | "hidden";
  includeInCountryCatalog: boolean;
  recognition: { status: string; asOf?: string; note?: Record<string, string> };
  codes?: {
    isoAlpha2?: string;
    isoAlpha3?: string;
    m49?: string;
    customCode?: string;
  };
  names: Record<string, DomainEntityName>;
  assetKeys?: string[];
  validFrom?: string;
  validTo?: string;
}

export interface DomainRelation {
  parentKey: string;
  childKey: string;
  taxonomyKey: string;
  relationType: "contains" | "associated_with";
  primary: boolean;
}

export interface DomainCardRef {
  entityKey: string;
  templateCode: string;
  templateSchemaVersion: number;
}

export interface DomainDeckAccess {
  model: "FREE" | "ENTITLEMENT";
  requiredEntitlementKey?: string;
}

export interface DomainDeck {
  key: string;
  kind: "curated" | "taxonomy";
  names: Record<string, { name: string; description?: string }>;
  /**
   * Which entities the deck covers. Still a real answer — which countries
   * does this deck teach — but no longer the thing membership is built
   * from: an entity with two symbols is two cards, and this list cannot say
   * which of them a deck holds.
   */
  memberEntityKeys: string[];
  /** What the deck actually holds, in editorial order. */
  memberCards: DomainCardRef[];
  contentKinds: string[];
  cardCount: number;
  access?: DomainDeckAccess;
  previewCards?: DomainCardRef[];
}

export interface DomainCatalog {
  catalogVersion: string;
  defaultLocale: string;
  supportedLocales: string[];
  entities: DomainEntity[];
  relations: DomainRelation[];
  decks: DomainDeck[];
}

export interface DomainAssetRepresentation {
  path: string;
  mimeType: string;
  /** Of the bytes this representation serves, not of the asset. */
  sha256: string;
  scale?: number;
  widthPx?: number;
  heightPx?: number;
}

export interface DomainAsset {
  key: string;
  entityKey: string;
  assetType: "flag" | "coat_of_arms" | "map";
  variant: string;
  /**
   * Every published encoding, in the order a client should prefer them: the
   * vector original first, then raster by ascending scale.
   *
   * The only place an encoding is described. The asset used to repeat the
   * vector's path, media type and checksum beside this list for the benefit of
   * readers written before it existed; there are none.
   */
  representations: DomainAssetRepresentation[];
  aspectRatio?: number;
  license: string;
  attribution?: string;
  sourcePath?: string;
  provenance: { sourceKey: string; revision: string; retrievedAt: string };
  validFrom?: string | null;
  validTo?: string | null;
}

export interface DomainFactRecord {
  entityKey: string;
  gap: boolean;
  reason?: string;
  value?: unknown;
  provenance?: { sourceKey: string; revision: string; retrievedAt: string };
}

export interface DomainFactCollection {
  factType: "capitals" | "currencies" | "languages" | "population";
  records: DomainFactRecord[];
}

export interface DomainCardTemplate {
  code: string;
  schemaVersion: number;
  promptType: string;
  answerType: string;
  gradingMode: "self_rated" | "multiple_choice" | "text";
  promptSpec: Record<string, unknown>;
  answerSpec: Record<string, unknown>;
  backSideFactTypes?: string[];
  status: "draft" | "published" | "retired";
}

export interface DomainLearningCardRevision {
  revision: number;
  promptAssetKey: string | null;
  promptFingerprint: string;
  changeClassification: "technical" | "equivalent";
  progressPolicy: "preserve";
  effectiveFrom: string;
  retiredAt: string | null;
}

export interface DomainLearningCard {
  entityKey: string;
  templateCode: string;
  templateSchemaVersion: number;
  semanticVersion: number;
  supersedesSemanticVersion: number | null;
  status: "active" | "retired";
  revisions: DomainLearningCardRevision[];
}

export interface BundleDomain {
  catalog: DomainCatalog;
  assets: DomainAsset[];
  facts: DomainFactCollection[];
  cardTemplates: DomainCardTemplate[];
  learningCards: DomainLearningCard[];
}

export function parseBundleDomain(bundle: LoadedBundle): BundleDomain {
  const catalog = parseJsonFile<DomainCatalog>(bundle, "catalog.json");
  const assetRegistry = parseJsonFile<{ assets: DomainAsset[] }>(
    bundle,
    "assets/assets.json",
  );
  const cardTemplatesFile = parseJsonFile<{ templates: DomainCardTemplate[] }>(
    bundle,
    "card-templates.json",
  );
  const learningCardsFile = parseJsonFile<{ cards: DomainLearningCard[] }>(
    bundle,
    "learning-cards.json",
  );
  const facts = bundle.manifest.files
    .filter((file) => file.path.startsWith("facts/"))
    .map((file) => parseJsonFile<DomainFactCollection>(bundle, file.path));

  return {
    catalog,
    assets: assetRegistry.assets,
    facts,
    cardTemplates: cardTemplatesFile.templates,
    learningCards: learningCardsFile.cards,
  };
}
