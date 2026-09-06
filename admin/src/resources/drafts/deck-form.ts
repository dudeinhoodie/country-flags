import type { UnsavedChange } from "../../components/ConflictDialog";
import { DEFAULT_TEMPLATE, templateOf } from "./deck-cards";
import type { DeckMembership } from "./DeckMembersEditor";
import type { DeckAccessValue } from "./DeckAccessEditor";
import type { DeckWriteBody, DraftDeckDetail } from "./useDraftDecks";

/**
 * The deck builder's form, apart from React.
 *
 * The same three questions as the entity editor's (§9) — is it dirty, what
 * does `Discard changes` restore, and what exactly would this editor have
 * written — answered once, by comparing what the form holds against what it
 * was loaded with.
 */

export interface LocalizedText {
  name: string;
  description: string;
}

export const DECK_LOCALES = ["ru", "en"] as const;

export interface DeckForm {
  key: string;
  kind: "curated" | "taxonomy";
  names: Record<string, LocalizedText>;
  membership: DeckMembership;
  access: DeckAccessValue;
}

export function emptyNames(): Record<string, LocalizedText> {
  return {
    ru: { name: "", description: "" },
    en: { name: "", description: "" },
  };
}

export function emptyDeckForm(): DeckForm {
  return {
    key: "",
    kind: "curated",
    names: emptyNames(),
    membership: {
      members: "all-current",
      defaults: {
        templateCode: DEFAULT_TEMPLATE.code,
        templateSchemaVersion: DEFAULT_TEMPLATE.schemaVersion,
      },
      previewCardIds: [],
    },
    access: { model: "FREE", requiredEntitlementKey: "" },
  };
}

export function formOf(deck: DraftDeckDetail): DeckForm {
  const template =
    templateOf(deck.defaultTemplateCode ?? "") ?? DEFAULT_TEMPLATE;
  return {
    key: deck.key,
    kind: deck.kind,
    names: { ...emptyNames(), ...deck.names },
    membership: {
      members: deck.members,
      defaults: {
        templateCode: template.code,
        templateSchemaVersion:
          deck.defaultTemplateSchemaVersion ?? template.schemaVersion,
      },
      previewCardIds: deck.previewCardIds ?? [],
    },
    access: {
      model: deck.access.model,
      requiredEntitlementKey: deck.access.requiredEntitlementKey ?? "",
    },
  };
}

/**
 * Every editable field, always present.
 *
 * A partial patch would make "unchanged" and "cleared" the same request, and
 * the deck's own fields are few enough to send whole. Creation adds the key,
 * which is the one field a saved deck can never change.
 */
export interface DeckPayload {
  kind: "curated" | "taxonomy";
  names: Record<string, LocalizedText>;
  members: DraftDeckDetail["members"];
  defaultTemplateCode: string;
  defaultTemplateSchemaVersion: number;
  access: NonNullable<DeckWriteBody["access"]>;
  previewCardIds: string[];
}

/** What the form would send, without the key: that is fixed at creation. */
export function payloadOf(form: DeckForm): DeckPayload {
  return {
    kind: form.kind,
    names: form.names,
    members: form.membership.members,
    defaultTemplateCode: form.membership.defaults.templateCode,
    defaultTemplateSchemaVersion:
      form.membership.defaults.templateSchemaVersion,
    access:
      form.access.model === "ENTITLEMENT"
        ? {
            model: "ENTITLEMENT",
            requiredEntitlementKey: form.access.requiredEntitlementKey.trim(),
          }
        : { model: "FREE" },
    previewCardIds: form.membership.previewCardIds,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameDeck(left: DeckForm, right: DeckForm): boolean {
  return (
    left.key === right.key &&
    canonical(payloadOf(left)) === canonical(payloadOf(right))
  );
}

const CHANGE_LABEL: Record<string, string> = {
  kind: "Kind",
  names: "Names and descriptions",
  members: "Members",
  defaultTemplateCode: "Default template",
  defaultTemplateSchemaVersion: "Default template version",
  access: "Access",
  previewCardIds: "Public preview",
};

export function deckChanges(
  baseline: DeckForm,
  current: DeckForm,
): UnsavedChange[] {
  const before = payloadOf(baseline) as unknown as Record<string, unknown>;
  const after = payloadOf(current) as unknown as Record<string, unknown>;
  const changes: UnsavedChange[] = [];
  for (const key of Object.keys(after)) {
    if (canonical(before[key]) === canonical(after[key])) {
      continue;
    }
    const value = after[key];
    changes.push({
      label: CHANGE_LABEL[key] ?? key,
      value:
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : JSON.stringify(value),
    });
  }
  return changes;
}
