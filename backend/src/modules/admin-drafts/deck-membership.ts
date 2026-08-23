import { HttpStatus } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";

export type DeckMembers = "all-current" | string[] | { taxonomy: string };

export interface EditorialDeck {
  key: string;
  kind: "curated" | "taxonomy";
  names: Record<string, { name: string; description: string }>;
  members: DeckMembers;
}

export interface EditorialEntity {
  key: string;
  status: string;
  includeInCountryCatalog: boolean;
}

export interface TaxonomyRelation {
  parentKey: string;
  childKey: string;
  relationType: string;
}

export interface MembershipContext {
  entities: EditorialEntity[];
  relations: TaxonomyRelation[];
}

export type MembersMode = "all-current" | "explicit" | "taxonomy";

export function membersMode(members: DeckMembers): MembersMode {
  if (members === "all-current") {
    return "all-current";
  }
  return Array.isArray(members) ? "explicit" : "taxonomy";
}

/**
 * The entities a deck can hold: approved and still current. Mirrors the
 * pipeline's `currentKeys` (tools/content-pipeline/src/merge.ts) exactly —
 * a preview that computed a different set would be a preview of nothing.
 */
export function currentEntityKeys(entities: EditorialEntity[]): string[] {
  return entities
    .filter(
      (entity) => entity.includeInCountryCatalog && entity.status === "active",
    )
    .map((entity) => entity.key)
    .sort();
}

function membershipError(code: string, message: string): never {
  throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

/**
 * Resolves who a deck holds, following the pipeline's rules: `all-current`
 * is the whole approved catalog, an explicit list is sorted (the build
 * sorts it too, so the stored order is editorial bookkeeping rather than
 * published order), and a taxonomy node means everything the classification
 * places under it at any depth. Only `contains` is walked: `associated_with`
 * says an entity is near a region, not part of it.
 */
export function resolveDeckMembers(
  deck: EditorialDeck,
  context: MembershipContext,
): string[] {
  const currentKeys = currentEntityKeys(context.entities);
  if (deck.members === "all-current") {
    return currentKeys;
  }
  if (Array.isArray(deck.members)) {
    return [...deck.members].sort();
  }

  const root = deck.members.taxonomy;
  const childrenByParent = new Map<string, string[]>();
  for (const relation of context.relations) {
    if (relation.relationType !== "contains") {
      continue;
    }
    const siblings = childrenByParent.get(relation.parentKey) ?? [];
    siblings.push(relation.childKey);
    childrenByParent.set(relation.parentKey, siblings);
  }
  if (!childrenByParent.has(root)) {
    membershipError(
      "DECK_TAXONOMY_EMPTY",
      `The deck is built from ${root}, which contains nothing in this catalog`,
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
    membershipError(
      "DECK_TAXONOMY_EMPTY",
      `The deck is built from ${root} and would hold no entity the catalog publishes`,
    );
  }
  return [...members].sort();
}

/**
 * Editorial rules the console must not let through, checked here rather
 * than only in the UI: a deck that fails these would break the next build.
 */
export function assertDeckIsSound(
  deck: EditorialDeck,
  context: MembershipContext,
  supportedLocales: string[],
): void {
  for (const locale of supportedLocales) {
    const localized = deck.names[locale];
    if (
      localized === undefined ||
      localized.name.trim().length === 0 ||
      localized.description.trim().length === 0
    ) {
      membershipError(
        "DECK_LOCALIZATION_MISSING",
        `The deck needs a name and description for every supported locale (missing: ${locale})`,
      );
    }
  }

  if (Array.isArray(deck.members)) {
    const seen = new Set<string>();
    const duplicates = deck.members.filter((key) => {
      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
      return false;
    });
    if (duplicates.length > 0) {
      membershipError(
        "DECK_MEMBER_DUPLICATE",
        `The deck lists the same entity more than once: ${[...new Set(duplicates)].join(", ")}`,
      );
    }
    const known = new Set(context.entities.map((entity) => entity.key));
    const unknown = deck.members.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      membershipError(
        "DECK_MEMBER_UNKNOWN",
        `The deck lists entities the catalog does not carry: ${unknown.join(", ")}`,
      );
    }
    if (deck.members.length === 0) {
      membershipError(
        "DECK_EMPTY",
        "An explicit deck must list at least one entity",
      );
    }
  }

  // Resolution itself is a validity check: a taxonomy node that holds
  // nothing publishable fails here rather than in the release build.
  resolveDeckMembers(deck, context);
}
