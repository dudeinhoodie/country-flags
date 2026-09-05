import type { components } from "../../api/generated/admin-api";
import type { DeckMembers } from "./useDraftDecks";

export interface CardRef {
  entityKey: string;
  templateCode: string;
  templateSchemaVersion: number;
}

export type DeckAccess = components["schemas"]["AdminDeckAccess"];
export type EntityType = components["schemas"]["AdminEntityType"];

export interface CardTemplate {
  code: string;
  schemaVersion: number;
  label: string;
  /** The drawing the prompt shows, or null for a template that needs none. */
  assetType: "FLAG" | "COAT_OF_ARMS" | null;
  subjectTypes: readonly EntityType[];
}

/** What a member with no template of its own teaches: the flag. */
export const DEFAULT_TEMPLATE: CardTemplate = {
  code: "FLAG_TO_COUNTRY",
  schemaVersion: 1,
  label: "Flag → name",
  assetType: "FLAG",
  subjectTypes: ["country", "territory", "area", "subdivision"],
};

/**
 * What the catalog builds today. The publisher owns the real registry, and
 * this list exists so the editor can refuse a template a subject cannot
 * carry before anybody saves — the same table the publish gate keeps.
 */
export const CARD_TEMPLATES: readonly CardTemplate[] = [
  DEFAULT_TEMPLATE,
  {
    code: "COAT_OF_ARMS_TO_COUNTRY",
    schemaVersion: 1,
    label: "Coat of arms → name",
    assetType: "COAT_OF_ARMS",
    subjectTypes: ["country", "territory", "area"],
  },
];

export function templateOf(code: string): CardTemplate | undefined {
  return CARD_TEMPLATES.find((template) => template.code === code);
}

export function templateLabel(code: string): string {
  return templateOf(code)?.label ?? code;
}

/**
 * One card variant written as a single string, the way the backend writes
 * it. Previews travel as these ids, and so does every list key in the
 * editor: a deck may hold Germany twice and a key of `country.germany`
 * would collide.
 */
export function cardIdentity(ref: CardRef): string {
  return `${ref.entityKey}#${ref.templateCode}@${String(ref.templateSchemaVersion)}`;
}

export interface DeckDefaults {
  templateCode: string;
  templateSchemaVersion: number;
}

/** A member as a card ref, with the deck's default template applied. */
export function memberRef(
  member: string | CardRef,
  defaults: DeckDefaults,
): CardRef {
  if (typeof member !== "string") {
    return member;
  }
  return {
    entityKey: member,
    templateCode: defaults.templateCode,
    templateSchemaVersion: defaults.templateSchemaVersion,
  };
}

/** The explicit members of a deck, in editorial order. */
export function membersToRefs(
  members: DeckMembers,
  defaults: DeckDefaults,
): CardRef[] {
  if (!Array.isArray(members)) {
    return [];
  }
  return members.map((member) => memberRef(member, defaults));
}

/**
 * Back to the wire shape. A member taught through the deck's own default is
 * written as a bare key, so a homogeneous deck stays readable and only a
 * mixed one spells its templates out.
 */
export function refsToMembers(
  refs: readonly CardRef[],
  defaults: DeckDefaults,
): (string | CardRef)[] {
  return refs.map((ref) =>
    ref.templateCode === defaults.templateCode &&
    ref.templateSchemaVersion === defaults.templateSchemaVersion
      ? ref.entityKey
      : ref,
  );
}

/**
 * The code a deck is served under, derived the way the release build derives
 * it (`backend/src/modules/content/bundle/bundle-mapper.ts`): `deck.europe`
 * is published as `EUROPE`. The console needs it to recognise a deck it is
 * looking at among the published ones.
 */
export function deckCodeFromKey(deckKey: string): string {
  const [, ...rest] = deckKey.split(".");
  return rest
    .join(".")
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "_");
}

/** An entitlement key as ADR-019 spells it: a namespace and a name. */
export const ENTITLEMENT_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

export function entitlementKeyProblem(key: string): string | null {
  if (key.trim().length === 0) {
    return "A paid deck needs the entitlement that opens it.";
  }
  if (!ENTITLEMENT_KEY_PATTERN.test(key)) {
    return "Write it as deck.european_coats — lower case, a namespace and a name.";
  }
  return null;
}
