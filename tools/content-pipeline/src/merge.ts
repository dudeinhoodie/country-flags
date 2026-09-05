import { isDeepStrictEqual } from "node:util";

import { sha256 } from "@country-flags/asset-core";

import { memberEntityKey } from "./editorial-schema.js";

import { buildAsset, type BuiltAsset } from "./assets.js";
import { editorialPatches, type EntityMatcher } from "./matching.js";
import type {
  AssetCandidate,
  Conflict,
  EditorialCatalog,
  EditorialDeck,
  FieldPatch,
  NormalizedSource,
  PipelineReports,
  Provenance,
  SourceLexicon,
} from "./types.js";

/** An editorial override paired with the candidate built from its file. */
export interface EditorialAssetOverrideCandidate {
  entityKey: string;
  reason: string;
  candidate: AssetCandidate;
}

type MutableRecord = Record<string, unknown>;

interface CatalogRelation {
  parentKey: string;
  childKey: string;
  taxonomyKey: string;
  relationType: string;
  primary: boolean;
}

/**
 * Who a deck holds.
 *
 * A taxonomy deck names a node rather than its members: everything the
 * classification places under it, at any depth, and only what the learnable
 * pool still carries. Regions hold subregions and subregions hold
 * countries, so the walk is what turns "Europe" into the fifty-odd entities it
 * actually means — and it stays that as the catalogue changes, which a list
 * written by hand does not.
 *
 * `all-current` alone reads the listing toggle: hiding an entity from the
 * all-countries deck must not silently pull it out of every other deck
 * (ADR-015).
 *
 * Only `contains` is followed. The other relation an entity can carry says it
 * is associated with a region rather than part of it, and a deck built from
 * both would teach Russia twice.
 */
function deckMembers(
  deck: EditorialDeck,
  pools: { allCurrent: string[]; learnable: string[] },
  relations: CatalogRelation[],
): string[] {
  if (deck.members === "all-current") {
    return pools.allCurrent;
  }
  if (Array.isArray(deck.members)) {
    // A member names a card variant, and two variants of one entity are two
    // members. The published catalog still lists entities, so they collapse
    // here; the deck keeps both cards once membership is materialized per
    // template (#315).
    return [...new Set(deck.members.map(memberEntityKey))].sort();
  }

  const root = deck.members.taxonomy;
  const childrenByParent = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.relationType !== "contains") {
      continue;
    }
    const siblings = childrenByParent.get(relation.parentKey) ?? [];
    siblings.push(relation.childKey);
    childrenByParent.set(relation.parentKey, siblings);
  }
  if (!childrenByParent.has(root)) {
    throw new Error(
      `deck ${deck.key} is built from ${root}, which contains nothing in this catalog`,
    );
  }

  const included = new Set(pools.learnable);
  const members = new Set<string>();
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined || seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (key !== root && included.has(key)) {
      members.add(key);
    }
    queue.push(...(childrenByParent.get(key) ?? []));
  }

  if (members.size === 0) {
    throw new Error(
      `deck ${deck.key} is built from ${root} and would hold no entity the catalog publishes`,
    );
  }
  return [...members].sort();
}

export interface MergedContent {
  catalog: MutableRecord;
  facts: Record<string, MutableRecord>;
  assets: BuiltAsset[];
  provenance: Record<string, Provenance>;
  reports: PipelineReports;
  /**
   * Every entity that carries a learning card: active countries,
   * territories and areas, whatever the listing toggle says (ADR-015).
   */
  learnableEntityKeys: string[];
}

const LEARNABLE_TYPES = new Set(["country", "territory", "area"]);

/// The fact types a release publishes, in the order the back of a card
/// reads them.
const FACT_TYPES = ["capitals", "currencies", "languages", "population"];

/// A source that answers "none" — `[]`, `{}`, `""` — has answered. It is
/// saying the entity does not have the thing, which is a gap rather than a
/// fact with nothing in it (#272).
function isEmptyFactValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (Array.isArray(value) || typeof value === "string") {
    return value.length === 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

function isLearnable(entity: MutableRecord): boolean {
  return entity.status === "active" && LEARNABLE_TYPES.has(String(entity.type));
}

function setPath(target: MutableRecord, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    if (child === null || typeof child !== "object" || Array.isArray(child)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as MutableRecord;
  }
  const last = segments.at(-1);
  if (last !== undefined) {
    cursor[last] = value;
  }
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Adds the names a fact carries in locales its own source does not speak, and
 * reports every locale still left without one.
 *
 * Both additions are deliberately not patches. The seat's Russian name comes
 * from a different source than the seat, and a patch replaces a path whole —
 * writing it would hand the fact to Wikidata and move every English name with
 * it. A language's name is not about any one country at all. So the owning
 * source keeps the fact, and what it cannot say is filled in here.
 *
 * A name that is still missing is not an error: English is always there to
 * fall back to. It is listed instead, because the list is where a curator
 * sees what an editorial override has left to say.
 */
function nameFactValue(
  factType: string,
  value: unknown,
  entity: MutableRecord,
  lexicon: SourceLexicon,
  entityKey: string,
  locales: string[],
  reports: PipelineReports,
): unknown {
  if (!Array.isArray(value) || value.length === 0) {
    return value;
  }
  // `Array.isArray` narrows an unknown to `any[]`, and every element read out
  // of it would be an `any` this function then hands back. Naming the element
  // type keeps what leaves here as unexamined as what came in.
  const entries: unknown[] = value;
  const report = (names: Record<string, string>, detail?: string): void => {
    for (const locale of locales) {
      if (typeof names[locale] !== "string") {
        reports.unnamedFacts.push({
          entityKey,
          factType,
          locale,
          ...(detail === undefined ? {} : { detail }),
        });
      }
    }
  };

  if (factType === "capitals") {
    // Offered for the one seat Wikidata knows. A country with several seats
    // gets nothing: which seat a single name belongs to is exactly what is
    // unknown, and a name on the wrong seat is worse than an absent one.
    const offered =
      entries.length === 1
        ? ((entity.localizedNames as MutableRecord | undefined)?.capitals as
            | Record<string, string>
            | undefined)
        : undefined;
    return entries.map((seat) => {
      if (!isRecord(seat)) {
        return seat;
      }
      const names = {
        ...(isRecord(seat.names) ? (seat.names as Record<string, string>) : {}),
        ...(offered ?? {}),
      };
      report(names);
      return { ...seat, names };
    });
  }

  if (factType === "languages") {
    const table = lexicon.languages ?? {};
    return entries.map((entry) => {
      if (!isRecord(entry) || typeof entry.code !== "string") {
        return entry;
      }
      const names = table[entry.code];
      if (names === undefined) {
        // A subtag no registered source can name. It stays in the fact — the
        // country does speak it — and the reader falls back to naming it.
        report({}, entry.code);
        return entry;
      }
      report(names, entry.code);
      return { ...entry, names };
    });
  }
  return value;
}

function groupedPatches(
  patches: FieldPatch[],
  matcher: EntityMatcher,
  reports: PipelineReports,
): Map<string, FieldPatch[]> {
  const groups = new Map<string, FieldPatch[]>();
  for (const patch of patches) {
    const entityKey = matcher.resolve(patch.entity, patch.provenance.sourceKey);
    if (entityKey === undefined) {
      reports.unresolvedEntities.push(
        matcher.unresolved(patch.entity, patch.provenance.sourceKey),
      );
      continue;
    }
    const key = `${entityKey}\u0000${patch.path}`;
    const group = groups.get(key) ?? [];
    group.push(patch);
    groups.set(key, group);
  }
  return groups;
}

function choosePatch(
  entityKey: string,
  path: string,
  patches: FieldPatch[],
  conflicts: Conflict[],
): FieldPatch {
  const ordered = [...patches].sort(
    (left, right) =>
      right.priority - left.priority ||
      left.provenance.sourceKey.localeCompare(right.provenance.sourceKey, "en"),
  );
  const winner = ordered[0];
  if (winner === undefined) {
    throw new Error("Cannot choose from an empty patch group");
  }
  const distinct = ordered.filter(
    (candidate, index) =>
      ordered.findIndex((other) =>
        isDeepStrictEqual(other.value, candidate.value),
      ) === index,
  );
  if (distinct.length > 1) {
    const topPriority = winner.priority;
    const tiedWinners = distinct.filter(
      ({ priority }) => priority === topPriority,
    );
    const resolvedByEditorial = winner.provenance.sourceKey === "editorial";
    const blocking = tiedWinners.length > 1 && !resolvedByEditorial;
    conflicts.push({
      entityKey,
      path,
      selected: winner.value,
      candidates: distinct.map(({ value, provenance, priority }) => ({
        value,
        provenance,
        priority,
      })),
      blocking,
      resolution: resolvedByEditorial
        ? "editorial_override"
        : blocking
          ? "unresolved"
          : "source_priority",
      resolvedByEditorial,
    });
  }
  return winner;
}

export async function mergeContent(
  outputDirectory: string,
  catalogVersion: string,
  editorial: EditorialCatalog,
  normalized: NormalizedSource[],
  matcher: EntityMatcher,
  editorialProvenance: Provenance,
  /**
   * Editorial asset overrides, already read from disk by the caller. They
   * outrank every adapter candidate: a human picked this drawing on purpose,
   * and the next source refresh must not undo that silently.
   */
  assetOverrides: EditorialAssetOverrideCandidate[] = [],
): Promise<MergedContent> {
  const reports: PipelineReports = {
    unresolvedEntities: [],
    fieldConflicts: [],
    missingTranslations: [],
    missingAssets: [],
    licenseProblems: [],
    unnamedFacts: [],
    factlessEntities: [],
    assetOverrides: [],
  };
  const provenanceMap: Record<string, Provenance> = {};
  const byEntity = new Map<string, MutableRecord>();
  for (const entity of editorial.entities) {
    const codes = Object.fromEntries(
      (["isoAlpha2", "isoAlpha3", "m49", "customCode"] as const).flatMap(
        (kind) => {
          const value = entity.identifiers?.[kind];
          return value === undefined ? [] : [[kind, value]];
        },
      ),
    );
    byEntity.set(entity.key, {
      key: entity.key,
      type: entity.type,
      status: entity.status,
      // The built catalog keeps the flat field: the editorial config
      // object is source structure, not a published shape.
      includeInCountryCatalog: entity.config.includeInCountryCatalog,
      recognition: {
        status: entity.recognitionStatus,
        ...(entity.recognitionAsOf === undefined
          ? {}
          : { asOf: entity.recognitionAsOf }),
      },
      ...(entity.validFrom === undefined
        ? {}
        : { validFrom: entity.validFrom }),
      ...(entity.validTo === undefined ? {} : { validTo: entity.validTo }),
      ...(Object.keys(codes).length === 0 ? {} : { codes }),
    });
    for (const path of [
      "type",
      "status",
      "includeInCountryCatalog",
      "recognition.status",
    ]) {
      provenanceMap[`${entity.key}/${path}`] = editorialProvenance;
    }
    if (entity.recognitionAsOf !== undefined) {
      provenanceMap[`${entity.key}/recognition.asOf`] = editorialProvenance;
    }
    for (const identifier of Object.keys(codes)) {
      provenanceMap[`${entity.key}/codes.${identifier}`] = editorialProvenance;
    }
    if (entity.validFrom !== undefined) {
      provenanceMap[`${entity.key}/validFrom`] = editorialProvenance;
    }
    if (entity.validTo !== undefined) {
      provenanceMap[`${entity.key}/validTo`] = editorialProvenance;
    }
  }

  const patches = [
    ...normalized.flatMap(({ patches }) => patches),
    ...editorialPatches(editorial, editorialProvenance),
  ];
  for (const [groupKey, group] of groupedPatches(patches, matcher, reports)) {
    const [entityKey, path] = groupKey.split("\u0000");
    if (entityKey === undefined || path === undefined) {
      continue;
    }
    const winner = choosePatch(entityKey, path, group, reports.fieldConflicts);
    const entity = byEntity.get(entityKey);
    if (entity !== undefined) {
      setPath(entity, path, winner.value);
      provenanceMap[`${entityKey}/${path}`] = winner.provenance;
    }
  }

  // Adapter candidates are collected per entity rather than written as they
  // arrive: an entity can be described by several sources, and which drawing
  // wins has to be a decision that gets reported rather than whichever one
  // happened to be last.
  const adapterCandidatesByEntity = new Map<string, AssetCandidate[]>();
  for (const candidate of normalized.flatMap(({ assets }) => assets)) {
    const entityKey = matcher.resolve(
      candidate.entity,
      candidate.provenance.sourceKey,
    );
    if (entityKey === undefined) {
      reports.unresolvedEntities.push(
        matcher.unresolved(candidate.entity, candidate.provenance.sourceKey),
      );
      continue;
    }
    const existing = adapterCandidatesByEntity.get(entityKey) ?? [];
    existing.push(candidate);
    adapterCandidatesByEntity.set(entityKey, existing);
  }

  const overrideByEntity = new Map(
    assetOverrides.map((override) => [override.entityKey, override]),
  );
  const assets: BuiltAsset[] = [];
  for (const entityKey of new Set([
    ...adapterCandidatesByEntity.keys(),
    ...overrideByEntity.keys(),
  ])) {
    // Only what the product teaches is drawn into the bundle. A source still
    // describes the flag of every territory it knows, and the snapshots keep
    // it, so an entity that comes back into the pool gets its asset back on
    // the next build — but a release should not carry, sign and serve fifty
    // rasterized flags no card will ever ask for.
    const entity = byEntity.get(entityKey);
    if (entity === undefined || !isLearnable(entity)) {
      continue;
    }
    const adapters = adapterCandidatesByEntity.get(entityKey) ?? [];
    const override = overrideByEntity.get(entityKey);
    const bestAdapter = adapters.at(-1);
    const winner = override?.candidate ?? bestAdapter;
    if (winner === undefined) {
      continue;
    }
    if (override !== undefined) {
      reports.assetOverrides.push({
        entityKey,
        reason: override.reason,
        shadowedSourceKeys: [
          ...new Set(adapters.map(({ provenance }) => provenance.sourceKey)),
        ].sort(),
        shadowedSha256:
          bestAdapter === undefined
            ? null
            : sha256(bestAdapter.svg ?? bestAdapter.png ?? ""),
      });
    }
    try {
      assets.push(await buildAsset(outputDirectory, entityKey, winner));
    } catch (error) {
      reports.licenseProblems.push({
        entityKey,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const assetsByEntity = new Map(
    assets.map((asset) => [asset.entityKey, asset]),
  );

  for (const entity of byEntity.values()) {
    if (!isLearnable(entity)) {
      continue;
    }
    const names = entity.names as
      | Record<string, { short?: string }>
      | undefined;
    for (const locale of editorial.supportedLocales) {
      if (names?.[locale]?.short === undefined) {
        reports.missingTranslations.push({
          entityKey: String(entity.key),
          locale,
        });
      }
    }
    const asset = assetsByEntity.get(String(entity.key));
    if (asset === undefined) {
      reports.missingAssets.push({ entityKey: String(entity.key) });
    } else {
      entity.assetKeys = [asset.key];
    }
  }

  const relations = normalized
    .flatMap(({ relations }) => relations)
    .flatMap((candidate) => {
      const childKey = matcher.resolve(
        candidate.child,
        candidate.provenance.sourceKey,
      );
      const parentKey = candidate.parentKey;
      if (childKey === undefined || !byEntity.has(parentKey)) {
        if (childKey === undefined) {
          reports.unresolvedEntities.push(
            matcher.unresolved(candidate.child, candidate.provenance.sourceKey),
          );
        }
        return [];
      }
      provenanceMap[
        `relation/${parentKey}/${childKey}/${candidate.taxonomyKey}`
      ] = candidate.provenance;
      return [
        {
          parentKey,
          childKey,
          taxonomyKey: candidate.taxonomyKey,
          relationType: candidate.relationType,
          primary: candidate.primary,
        },
      ];
    });
  relations.push(...editorial.additionalRelations);
  for (const relation of editorial.additionalRelations) {
    provenanceMap[
      `relation/${relation.parentKey}/${relation.childKey}/${relation.taxonomyKey}`
    ] = editorialProvenance;
  }
  const uniqueRelations = [
    ...new Map(
      relations.map((relation) => [
        `${relation.parentKey}/${relation.childKey}/${relation.taxonomyKey}/${relation.relationType}`,
        relation,
      ]),
    ).values(),
  ];

  // The learnable pool: every entity that carries a card and facts, and
  // that a deck may hold. The listing toggle narrows only the
  // all-countries deck below it — never the pool (ADR-015).
  const learnableKeys = [...byEntity.values()]
    .filter(isLearnable)
    .map((entity) => String(entity.key))
    .sort();
  const currentKeys = [...byEntity.values()]
    .filter(
      (entity) =>
        isLearnable(entity) && entity.includeInCountryCatalog === true,
    )
    .map((entity) => String(entity.key))
    .sort();
  const decks = editorial.decks.map((deck) => ({
    key: deck.key,
    kind: deck.kind,
    names: deck.names,
    memberEntityKeys: deckMembers(
      deck,
      { allCurrent: currentKeys, learnable: learnableKeys },
      uniqueRelations,
    ),
  }));
  for (const deck of editorial.decks) {
    provenanceMap[`deck/${deck.key}`] = editorialProvenance;
  }

  const lexicon = Object.assign(
    {},
    ...normalized.map(({ lexicon }) => lexicon ?? {}),
  ) as SourceLexicon;

  // What each entity is declared not to have, as opposed to what the sources
  // failed to supply. Read once: it is asked for every fact type of every
  // learnable entity below.
  const notApplicableByEntity = new Map(
    editorial.entities.map((entity) => [
      entity.key,
      new Set(entity.config.factsNotApplicable ?? []),
    ]),
  );
  const factsWithValue = new Map<string, Set<string>>(
    learnableKeys.map((entityKey) => [entityKey, new Set<string>()]),
  );

  const facts = Object.fromEntries(
    FACT_TYPES.map((factType) => [
      factType,
      {
        schemaVersion: 1,
        factType,
        records: learnableKeys.map((entityKey) => {
          const entity = byEntity.get(entityKey);
          if (entity === undefined) {
            throw new Error(`Missing merged entity ${entityKey}`);
          }
          const value = (entity.facts as MutableRecord | undefined)?.[factType];
          const source = provenanceMap[`${entityKey}/facts.${factType}`];
          // Three outcomes, and the difference between them is the point.
          // A declared type is one the entity does not have; an empty value
          // is the source saying the same thing in its own way — Antarctica
          // arrives with `capitals: []`, which was published as a fact with
          // nothing in it and read on the card as a blank row (#272). Only a
          // value with something in it is a fact.
          if (notApplicableByEntity.get(entityKey)?.has(factType) === true) {
            return { entityKey, gap: true, reason: "not_applicable" };
          }
          if (value === undefined) {
            return { entityKey, gap: true, reason: "source_value_unavailable" };
          }
          if (isEmptyFactValue(value)) {
            return { entityKey, gap: true, reason: "not_applicable" };
          }
          factsWithValue.get(entityKey)?.add(factType);
          return {
            entityKey,
            gap: false,
            value: nameFactValue(
              factType,
              value,
              entity,
              lexicon,
              entityKey,
              editorial.supportedLocales,
              reports,
            ),
            provenance: source,
          };
        }),
      },
    ]),
  );

  // A card whose back has nothing on it teaches the flag and the name and
  // stops there. That is a decision, not an accident, so it has to be
  // declared: Antarctica shipped empty and nothing in the pipeline noticed
  // until someone opened the card (#272).
  for (const entityKey of learnableKeys) {
    if ((factsWithValue.get(entityKey)?.size ?? 0) > 0) {
      continue;
    }
    const declared = notApplicableByEntity.get(entityKey) ?? new Set<string>();
    const undeclared = FACT_TYPES.filter((factType) => !declared.has(factType));
    reports.factlessEntities.push({
      entityKey,
      undeclared,
      blocking: undeclared.length > 0,
    });
  }

  const catalogEntities = [...byEntity.values()]
    .map((entity) =>
      Object.fromEntries(
        Object.entries(entity).filter(
          ([key]) =>
            !["facts", "crossChecks", "identifiers", "localizedNames"].includes(
              key,
            ),
        ),
      ),
    )
    .sort((left, right) =>
      String(left.key).localeCompare(String(right.key), "en"),
    );

  return {
    catalog: {
      $schema: "../../../content/schemas/catalog.schema.json",
      schemaVersion: 1,
      catalogVersion,
      defaultLocale: editorial.defaultLocale,
      supportedLocales: [...editorial.supportedLocales].sort(),
      entities: catalogEntities,
      relations: uniqueRelations.sort((left, right) =>
        `${left.parentKey}/${left.childKey}/${left.taxonomyKey}`.localeCompare(
          `${right.parentKey}/${right.childKey}/${right.taxonomyKey}`,
          "en",
        ),
      ),
      decks,
    },
    facts,
    assets: assets.sort((left, right) =>
      left.key.localeCompare(right.key, "en"),
    ),
    provenance: Object.fromEntries(
      Object.entries(provenanceMap).sort(([left], [right]) =>
        left.localeCompare(right, "en"),
      ),
    ),
    reports,
    learnableEntityKeys: learnableKeys,
  };
}
