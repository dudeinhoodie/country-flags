import { isDeepStrictEqual } from "node:util";

import { sha256 } from "@country-flags/asset-core";

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
 * classification places under it, at any depth, and only what the approved
 * catalogue still carries. Regions hold subregions and subregions hold
 * countries, so the walk is what turns "Europe" into the fifty-odd entities it
 * actually means — and it stays that as the catalogue changes, which a list
 * written by hand does not.
 *
 * Only `contains` is followed. The other relation an entity can carry says it
 * is associated with a region rather than part of it, and a deck built from
 * both would teach Russia twice.
 */
function deckMembers(
  deck: EditorialDeck,
  currentKeys: string[],
  relations: CatalogRelation[],
): string[] {
  if (deck.members === "all-current") {
    return currentKeys;
  }
  if (Array.isArray(deck.members)) {
    return [...deck.members].sort();
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

  const included = new Set(currentKeys);
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
      value.length === 1
        ? ((entity.localizedNames as MutableRecord | undefined)?.capitals as
            | Record<string, string>
            | undefined)
        : undefined;
    return value.map((seat) => {
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
    return value.map((entry) => {
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
      includeInCountryCatalog: entity.includeInCountryCatalog,
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
    if (entity.includeInCountryCatalog !== true) {
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

  const currentKeys = [...byEntity.values()]
    .filter(
      (entity) =>
        entity.includeInCountryCatalog === true && entity.status === "active",
    )
    .map((entity) => String(entity.key))
    .sort();
  const decks = editorial.decks.map((deck) => ({
    key: deck.key,
    kind: deck.kind,
    names: deck.names,
    memberEntityKeys: deckMembers(deck, currentKeys, uniqueRelations),
  }));
  for (const deck of editorial.decks) {
    provenanceMap[`deck/${deck.key}`] = editorialProvenance;
  }

  const lexicon = Object.assign(
    {},
    ...normalized.map(({ lexicon }) => lexicon ?? {}),
  ) as SourceLexicon;

  const facts = Object.fromEntries(
    ["capitals", "currencies", "languages", "population"].map((factType) => [
      factType,
      {
        schemaVersion: 1,
        factType,
        records: currentKeys.map((entityKey) => {
          const entity = byEntity.get(entityKey);
          if (entity === undefined) {
            throw new Error(`Missing merged entity ${entityKey}`);
          }
          const value = (entity.facts as MutableRecord | undefined)?.[factType];
          const source = provenanceMap[`${entityKey}/facts.${factType}`];
          return value === undefined
            ? {
                entityKey,
                gap: true,
                reason: "source_value_unavailable",
              }
            : {
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
  };
}
