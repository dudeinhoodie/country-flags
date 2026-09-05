import { HttpStatus } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";

/**
 * One card variant: an entity taught through a named template.
 *
 * A bare key takes the deck's default template. Germany under two templates
 * is two cards with two schedules, and a deck says which of them it holds
 * (ADR-020).
 */
export type DeckCardRef =
  | string
  | { entityKey: string; templateCode: string; templateSchemaVersion: number };

export type DeckMembers = "all-current" | DeckCardRef[] | { taxonomy: string };

export const DEFAULT_TEMPLATE_CODE = "FLAG_TO_COUNTRY";
export const DEFAULT_TEMPLATE_SCHEMA_VERSION = 1;

export interface EditorialDeckAccess {
  model: "FREE" | "ENTITLEMENT";
  requiredEntitlementKey?: string | null;
}

export interface EditorialDeck {
  key: string;
  kind: "curated" | "taxonomy";
  names: Record<string, { name: string; description: string }>;
  members: DeckMembers;
  defaultTemplateCode?: string;
  defaultTemplateSchemaVersion?: number;
  access?: EditorialDeckAccess;
  previewCards?: DeckCardRef[];
}

export interface EditorialEntity {
  key: string;
  type: string;
  status: string;
  config: { includeInCountryCatalog: boolean };
  parentKey?: string | null;
}

/** The entity a member is about, whichever way it was written. */
export function memberEntityKey(member: DeckCardRef): string {
  return typeof member === "string" ? member : member.entityKey;
}

/** The card variant a member stands for, with the deck's defaults applied. */
export function memberCardRef(
  deck: EditorialDeck,
  member: DeckCardRef,
): { entityKey: string; templateCode: string; templateSchemaVersion: number } {
  if (typeof member !== "string") {
    return member;
  }
  return {
    entityKey: member,
    templateCode: deck.defaultTemplateCode ?? DEFAULT_TEMPLATE_CODE,
    templateSchemaVersion:
      deck.defaultTemplateSchemaVersion ?? DEFAULT_TEMPLATE_SCHEMA_VERSION,
  };
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

const LEARNABLE_TYPES = new Set(["country", "territory", "area"]);

export function isLearnable(entity: EditorialEntity): boolean {
  return entity.status === "active" && LEARNABLE_TYPES.has(entity.type);
}

/**
 * The learnable pool: every entity that carries a card and facts, and that
 * a deck may hold. Mirrors the pipeline's `learnableKeys`
 * (tools/content-pipeline/src/merge.ts) exactly — a preview that computed
 * a different set would be a preview of nothing.
 */
export function learnableEntityKeys(entities: EditorialEntity[]): string[] {
  return entities
    .filter(isLearnable)
    .map((entity) => entity.key)
    .sort();
}

/**
 * The all-countries deck: the learnable pool narrowed by the listing
 * toggle. Nothing but `all-current` reads the toggle (ADR-015).
 */
export function currentEntityKeys(entities: EditorialEntity[]): string[] {
  return entities
    .filter(
      (entity) => isLearnable(entity) && entity.config.includeInCountryCatalog,
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
  if (deck.members === "all-current") {
    return currentEntityKeys(context.entities);
  }
  if (Array.isArray(deck.members)) {
    // Sorted, and by the entity a member is about: the build sorts an
    // explicit list the same way, and this preview would be a preview of
    // nothing if the two disagreed.
    return [...new Set(deck.members.map(memberEntityKey))].sort();
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

  // The taxonomy walk keeps every learnable entity: hiding one from the
  // all-countries deck must not pull it out of a regional deck (ADR-015).
  const included = new Set(learnableEntityKeys(context.entities));
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
    // Duplicated by card variant rather than by entity: a deck may teach
    // Germany's flag and Germany's coat of arms, and those are two
    // questions, not one country listed twice.
    const seen = new Set<string>();
    const duplicates = deck.members
      .map((member) => {
        const ref = memberCardRef(deck, member);
        return `${ref.entityKey}#${ref.templateCode}@${String(ref.templateSchemaVersion)}`;
      })
      .filter((key) => {
        if (seen.has(key)) {
          return true;
        }
        seen.add(key);
        return false;
      });
    if (duplicates.length > 0) {
      membershipError(
        "DECK_MEMBER_DUPLICATE",
        `The deck lists the same card more than once: ${[...new Set(duplicates)].join(", ")}`,
      );
    }
    const known = new Set(context.entities.map((entity) => entity.key));
    const unknown = deck.members
      .map((member) => memberEntityKey(member))
      .filter((key) => !known.has(key));
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
