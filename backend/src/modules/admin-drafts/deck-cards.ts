import { HttpStatus } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import {
  currentEntityKeys,
  DEFAULT_TEMPLATE_CODE,
  DEFAULT_TEMPLATE_SCHEMA_VERSION,
  memberCardRef,
  resolveDeckMembers,
} from "./deck-membership";
import type {
  DeckCardRef,
  EditorialDeck,
  EditorialDeckAccess,
  MembershipContext,
} from "./deck-membership";

/**
 * What each card template asks about and what it needs to draw.
 *
 * The same table the publish gate keeps (`draft-validation.service.ts`): the
 * editor must not offer a template a subject cannot carry, and it must be
 * able to say which drawing a member will need before anybody saves.
 */
export const CARD_TEMPLATES: Record<
  string,
  { promptAssetType: "FLAG" | "COAT_OF_ARMS"; subjectTypes: readonly string[] }
> = {
  FLAG_TO_COUNTRY: {
    promptAssetType: "FLAG",
    subjectTypes: ["country", "territory", "area", "subdivision"],
  },
  COAT_OF_ARMS_TO_COUNTRY: {
    promptAssetType: "COAT_OF_ARMS",
    subjectTypes: ["country", "territory", "area"],
  },
};

/** The entitlement key shape ADR-019 fixed: a namespace and a name. */
const ENTITLEMENT_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

const MAX_PREVIEW_CARDS = 3;

export interface ResolvedDeckCard {
  learningCardId: string | null;
  entityKey: string;
  templateCode: string;
  templateSchemaVersion: number;
  assetType: string | null;
  sortOrder: number;
}

function deckError(code: string, message: string): never {
  throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

/**
 * One card variant written as a single string.
 *
 * The admin contract carries previews as ids rather than as refs, and the
 * console needs a name for a member that survives a pair the release has
 * never built. This is that name, spelled exactly the way the publish gate
 * spells it so the two can be read side by side.
 */
export function cardIdentity(ref: {
  entityKey: string;
  templateCode: string;
  templateSchemaVersion: number;
}): string {
  return `${ref.entityKey}#${ref.templateCode}@${String(ref.templateSchemaVersion)}`;
}

/** The drawing a template reads, or null for a template that needs none. */
export function promptAssetTypeOf(templateCode: string): string | null {
  return CARD_TEMPLATES[templateCode]?.promptAssetType ?? null;
}

/**
 * The members as the publisher would materialize them, in editorial order.
 *
 * An explicit list keeps the order the editor set — that order is the deck's
 * `sortOrder` — while a derived membership has no editorial order of its own
 * and is listed the way the build sorts it.
 */
export function resolveDeckCards(
  deck: EditorialDeck,
  context: MembershipContext,
): ResolvedDeckCard[] {
  const refs: DeckCardRef[] = Array.isArray(deck.members)
    ? deck.members
    : deck.members === "all-current"
      ? currentEntityKeys(context.entities)
      : resolveDeckMembers(deck, context);
  return refs.map((member, index) => {
    const ref = memberCardRef(deck, member);
    return {
      learningCardId: null,
      entityKey: ref.entityKey,
      templateCode: ref.templateCode,
      templateSchemaVersion: ref.templateSchemaVersion,
      assetType: promptAssetTypeOf(ref.templateCode),
      sortOrder: index,
    };
  });
}

/** The previews as ids, with the deck's default template applied. */
export function previewCardIdsOf(deck: EditorialDeck): string[] {
  return (deck.previewCards ?? []).map((preview) =>
    cardIdentity(memberCardRef(deck, preview)),
  );
}

/**
 * Turns the ids the console sends back into the refs the catalog stores.
 *
 * A preview is written the way its member is written: a deck of bare keys
 * keeps bare keys, so a preview never makes the document read as if it held
 * something the members do not.
 */
export function previewCardsFromIds(
  deck: EditorialDeck,
  ids: string[],
): DeckCardRef[] {
  const membersById = new Map<string, DeckCardRef>();
  if (Array.isArray(deck.members)) {
    for (const member of deck.members) {
      membersById.set(cardIdentity(memberCardRef(deck, member)), member);
    }
  }
  return ids.map((id) => {
    const member = membersById.get(id);
    if (member !== undefined) {
      return member;
    }
    const parsed = parseCardIdentity(id);
    if (parsed === null) {
      deckError(
        "DECK_PREVIEW_UNREADABLE",
        `${id} does not name a card; a preview is written entity#TEMPLATE@version`,
      );
    }
    return parsed;
  });
}

function parseCardIdentity(id: string): DeckCardRef | null {
  const match = /^(.+)#([A-Z][A-Z0-9_]*)@([0-9]+)$/.exec(id);
  if (match === null) {
    return null;
  }
  return {
    entityKey: match[1]!,
    templateCode: match[2]!,
    templateSchemaVersion: Number(match[3]),
  };
}

/**
 * Whether the deck says something v2 cannot express. A catalog of nothing
 * but bare country keys stays in the version it was written in; the first
 * deck that names a template, an access model or a preview moves it on.
 */
export function deckNeedsV3(deck: EditorialDeck): boolean {
  return (
    deck.defaultTemplateCode !== undefined ||
    deck.defaultTemplateSchemaVersion !== undefined ||
    deck.access !== undefined ||
    deck.previewCards !== undefined ||
    (Array.isArray(deck.members) &&
      deck.members.some((member) => typeof member !== "string"))
  );
}

/**
 * The default template a v3 deck must carry.
 *
 * The editorial schema requires it of anything that lists bare keys or names
 * a taxonomy node, and a deck of explicit refs is clearer with it than
 * without: the console shows what an added member would be taught through.
 */
export function withDeckDefaults(deck: EditorialDeck): EditorialDeck {
  if (!deckNeedsV3(deck)) {
    return deck;
  }
  return {
    ...deck,
    defaultTemplateCode: deck.defaultTemplateCode ?? DEFAULT_TEMPLATE_CODE,
    defaultTemplateSchemaVersion:
      deck.defaultTemplateSchemaVersion ?? DEFAULT_TEMPLATE_SCHEMA_VERSION,
  };
}

/**
 * What the console must not be able to store, checked on the write path so
 * a wrong click is refused while the editor is still open rather than at
 * the publish gate three screens later.
 */
export function assertDeckCardsAreSound(
  deck: EditorialDeck,
  context: MembershipContext,
): void {
  const entityTypes = new Map(
    context.entities.map((entity) => [entity.key, entity.type]),
  );

  for (const member of Array.isArray(deck.members) ? deck.members : []) {
    const ref = memberCardRef(deck, member);
    const template = CARD_TEMPLATES[ref.templateCode];
    if (template === undefined) {
      deckError(
        "DECK_TEMPLATE_UNKNOWN",
        `${ref.templateCode} is not a card template this catalog builds`,
      );
    }
    const type = entityTypes.get(ref.entityKey);
    if (type !== undefined && !template.subjectTypes.includes(type)) {
      deckError(
        "DECK_TEMPLATE_SUBJECT_UNSUPPORTED",
        `${ref.templateCode} does not teach a ${type}; ${ref.entityKey} cannot carry that card`,
      );
    }
  }

  assertDeckAccessIsSound(deck);
  assertDeckPreviewsAreSound(deck);
}

function assertDeckAccessIsSound(deck: EditorialDeck): void {
  const access = deck.access;
  if (access === undefined) {
    return;
  }
  const key = access.requiredEntitlementKey ?? null;
  if (access.model === "ENTITLEMENT") {
    if (key === null || key.trim().length === 0) {
      deckError(
        "DECK_ACCESS_ENTITLEMENT_MISSING",
        "A paid deck needs the entitlement that opens it",
      );
    }
    if (!ENTITLEMENT_KEY_PATTERN.test(key)) {
      deckError(
        "DECK_ACCESS_ENTITLEMENT_INVALID",
        `${key} is not an entitlement key; write it as deck.european_coats`,
      );
    }
    return;
  }
  if (key !== null && key.trim().length > 0) {
    deckError(
      "DECK_ACCESS_ENTITLEMENT_UNUSED",
      "A free deck must not name an entitlement",
    );
  }
}

function assertDeckPreviewsAreSound(deck: EditorialDeck): void {
  const previews = deck.previewCards ?? [];
  if (previews.length === 0) {
    return;
  }
  if (previews.length > MAX_PREVIEW_CARDS) {
    deckError(
      "DECK_PREVIEW_TOO_MANY",
      `A deck may show at most ${String(MAX_PREVIEW_CARDS)} cards before it is bought`,
    );
  }
  const held = new Set(
    (Array.isArray(deck.members) ? deck.members : []).map((member) =>
      cardIdentity(memberCardRef(deck, member)),
    ),
  );
  const seen = new Set<string>();
  for (const preview of previews) {
    const identity = cardIdentity(memberCardRef(deck, preview));
    if (seen.has(identity)) {
      deckError(
        "DECK_PREVIEW_DUPLICATE",
        `The deck previews ${identity} twice`,
      );
    }
    seen.add(identity);
    // Only an explicit list can be checked here: a derived membership is
    // whatever the catalog resolves to, and the publish gate checks that
    // against the release it is about to build.
    if (Array.isArray(deck.members) && !held.has(identity)) {
      deckError(
        "DECK_PREVIEW_NOT_MEMBER",
        `The deck previews ${identity}, which it does not hold`,
      );
    }
  }
}

/**
 * What a published deck's access may become.
 *
 * Taking access away from somebody who already has the deck is the one
 * editorial mistake publishing again cannot undo, so it is refused where the
 * click happens. Widening access is allowed and only warned about at the
 * gate: nobody loses a deck by it (ADR-019). A deck the release never
 * carried is not published yet and may be anything.
 */
export function assertAccessChangeIsAllowed(
  deckKey: string,
  published: EditorialDeckAccess | undefined,
  next: EditorialDeckAccess | undefined,
): void {
  if (published === undefined) {
    return;
  }
  const before = published.model;
  const after = next?.model ?? "FREE";
  if (before === "FREE" && after === "ENTITLEMENT") {
    deckError(
      "DECK_ACCESS_TIGHTENED",
      `${deckKey} is published free; making it paid would take it away from everyone who has it. Publish a new deck, or run an approved entitlement migration`,
    );
  }
  const publishedKey = published.requiredEntitlementKey ?? null;
  if (
    before === "ENTITLEMENT" &&
    after === "ENTITLEMENT" &&
    publishedKey !== null &&
    (next?.requiredEntitlementKey ?? null) !== publishedKey
  ) {
    deckError(
      "DECK_ENTITLEMENT_CHANGED",
      `${deckKey} is published against ${publishedKey}; changing the entitlement is a migration, not an edit`,
    );
  }
}
