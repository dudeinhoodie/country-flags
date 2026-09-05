import type {
  EditorialCatalog,
  EntityReference,
  FieldPatch,
  NormalizedSource,
  UnresolvedEntity,
} from "./types.js";

export interface EntityMatcher {
  resolve(
    reference: EntityReference,
    sourceKey?: UnresolvedEntity["sourceKey"],
  ): string | undefined;
  unresolved(
    reference: EntityReference,
    sourceKey: UnresolvedEntity["sourceKey"],
  ): UnresolvedEntity;
}

function referenceEntries(reference: EntityReference): [string, string][] {
  return Object.entries(reference).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
}

export function createMatcher(
  editorial: EditorialCatalog,
  normalizedSources: NormalizedSource[],
): EntityMatcher {
  const identifiers = new Map<string, string>();
  for (const entity of editorial.entities) {
    identifiers.set(`editorialKey:${entity.key}`, entity.key);
    for (const [kind, value] of referenceEntries(entity.identifiers ?? {})) {
      identifiers.set(`${kind}:${value}`, entity.key);
    }
  }

  const patches = normalizedSources.flatMap(({ patches }) => patches);
  let changed = true;
  while (changed) {
    changed = false;
    for (const patch of patches) {
      const key = resolveReference(identifiers, patch.entity);
      if (key === undefined) {
        continue;
      }
      if (
        [
          "codes.isoAlpha2",
          "codes.isoAlpha3",
          "codes.m49",
          "identifiers.wikidataId",
        ].includes(patch.path) &&
        typeof patch.value === "string"
      ) {
        const kind = patch.path.split(".").at(-1);
        if (kind !== undefined && !identifiers.has(`${kind}:${patch.value}`)) {
          identifiers.set(`${kind}:${patch.value}`, key);
          changed = true;
        }
      }
    }
  }

  return {
    resolve(reference, sourceKey) {
      const direct = resolveReference(identifiers, reference);
      if (direct !== undefined || sourceKey === undefined) {
        return direct;
      }
      for (const value of Object.values(reference)) {
        if (typeof value === "string") {
          const alias = editorial.sourceAliases[`${sourceKey}:${value}`];
          if (alias !== undefined) {
            return alias;
          }
        }
      }
      return undefined;
    },
    unresolved(reference, sourceKey) {
      const needle = Object.values(reference).find(
        (value): value is string => typeof value === "string",
      );
      const suggestedKeys =
        needle === undefined
          ? []
          : editorial.entities
              .map(({ key }) => ({
                key,
                score: similarity(needle.toLowerCase(), key.toLowerCase()),
              }))
              .filter(({ score }) => score >= 0.55)
              .sort((left, right) => right.score - left.score)
              .slice(0, 3)
              .map(({ key }) => key);
      return { sourceKey, reference, suggestedKeys };
    },
  };
}

function resolveReference(
  identifiers: Map<string, string>,
  reference: EntityReference,
): string | undefined {
  const matches = new Set(
    referenceEntries(reference)
      .map(([kind, value]) => identifiers.get(`${kind}:${value}`))
      .filter((value): value is string => value !== undefined),
  );
  return matches.size === 1 ? [...matches][0] : undefined;
}

function similarity(left: string, right: string): number {
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function levenshtein(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = row[0] ?? 0;
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const old = row[rightIndex] ?? 0;
      row[rightIndex] = Math.min(
        (row[rightIndex] ?? 0) + 1,
        (row[rightIndex - 1] ?? 0) + 1,
        previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      previous = old;
    }
  }
  return row[right.length] ?? 0;
}

export function editorialPatches(
  editorial: EditorialCatalog,
  source: FieldPatch["provenance"],
): FieldPatch[] {
  return editorial.entities.flatMap((entity) => [
    ...Object.entries(entity.overrides ?? {}).map(([path, value]) => ({
      entity: { editorialKey: entity.key },
      path,
      value,
      priority: 100,
      provenance: source,
    })),
    // A stated fact is a patch on the fact the sources supply, at the same
    // editorial priority as a name override — and it goes in by fact type
    // rather than by a path somebody typed, so it cannot land somewhere
    // nothing reads (#351).
    ...Object.entries(entity.facts ?? {}).map(([factType, value]) => ({
      entity: { editorialKey: entity.key },
      path: `facts.${factType}`,
      value,
      priority: 100,
      provenance: source,
    })),
  ]);
}
