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

/**
 * How a deck says who belongs to it.
 *
 * `all-current` is the whole approved catalogue. A list is an editorial
 * selection, named entity by entity. `{ taxonomy }` is a node of the
 * classification the catalogue already carries — everything under it, however
 * deep, which is what keeps a regional deck true as the catalogue changes
 * instead of rotting into a list somebody wrote once.
 */
export type EditorialDeckMembers =
  | "all-current"
  | string[]
  | { taxonomy: string };

export interface EditorialDeck {
  key: string;
  kind: "curated" | "taxonomy";
  names: Record<string, { name: string; description: string }>;
  members: EditorialDeckMembers;
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
  /**
   * Where the manifest says this release's assets are served from, ending in a
   * slash. Defaults to the production CDN, which is what a release built
   * without an opinion has always recorded.
   *
   * A publish writes the address it actually uploaded to, so this is the
   * bundle's own statement rather than the last word on it.
   */
  assetBaseUrl?: string;
  /**
   * The oldest client this release is willing to be read by. Defaults to
   * `1.0.0`, the version the first shipped app is expected to carry.
   *
   * A release refuses a client below it, and the refusal is an update screen
   * rather than a catalogue — which is the right answer in production and the
   * wrong one in an environment whose whole purpose is to be read by the build
   * on this machine.
   */
  minimumClientVersion?: string;
}

export interface BuildResult {
  outputDirectory: string;
  reports: PipelineReports;
  fileHashes: Record<string, string>;
}
