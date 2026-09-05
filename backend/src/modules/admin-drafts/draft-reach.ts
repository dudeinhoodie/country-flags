import { DeckAccessModel } from "@prisma/client";

import type { DeckReach } from "../content/content-access-projection.service";
import {
  cardIdentity,
  promptAssetTypeOf,
  resolveDeckCards,
} from "./deck-cards";
import { previewCardIdsOf } from "./deck-cards";
import type { EditorialDeck, MembershipContext } from "./deck-membership";

/**
 * How a draft's decks reach the material an editor is looking at.
 *
 * The published projection asks the same question of `deck_cards`; a draft
 * has no such table yet, so the reaches are resolved from the editorial
 * document instead. Only reachability is computed here. What a set of reaches
 * *means* — public, previewed or paid-only — is decided in one place for the
 * whole system, `ContentAccessProjectionService.visibilityOf`, and this file
 * deliberately contains no copy of that rule (#356, ADR-019).
 *
 * The decks counted are every deck the draft holds, because every one of them
 * is what the next release will publish. That is the point of the screen: an
 * editor moving Germany's coat of arms out of the free deck must see it turn
 * paid-only before saving, not after the release.
 */

/** One card a deck holds, as the publisher would materialize it. */
export interface DraftDeckCard {
  deckKey: string;
  cardId: string;
  entityKey: string;
  templateCode: string;
  templateSchemaVersion: number;
  /** The drawing the template prompts with, when the template reads one. */
  assetType: string | null;
  isPreview: boolean;
  accessModel: "FREE" | "ENTITLEMENT";
  requiredEntitlementKey: string | null;
  sortOrder: number;
}

/** The reaches of a draft, grouped by what they reach. */
export interface DraftReachIndex {
  /** Every card every deck in the draft holds, deck by deck. */
  cards: DraftDeckCard[];
  /** Entity key → the decks that teach it. */
  byEntity: Map<string, DeckReach[]>;
  /** `entityKey#ASSET_TYPE` → the decks whose cards prompt with it. */
  byAssetSlot: Map<string, DeckReach[]>;
  /** Card identity → the decks that hold it. */
  byCard: Map<string, DeckReach[]>;
  /** Entity key → the cards that name it as their subject. */
  usageByEntity: Map<string, DraftDeckCard[]>;
}

/** The key an asset slot is reached under: one drawing of one entity. */
export function assetSlotKey(entityKey: string, assetType: string): string {
  return `${entityKey}#${assetType.toUpperCase()}`;
}

function accessOf(deck: EditorialDeck): {
  accessModel: "FREE" | "ENTITLEMENT";
  requiredEntitlementKey: string | null;
} {
  // Absent access is what the catalog writes for a free deck.
  const access = deck.access;
  return access === undefined || access.model === "FREE"
    ? { accessModel: "FREE", requiredEntitlementKey: null }
    : {
        accessModel: "ENTITLEMENT",
        requiredEntitlementKey: access.requiredEntitlementKey ?? null,
      };
}

/**
 * The access subject a draft deck stands for.
 *
 * `DeckAccessService.isGranted(deck, null)` reads the model and the
 * entitlement key and nothing else — never the id — so a deck that has no
 * database row yet can still be asked the real question rather than a
 * paraphrase of it. The key stands in for the id so a caller debugging a
 * reach sees which deck it came from.
 */
function subjectOf(deck: EditorialDeck): DeckReach["deck"] {
  const access = accessOf(deck);
  return {
    id: deck.key,
    accessModel:
      access.accessModel === "ENTITLEMENT"
        ? DeckAccessModel.ENTITLEMENT
        : DeckAccessModel.FREE,
    requiredEntitlementKey: access.requiredEntitlementKey,
  };
}

function push(
  reach: Map<string, DeckReach[]>,
  key: string,
  entry: DeckReach,
): void {
  const reaches = reach.get(key) ?? [];
  reaches.push(entry);
  reach.set(key, reaches);
}

/**
 * Every card the draft's decks resolve to, and what each of them reaches.
 *
 * A deck that cannot be resolved — a taxonomy node the active release does
 * not classify — contributes nothing rather than failing the read: the editor
 * has to be able to open the screen that shows them the mistake.
 */
export function indexDraftReach(
  decks: EditorialDeck[],
  context: MembershipContext,
): DraftReachIndex {
  const cards: DraftDeckCard[] = [];
  for (const deck of decks) {
    const access = accessOf(deck);
    const previews = new Set(previewCardIdsOf(deck));
    let resolved;
    try {
      resolved = resolveDeckCards(deck, context);
    } catch {
      continue;
    }
    for (const card of resolved) {
      cards.push({
        deckKey: deck.key,
        cardId: cardIdentity(card),
        entityKey: card.entityKey,
        templateCode: card.templateCode,
        templateSchemaVersion: card.templateSchemaVersion,
        assetType: card.assetType ?? promptAssetTypeOf(card.templateCode),
        isPreview: previews.has(cardIdentity(card)),
        accessModel: access.accessModel,
        requiredEntitlementKey: access.requiredEntitlementKey,
        sortOrder: card.sortOrder,
      });
    }
  }

  const subjects = new Map(decks.map((deck) => [deck.key, subjectOf(deck)]));
  const byEntity = new Map<string, DeckReach[]>();
  const byAssetSlot = new Map<string, DeckReach[]>();
  const byCard = new Map<string, DeckReach[]>();
  const usageByEntity = new Map<string, DraftDeckCard[]>();
  for (const card of cards) {
    const subject = subjects.get(card.deckKey);
    if (subject === undefined) {
      continue;
    }
    const reach: DeckReach = { deck: subject, preview: card.isPreview };
    push(byEntity, card.entityKey, reach);
    push(byCard, card.cardId, reach);
    if (card.assetType !== null) {
      push(byAssetSlot, assetSlotKey(card.entityKey, card.assetType), reach);
    }
    const usages = usageByEntity.get(card.entityKey) ?? [];
    usages.push(card);
    usageByEntity.set(card.entityKey, usages);
  }

  return { cards, byEntity, byAssetSlot, byCard, usageByEntity };
}
