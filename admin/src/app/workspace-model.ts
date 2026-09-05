import {
  DEFAULT_TEMPLATE,
  membersToRefs,
  templateOf,
} from "../resources/drafts/deck-cards";
import type { CardRef } from "../resources/drafts/deck-cards";
import type { components } from "../api/generated/admin-api";
import { routes } from "./routes";

type DraftSummary = components["schemas"]["AdminDraftSummary"];
type DraftDeck = components["schemas"]["AdminDraftDeck"];
type DraftEntity = components["schemas"]["AdminDraftEntityListItem"];
type DraftAsset = components["schemas"]["AdminDraftAsset"];
type ValidationReport = components["schemas"]["AdminValidationReport"];
type ReleaseRunState = components["schemas"]["AdminReleaseRunState"];

/**
 * What the Content workspace says, worked out from what the admin API
 * already answers.
 *
 * These are pure functions over whole-answer endpoints rather than a screen
 * full of requests: the aggregated read models the spec asks for (§12) are
 * #356, and until they land the browser composes the same picture from the
 * draft, its decks, its entities and its assets. Everything here is
 * derivable from those four; nothing is invented.
 */

// --- Lifecycle -------------------------------------------------------------

export type LifecycleStageId = "edit" | "validate" | "review" | "publish";

export interface LifecycleStep {
  id: LifecycleStageId;
  label: string;
  description: string;
  /** Passed already. */
  done: boolean;
  /** Where the draft stands now. */
  current: boolean;
  /** Where clicking the step goes. */
  href: string;
}

const STAGE_ORDER: readonly LifecycleStageId[] = [
  "edit",
  "validate",
  "review",
  "publish",
];

/** Which stage a draft status puts the editor in. */
export function stageOfStatus(status: string): LifecycleStageId {
  switch (status) {
    case "VALIDATING":
    case "FAILED":
      return "validate";
    case "READY":
      return "review";
    case "PROPOSED":
    case "MERGED":
      return "publish";
    default:
      return "edit";
  }
}

export function lifecycle(
  draft: Pick<DraftSummary, "id" | "status">,
): LifecycleStep[] {
  const current = stageOfStatus(draft.status);
  const currentIndex = STAGE_ORDER.indexOf(current);
  const copy: Record<
    LifecycleStageId,
    { label: string; description: string; href: string }
  > = {
    edit: {
      label: "Edit content",
      description: "Countries, decks and media",
      href: routes.draftEntities(draft.id),
    },
    validate: {
      label: "Validate",
      description: "Check for issues",
      href: routes.draftRelease(draft.id),
    },
    review: {
      label: "Review",
      description: "Diff and approval",
      href: routes.draftRelease(draft.id),
    },
    publish: {
      label: "Publish",
      description: "Release to clients",
      href: routes.draftRelease(draft.id),
    },
  };
  return STAGE_ORDER.map((id, index) => ({
    id,
    ...copy[id],
    done: draft.status === "MERGED" || index < currentIndex,
    current: draft.status !== "MERGED" && index === currentIndex,
  }));
}

// --- Work queue ------------------------------------------------------------

export type Readiness = "ready" | "warning" | "blocked" | "unresolved";

export interface WorkQueueItem {
  deckKey: string;
  name: string;
  /** How the deck picks its cards, in words. */
  membership: string;
  cardCount: number;
  /** Cards whose drawing is in the draft; null when nothing resolves here. */
  ready: number | null;
  /** 0–100, or null for a deck the browser cannot resolve. */
  completeness: number | null;
  missingFlags: number;
  missingCoats: number;
  /** Members the draft has no entity for at all. */
  unknownMembers: number;
  readiness: Readiness;
  href: string;
}

const MEMBERSHIP_LABEL: Record<string, string> = {
  "all-current": "All current countries",
  explicit: "Chosen cards",
  taxonomy: "Taxonomy node",
};

function deckName(deck: DraftDeck): string {
  return deck.names.ru?.name ?? deck.names.en?.name ?? deck.key;
}

/**
 * The cards a deck holds, as far as the browser can tell.
 *
 * `all-current` is the approved catalog, which the entity list carries, and
 * an explicit list carries itself. A taxonomy node is resolved server-side
 * at publish, so it comes back null rather than as a guess.
 */
function resolveMembers(
  deck: DraftDeck,
  entities: readonly DraftEntity[],
): CardRef[] | null {
  const defaults = {
    templateCode: deck.defaultTemplateCode ?? DEFAULT_TEMPLATE.code,
    templateSchemaVersion:
      deck.defaultTemplateSchemaVersion ?? DEFAULT_TEMPLATE.schemaVersion,
  };
  if (deck.membersMode === "explicit") {
    return membersToRefs(deck.members, defaults);
  }
  if (deck.membersMode === "all-current") {
    return entities
      .filter(
        (entity) =>
          entity.includeInCountryCatalog && entity.status === "active",
      )
      .map((entity) => ({ entityKey: entity.key, ...defaults }));
  }
  return null;
}

export function workQueue(
  draftId: string,
  decks: readonly DraftDeck[],
  entities: readonly DraftEntity[],
): WorkQueueItem[] {
  const byKey = new Map(entities.map((entity) => [entity.key, entity]));
  const items: WorkQueueItem[] = decks.map((deck): WorkQueueItem => {
    const members = resolveMembers(deck, entities);
    const base = {
      deckKey: deck.key,
      name: deckName(deck),
      membership: MEMBERSHIP_LABEL[deck.membersMode] ?? deck.membersMode,
      cardCount: deck.memberCount,
      href: routes.draftDeck(draftId, deck.key),
    };
    if (members === null) {
      return {
        ...base,
        ready: null,
        completeness: null,
        missingFlags: 0,
        missingCoats: 0,
        unknownMembers: 0,
        readiness: "unresolved",
      };
    }
    let missingFlags = 0;
    let missingCoats = 0;
    let unknownMembers = 0;
    for (const member of members) {
      const entity = byKey.get(member.entityKey);
      if (entity === undefined) {
        unknownMembers += 1;
        continue;
      }
      const needs = templateOf(member.templateCode)?.assetType ?? null;
      // `hasFlag` is optional in the contract: an answer that does not carry
      // it means "not known", which is not the same as "missing", and this
      // screen must not raise an alarm it cannot support.
      if (needs === "FLAG" && entity.hasFlag === false) {
        missingFlags += 1;
      }
      if (needs === "COAT_OF_ARMS" && entity.hasCoatOfArms === false) {
        missingCoats += 1;
      }
    }
    const total = members.length;
    const broken = missingFlags + missingCoats + unknownMembers;
    const ready = total - broken;
    return {
      ...base,
      cardCount: total,
      ready,
      completeness: total === 0 ? 100 : Math.round((ready / total) * 100),
      missingFlags,
      missingCoats,
      unknownMembers,
      readiness:
        broken === 0
          ? "ready"
          : missingFlags + unknownMembers > 0
            ? "blocked"
            : "warning",
    };
  });
  // The most broken deck first: the queue exists to be worked from the top.
  return items.sort(
    (left, right) => (left.completeness ?? 101) - (right.completeness ?? 101),
  );
}

// --- Needs attention -------------------------------------------------------

export interface NeedsAttention {
  total: number;
  decks: number;
  entities: number;
}

/**
 * How many objects an editor still has to touch: decks missing a drawing
 * some card needs, and catalog countries with no flag at all.
 */
export function needsAttention(
  queue: readonly WorkQueueItem[],
  entities: readonly DraftEntity[],
): NeedsAttention {
  const decks = queue.filter(
    (item) => item.readiness !== "ready" && item.readiness !== "unresolved",
  ).length;
  const broken = entities.filter(
    (entity) => entity.includeInCountryCatalog && entity.hasFlag === false,
  ).length;
  return { total: decks + broken, decks, entities: broken };
}

// --- Validation summary ----------------------------------------------------

export interface ValidationSummary {
  validatedAt: string | null;
  errors: number;
  warnings: number;
  /** Objects in the draft that no finding names. */
  passed: number;
  objects: number;
  issues: number;
}

export function validationSummary(
  report: ValidationReport | null,
  decks: readonly DraftDeck[],
  entities: readonly DraftEntity[],
): ValidationSummary {
  const objects = decks.length + entities.length;
  if (report === null) {
    return {
      validatedAt: null,
      errors: 0,
      warnings: 0,
      passed: 0,
      objects,
      issues: 0,
    };
  }
  const flagged = new Set(report.findings.map((finding) => finding.subject));
  return {
    validatedAt: report.validatedAt,
    errors: report.blocking,
    warnings: report.warnings,
    passed: Math.max(objects - flagged.size, 0),
    objects,
    issues: report.blocking + report.warnings,
  };
}

/**
 * Where a validation finding lives.
 *
 * A finding names its subject the way the catalog does — `deck.europe`,
 * `country.germany` — so the console can open the object rather than leave
 * the editor to find it (acceptance criterion: the dashboard opens a
 * specific validation issue). A stable route/field pointer on the finding
 * itself is #356; this is the prefix rule until then.
 */
export function findingHref(draftId: string, subject: string): string | null {
  if (subject.startsWith("deck.")) {
    return routes.draftDeck(draftId, subject);
  }
  if (/^[a-z]+\.[a-z0-9_.-]+$/u.test(subject)) {
    return routes.draftEntity(draftId, subject);
  }
  return null;
}

// --- Recent activity -------------------------------------------------------

export interface ActivityItem {
  id: string;
  kind: "edit" | "validation" | "upload" | "release";
  title: string;
  detail: string;
  at: string;
  href: string | null;
}

const ASSET_LABEL: Record<string, string> = {
  FLAG: "flag",
  COAT_OF_ARMS: "coat of arms",
  MAP: "map",
  OTHER: "asset",
};

/**
 * What happened lately, from the records the API already keeps.
 *
 * The audit log has no endpoint of its own yet (#356), so this reads the
 * timestamps the draft, its validation report, its uploads and the release
 * runs carry. Each entry links to where the change can be seen.
 */
export function recentActivity({
  draft,
  report,
  assets,
  releases,
  viewerId,
  limit = 5,
}: {
  draft: DraftSummary;
  report: ValidationReport | null;
  assets: readonly DraftAsset[];
  releases: ReleaseRunState | null;
  viewerId: string | null;
  limit?: number;
}): ActivityItem[] {
  const who = (adminUserId: string): string =>
    adminUserId === viewerId ? "You" : "Another editor";
  const items: ActivityItem[] = [
    {
      id: `draft-${draft.id}-${String(draft.revision)}`,
      kind: "edit",
      title: `${who(draft.updatedByAdminUserId)} edited the draft`,
      detail: `Revision ${String(draft.revision)}`,
      at: draft.updatedAt,
      href: routes.draftOverview(draft.id),
    },
  ];
  if (report !== null) {
    const issues = report.blocking + report.warnings;
    items.push({
      id: `validation-${report.validatedAt}`,
      kind: "validation",
      title: "Validation run completed",
      detail:
        issues === 0
          ? "Nothing blocking"
          : `${String(issues)} ${issues === 1 ? "issue" : "issues"} found`,
      at: report.validatedAt,
      href: routes.draftRelease(draft.id),
    });
  }
  for (const asset of [...assets]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)) {
    items.push({
      id: `asset-${asset.id}`,
      kind: "upload",
      title: `A ${ASSET_LABEL[asset.assetType] ?? "asset"} was uploaded`,
      detail: asset.entityContentKey,
      at: asset.updatedAt,
      href: routes.draftMedia(draft.id),
    });
  }
  for (const run of [releases?.current, releases?.last]) {
    if (run === undefined || run === null) {
      continue;
    }
    items.push({
      id: `run-${run.id}`,
      kind: "release",
      title: `${run.kind === "PUBLISH" ? "Publish" : "Rollback"} ${run.status.toLowerCase()}`,
      detail: run.contentVersion,
      at: run.finishedAt ?? run.startedAt ?? run.createdAt,
      href: routes.draftRelease(draft.id),
    });
  }
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, limit);
}
