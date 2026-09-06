import type { components } from "../../api/generated/admin-api";

type DraftDiff = components["schemas"]["AdminDraftDiff"];

/**
 * What a release would change, grouped the way a reviewer reads it (§9).
 *
 * A flat list of deck entries hides the one thing a reviewer is looking for:
 * a paid deck turning free is not the same kind of change as a renamed
 * description, and both arrive as strings on the same entry. The groups are
 * fixed by the spec — Entity, Asset, Card template, Membership, Presentation,
 * Access and Commerce — and each detail is filed under the one it belongs to.
 */

export const DIFF_GROUPS = [
  "entity",
  "asset",
  "template",
  "membership",
  "presentation",
  "access",
  "commerce",
] as const;

export type DiffGroupId = (typeof DIFF_GROUPS)[number];

export const DIFF_GROUP_LABEL: Record<DiffGroupId, string> = {
  entity: "Entity",
  asset: "Asset",
  template: "Card template",
  membership: "Membership",
  presentation: "Presentation",
  access: "Access",
  commerce: "Commerce",
};

/** How loudly a group should read: access and commerce take things away. */
export const DIFF_GROUP_NOTE: Record<DiffGroupId, string> = {
  entity: "Facts, identifiers and overrides the release would carry.",
  asset: "Drawings this draft replaces.",
  template: "What a deck's cards teach with.",
  membership: "Which cards a deck holds.",
  presentation: "Names, descriptions and what a locked deck shows.",
  access:
    "Who may open a deck. A deck that stops being free is taken away from everyone who has it.",
  commerce: "Which entitlement a purchase has to grant.",
};

export interface DiffLine {
  /** The object the change is about, as the reviewer would name it. */
  subject: string;
  detail: string;
  /** added, removed, changed — or null for an object-level entry. */
  change: string | null;
}

export interface DiffGroup {
  id: DiffGroupId;
  label: string;
  note: string;
  lines: DiffLine[];
}

/**
 * Which group a deck detail belongs to.
 *
 * The backend writes these as prose on purpose — they are for a human — so
 * the console files them by the phrase the writer chose. A detail nothing
 * recognises is filed under Membership rather than dropped: an ungrouped
 * change is one the reviewer never sees, which is the failure that matters.
 */
export function groupOfDeckDetail(detail: string): DiffGroupId {
  if (detail.startsWith("Card templates:")) {
    return "template";
  }
  if (detail.startsWith("Access:")) {
    return "access";
  }
  if (detail.startsWith("Entitlement:")) {
    return "commerce";
  }
  if (
    detail.startsWith("Name (") ||
    detail.startsWith("Description (") ||
    detail.startsWith("Localization ")
  ) {
    return "presentation";
  }
  return "membership";
}

function deckSubject(entry: DraftDiff["decks"][number]): string {
  return entry.deckKey ?? entry.publishedCode ?? "a deck";
}

export function groupDiff(diff: DraftDiff): DiffGroup[] {
  const lines: Record<DiffGroupId, DiffLine[]> = {
    entity: [],
    asset: [],
    template: [],
    membership: [],
    presentation: [],
    access: [],
    commerce: [],
  };

  for (const entry of diff.entities) {
    for (const detail of entry.details) {
      lines.entity.push({
        subject: entry.entityKey,
        detail,
        change: "changed",
      });
    }
  }

  for (const entry of diff.assets) {
    lines.asset.push({
      subject: `${entry.entityContentKey} · ${entry.assetType}`,
      detail: entry.reason ?? "Replaced in this draft",
      change: entry.change,
    });
  }

  for (const entry of diff.decks) {
    const subject = deckSubject(entry);
    if (entry.details.length === 0) {
      lines.membership.push({
        subject,
        detail: "No detail given",
        change: entry.change,
      });
      continue;
    }
    for (const detail of entry.details) {
      lines[groupOfDeckDetail(detail)].push({
        subject,
        detail,
        change: entry.change,
      });
    }
  }

  return DIFF_GROUPS.map((id) => ({
    id,
    label: DIFF_GROUP_LABEL[id],
    note: DIFF_GROUP_NOTE[id],
    lines: lines[id],
  })).filter((group) => group.lines.length > 0);
}
