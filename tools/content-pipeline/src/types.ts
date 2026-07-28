export type SourceKey =
  | "cldr"
  | "un-m49"
  | "annexare"
  | "world-bank"
  | "wikidata"
  | "flag-icons"
  | "editorial";

export interface SourceDefinition {
  key: SourceKey;
  adapter: SourceKey;
  url: string;
  revision: string;
  retrievedAt: string;
  license: string;
  snapshotPath: string;
  sha256: string;
}

export interface SourceRegistry {
  schemaVersion: 1;
  sources: SourceDefinition[];
}

export interface EntityReference {
  isoAlpha2?: string;
  isoAlpha3?: string;
  m49?: string;
  wikidataId?: string;
  editorialKey?: string;
  customCode?: string;
}

export interface Provenance {
  sourceKey: SourceKey;
  revision: string;
  retrievedAt: string;
}

export interface FieldPatch {
  entity: EntityReference;
  path: string;
  value: unknown;
  priority: number;
  provenance: Provenance;
}

export interface NormalizedSource {
  patches: FieldPatch[];
  relations: RelationCandidate[];
  assets: AssetCandidate[];
}

export interface SourceAdapter {
  pull(
    source: SourceDefinition,
    fetchJson: (url: string) => Promise<unknown>,
    currentSnapshot: unknown,
  ): Promise<unknown>;
  parse(
    payload: unknown,
    source: SourceDefinition,
    currentSnapshot: unknown,
  ): unknown;
  normalize(snapshot: unknown, source: SourceDefinition): NormalizedSource;
}

export interface RelationCandidate {
  parentKey: string;
  child: EntityReference;
  taxonomyKey: string;
  relationType: "contains" | "associated_with";
  primary: boolean;
  provenance: Provenance;
}

export interface AssetCandidate {
  entity: EntityReference;
  upstreamPath: string;
  svg: string;
  aspectRatio: number;
  provenance: Provenance;
  license: string;
  validFrom?: string;
  validTo?: string;
}

export interface EditorialEntity {
  key: string;
  type: "country" | "territory" | "area" | "region" | "subregion";
  status: "active" | "historical" | "retired" | "hidden";
  includeInCountryCatalog: boolean;
  recognitionStatus: string;
  recognitionAsOf?: string;
  validFrom?: string;
  validTo?: string;
  identifiers?: EntityReference;
  overrides?: Record<string, unknown>;
}

export interface EditorialDeck {
  key: string;
  kind: "curated" | "taxonomy";
  names: Record<string, { name: string; description: string }>;
  members: "all-current" | string[];
}

export interface EditorialCatalog {
  schemaVersion: 1;
  defaultLocale: string;
  supportedLocales: string[];
  entities: EditorialEntity[];
  sourceAliases: Record<string, string>;
  additionalRelations: {
    parentKey: string;
    childKey: string;
    taxonomyKey: string;
    relationType: "contains" | "associated_with";
    primary: boolean;
  }[];
  decks: EditorialDeck[];
}

export interface Conflict {
  entityKey: string;
  path: string;
  selected: unknown;
  candidates: {
    value: unknown;
    provenance: Provenance;
    priority: number;
  }[];
  blocking: boolean;
  resolution: "editorial_override" | "source_priority" | "unresolved";
  resolvedByEditorial: boolean;
}

export interface UnresolvedEntity {
  sourceKey: SourceKey;
  reference: EntityReference;
  suggestedKeys: string[];
}

export interface PipelineReports {
  unresolvedEntities: UnresolvedEntity[];
  fieldConflicts: Conflict[];
  missingTranslations: { entityKey: string; locale: string }[];
  missingAssets: { entityKey: string }[];
  licenseProblems: { entityKey: string; reason: string }[];
}

export interface BuildOptions {
  root: string;
  outputRoot: string;
  catalogVersion: string;
  publishReady: boolean;
}

export interface BuildResult {
  outputDirectory: string;
  reports: PipelineReports;
  fileHashes: Record<string, string>;
}
