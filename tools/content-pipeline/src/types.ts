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
  /**
   * ISO 3166-2, such as `US-CA`. Kept apart from the country codes on
   * purpose: a subdivision code written into `isoAlpha2` would put a state
   * everywhere a reader expects a country (ADR-020).
   */
  isoSubdivision?: string;
  /** The official code the parent country uses for the unit, if any. */
  localCode?: string;
  /** Only where the source publishes one; never derived. */
  fipsCode?: string;
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

/**
 * A table of names that belongs to no single entity.
 *
 * A patch says something about one country; a language's name in Russian is
 * true everywhere it is spoken. Carrying it as a patch would mean writing the
 * whole table onto all 250 entities, so a source contributes it once and the
 * fact assembly reads it when it names the codes an entity actually lists.
 */
export interface SourceLexicon {
  /** Language subtag to its name per locale, as the source spells them. */
  languages?: Record<string, Record<string, string>>;
}

export interface NormalizedSource {
  patches: FieldPatch[];
  relations: RelationCandidate[];
  assets: AssetCandidate[];
  lexicon?: SourceLexicon;
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
  /**
   * The vector original. Absent only for a raster-only editorial override,
   * which then carries `png` instead: an editor may supply a drawing that
   * never had a vector, and pretending otherwise would publish a fake one.
   */
  svg?: string;
  /** Raster original bytes; present exactly when `svg` is absent. */
  png?: Buffer;
  aspectRatio: number;
  provenance: Provenance;
  license: string;
  /**
   * Who must be credited for this drawing. Adapters default to their
   * upstream project; an editorial override names whoever supplied it,
   * because crediting flag-icons for a drawing it did not make is wrong.
   */
  attribution?: string;
  validFrom?: string;
  validTo?: string;
}

/**
 * What a drawing depicts.
 *
 * One entity holds several of them at once, and they never overwrite one
 * another: replacing a coat of arms leaves the flag — and the card taught
 * from it — exactly where it was (ADR-020).
 */
export type EditorialAssetType = "flag" | "coat_of_arms" | "map";

/**
 * An editorially supplied asset that outranks every adapter candidate.
 *
 * The drawing itself lives beside the catalog at
 * `editorial/overrides/assets/<entityKey>/<assetType>/<variant>.svg` (or
 * `.png` for a drawing that never had a vector); this record carries the
 * provenance a published
 * asset must have. Without an explicit layer the next source refresh would
 * silently overwrite a hand-picked flag, so the override is a first-class
 * part of the editorial document rather than a patch applied after the
 * fact.
 */
export interface EditorialAssetOverride {
  entityKey: string;
  assetType: EditorialAssetType;
  /**
   * Which drawing of this type. `current` is the one in force; a historical
   * or ceremonial variant carries its own key and its own validity, which is
   * how a superseded coat of arms stays available without becoming a second
   * country.
   */
  variant: string;
  aspectRatio: number;
  license: string;
  sourceUrl: string;
  attribution?: string;
  /** Why a human replaced the upstream drawing; it travels into review. */
  reason: string;
  /**
   * What this drawing is called and what it means, per locale. It belongs to
   * the asset rather than to the entity: the story of the German federal
   * eagle is the story of one symbol, not of Germany.
   */
  localizations?: Record<string, EditorialAssetLocalization>;
  validFrom?: string;
  validTo?: string;
}

export interface EditorialAssetLocalization {
  displayName?: string;
  description?: string;
}

export type EditorialEntityType =
  | "country"
  | "territory"
  | "area"
  | "subdivision"
  | "region"
  | "subregion";

export interface EditorialEntity {
  key: string;
  type: EditorialEntityType;
  status: "active" | "historical" | "retired" | "hidden";
  /**
   * The country or territory an administrative unit belongs to. Required of
   * a subdivision and meaningless anywhere else. Authoring convenience: the
   * publisher normalizes it into the canonical CONTAINS relation, so nothing
   * downstream has two ways to ask who California is part of (ADR-020).
   */
  parentKey?: string;
  /**
   * Presentation toggles (ADR-015). They never decide whether the entity
   * is learnable: an active country, territory or area keeps its card and
   * facts and stays available to every deck regardless.
   */
  config: {
    /** Whether the entity appears in the all-countries deck. */
    includeInCountryCatalog: boolean;
    /**
     * Fact types this entity does not have because of what it is, not
     * because the sources came up short. Antarctica has no capital,
     * currency, official language or resident population, and saying so is
     * a different statement from failing to find them (#272).
     */
    factsNotApplicable?: string[];
  };
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
  | EditorialCardRef[]
  | { taxonomy: string };

/**
 * One card variant: an entity taught through a named template.
 *
 * A bare key takes the deck's default template, which is why a deck that
 * lists bare keys has to declare one. Germany under two templates is two
 * cards with two schedules, and a deck says which of them it holds.
 */
export type EditorialCardRef = string | EditorialCardVariantRef;

export interface EditorialCardVariantRef {
  entityKey: string;
  templateCode: string;
  templateSchemaVersion: number;
}

/**
 * Who may open the deck. Absent means free.
 *
 * Monetization lives here and nowhere else: no entity, asset or template is
 * paid, and no price is written down — an offer grants the entitlement key,
 * and the store owns what it costs (ADR-019).
 */
export interface EditorialDeckAccess {
  model: "FREE" | "ENTITLEMENT";
  requiredEntitlementKey?: string;
}

export interface EditorialDeck {
  key: string;
  kind: "curated" | "taxonomy";
  names: Record<string, { name: string; description: string }>;
  members: EditorialDeckMembers;
  /** The template a bare member key is taught through. */
  defaultTemplateCode?: string;
  defaultTemplateSchemaVersion?: number;
  access?: EditorialDeckAccess;
  /**
   * The card variants a locked deck may show before it is bought: at most
   * three, each of them a member. A preview is its own published
   * projection, never a hole in the cards endpoint.
   */
  previewCards?: EditorialCardRef[];
}

export interface EditorialCatalog {
  schemaVersion: 3;
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
  assetOverrides?: EditorialAssetOverride[];
}

/**
 * The editorial document as it is found on disk.
 *
 * The catalog is still written as v2 and lifted on read; both shapes stay
 * readable so the flip happens in one reviewed change once the console
 * writes v3 (#314).
 */
export type EditorialDocument = EditorialCatalog | EditorialCatalogV2;

export interface EditorialCatalogV2
  extends Omit<EditorialCatalog, "schemaVersion" | "decks" | "assetOverrides"> {
  schemaVersion: 2;
  decks: EditorialDeckV2[];
  assetOverrides?: EditorialAssetOverrideV2[];
}

export interface EditorialDeckV2 {
  key: string;
  kind: "curated" | "taxonomy";
  names: Record<string, { name: string; description: string }>;
  members: "all-current" | string[] | { taxonomy: string };
}

export interface EditorialAssetOverrideV2
  extends Omit<EditorialAssetOverride, "assetType" | "variant"> {
  assetType: "flag";
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
  /**
   * A fact published without a name in every supported locale. Not a failure
   * — the reader falls back — but the list is where a curator sees what an
   * editorial override still has to say.
   */
  unnamedFacts: UnnamedFact[];
  /**
   * A learnable entity whose card would have nothing on its back. Blocking
   * unless every fact type it lacks was declared in the catalog's
   * `factsNotApplicable`: a card that teaches only the flag and the name is
   * a decision somebody made, and one that lost its facts to a source is
   * not (#272).
   */
  factlessEntities: FactlessEntity[];
  /**
   * An editorial override that displaced adapter candidates. Reported for
   * the same reason field conflicts are: a silent win is a decision nobody
   * can review, and a source refresh that changes the upstream drawing under
   * an active override has to be visible in the refresh pull request.
   */
  assetOverrides: AssetOverrideReport[];
}

export interface FactlessEntity {
  entityKey: string;
  /**
   * The fact types it has neither a value for nor a declaration about. An
   * empty list means every absence was accounted for in the catalog, and the
   * entry is a record rather than a failure.
   */
  undeclared: string[];
  blocking: boolean;
}

export interface UnnamedFact {
  entityKey: string;
  factType: string;
  /** The supported locale the fact has no name in. */
  locale: string;
  /** The code the missing name belongs to, when the fact lists codes. */
  detail?: string;
}

export interface AssetOverrideReport {
  entityKey: string;
  reason: string;
  /** Adapter candidates the override displaced, by source key. */
  shadowedSourceKeys: string[];
  /**
   * Checksum of the upstream drawing this override replaced, when there was
   * one. A refresh that changes it flags the override for a second look.
   */
  shadowedSha256: string | null;
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
