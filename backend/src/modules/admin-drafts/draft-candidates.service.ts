import { Injectable } from "@nestjs/common";

import { CARD_TEMPLATES, cardIdentity } from "./deck-cards";
import { DEFAULT_TEMPLATE_SCHEMA_VERSION } from "./deck-membership";
import type { EditorialDeck } from "./deck-membership";
import {
  DraftReadModelService,
  isSourcedAssetType,
  promptAssetTypeEnum,
} from "./draft-read-model.service";
import type {
  DeliveryStatus,
  DraftContext,
  LocaleCompleteness,
} from "./draft-read-model.service";

/**
 * Why a card cannot be added to a deck, in words an editor can act on.
 *
 * The deck builder greys a row out; the reason is what turns that into
 * instructions ("upload a coat of arms", "give it a Russian name") rather
 * than a dead end (docs/19-admin-redesign.md §8.2).
 */
export interface CandidateDisabledReason {
  code:
    | "ENTITY_NOT_ACTIVE"
    | "ASSET_MISSING"
    | "LOCALE_NAME_MISSING"
    | "ALREADY_IN_DECK";
  message: string;
}

export interface CardCandidate {
  cardId: string;
  entityKey: string;
  entityType: string;
  entityStatus: string;
  parentKey: string | null;
  entityName: string | null;
  templateCode: string;
  templateSchemaVersion: number;
  /** The drawing the template prompts with, as the upload form names it. */
  assetType: string | null;
  hasAsset: boolean;
  locales: LocaleCompleteness;
  /**
   * What the card is delivered as today, or null for a pair no deck holds
   * yet: an answer about a card that does not exist would be a verdict
   * about nothing.
   */
  delivery: DeliveryStatus | null;
  inDeck: boolean;
  available: boolean;
  disabledReason: CandidateDisabledReason | null;
}

/** One page of the card library, and how much the filters matched. */
export interface CardCandidatePage {
  items: CardCandidate[];
  total: number;
  draftRevision: number;
}

/** How the card library is narrowed, all of it server-side. */
export interface CardCandidateFilter {
  search?: string | undefined;
  entityType?: string | undefined;
  parentKey?: string | undefined;
  assetType?: string | undefined;
  templateCode?: string | undefined;
  locale?: string | undefined;
  /** `ready` keeps only what can be added; `blocked` keeps only what cannot. */
  readiness?: "any" | "ready" | "blocked" | undefined;
  /** The deck being built, so a member it already holds is marked. */
  deckKey?: string | undefined;
  offset: number;
  limit: number;
}

/**
 * The deck builder's card library.
 *
 * A candidate is a pair — an entity and a template that can teach it — not
 * an entity, because Germany's flag and Germany's coat of arms are two cards
 * with two schedules (ADR-020). The whole cross product is a few hundred
 * rows, and it is built and filtered here rather than in the browser: the
 * console must not have to know which template needs which drawing, which is
 * the same rule the publish gate applies (#356).
 */
@Injectable()
export class DraftCandidatesService {
  constructor(private readonly readModel: DraftReadModelService) {}

  async search(
    draftId: string,
    filter: CardCandidateFilter,
  ): Promise<CardCandidatePage> {
    const context = await this.readModel.context(draftId);
    const deck =
      filter.deckKey === undefined
        ? undefined
        : context.catalog.decks.find((entry) => entry.key === filter.deckKey);
    const held = new Set(
      context.reach.cards
        .filter((card) => card.deckKey === filter.deckKey)
        .map((card) => card.cardId),
    );

    const candidates = this.candidates(context, held, deck, filter.locale);
    const delivery = await this.readModel.cardDelivery(
      candidates
        .filter((candidate) => context.reach.byCard.has(candidate.cardId))
        .map((candidate) => candidate.cardId),
      context.reach,
    );
    const rows = candidates.map((candidate) => ({
      ...candidate,
      delivery: delivery.get(candidate.cardId) ?? null,
    }));
    const matched = rows.filter((row) => matchesCandidate(row, filter));
    return {
      items: matched.slice(filter.offset, filter.offset + filter.limit),
      total: matched.length,
      draftRevision: context.draft.revision,
    };
  }

  /**
   * Every card the catalog could build, and why it could not.
   *
   * The pairs come from the template table rather than from a list of
   * entities: a template declares the kinds of subject it teaches, so a
   * region produces no rows at all. Offering a permanently disabled row
   * would be offering an editor something that can never become possible.
   */
  private candidates(
    context: DraftContext,
    held: Set<string>,
    deck: EditorialDeck | undefined,
    locale: string | undefined,
  ): Omit<CardCandidate, "delivery">[] {
    const schemaVersion =
      deck?.defaultTemplateSchemaVersion ?? DEFAULT_TEMPLATE_SCHEMA_VERSION;
    const uploaded = new Set(
      context.draftAssets.map(
        (asset) => `${asset.entityContentKey}#${asset.assetType}`,
      ),
    );
    const rows: Omit<CardCandidate, "delivery">[] = [];
    for (const entity of context.catalog.entities) {
      const published = context.published.get(entity.key);
      const locales = this.readModel.entityLocales(
        entity,
        context.catalog.supportedLocales,
        published,
      );
      for (const [templateCode, template] of Object.entries(CARD_TEMPLATES)) {
        if (!template.subjectTypes.includes(entity.type)) {
          continue;
        }
        const wanted = promptAssetTypeEnum(templateCode);
        const hasAsset =
          wanted === null ||
          isSourcedAssetType(wanted) ||
          uploaded.has(`${entity.key}#${wanted}`) ||
          (published?.assetTypes.has(wanted) ?? false);
        const cardId = cardIdentity({
          entityKey: entity.key,
          templateCode,
          templateSchemaVersion: schemaVersion,
        });
        const inDeck = held.has(cardId);
        const partial = {
          cardId,
          entityKey: entity.key,
          entityType: entity.type,
          entityStatus: entity.status,
          parentKey: entity.parentKey ?? null,
          entityName:
            published?.names.get("en") ??
            [...(published?.names.values() ?? [])][0] ??
            null,
          templateCode,
          templateSchemaVersion: schemaVersion,
          assetType: wanted,
          hasAsset,
          locales,
          inDeck,
        };
        const reason = refusalFor(partial, locale);
        rows.push({
          ...partial,
          available: reason === null,
          disabledReason: reason,
        });
      }
    }
    return rows;
  }
}

/**
 * The first thing that stops a card from being added, if anything does.
 *
 * The locale is part of the question rather than a property of the card: the
 * same pair is ready for an English deck and not for a Russian one, so the
 * reason is computed against the locale the caller asked about.
 */
function refusalFor(
  candidate: {
    entityKey: string;
    entityStatus: string;
    assetType: string | null;
    hasAsset: boolean;
    locales: LocaleCompleteness;
    inDeck: boolean;
  },
  locale: string | undefined,
): CandidateDisabledReason | null {
  if (candidate.inDeck) {
    return {
      code: "ALREADY_IN_DECK",
      message: "The deck already holds this card",
    };
  }
  if (candidate.entityStatus !== "active") {
    return {
      code: "ENTITY_NOT_ACTIVE",
      message: `${candidate.entityKey} is ${candidate.entityStatus}, so no release builds a card for it`,
    };
  }
  if (!candidate.hasAsset && candidate.assetType !== null) {
    return {
      code: "ASSET_MISSING",
      message: `${candidate.entityKey} has no ${candidate.assetType.toLowerCase()}; upload one before this card can be taught`,
    };
  }
  if (locale !== undefined && !candidate.locales.present.includes(locale)) {
    return {
      code: "LOCALE_NAME_MISSING",
      message: `${candidate.entityKey} has no name in ${locale}`,
    };
  }
  return null;
}

function matchesCandidate(
  candidate: CardCandidate,
  filter: CardCandidateFilter,
): boolean {
  if (filter.search !== undefined) {
    const haystack = `${candidate.entityKey} ${candidate.entityName ?? ""}`;
    if (!haystack.toLowerCase().includes(filter.search.toLowerCase())) {
      return false;
    }
  }
  if (
    filter.entityType !== undefined &&
    candidate.entityType !== filter.entityType
  ) {
    return false;
  }
  if (
    filter.parentKey !== undefined &&
    candidate.parentKey !== filter.parentKey
  ) {
    return false;
  }
  if (
    filter.assetType !== undefined &&
    candidate.assetType !== filter.assetType
  ) {
    return false;
  }
  if (
    filter.templateCode !== undefined &&
    candidate.templateCode !== filter.templateCode
  ) {
    return false;
  }
  if (filter.readiness === "ready" && !candidate.available) {
    return false;
  }
  if (filter.readiness === "blocked" && candidate.available) {
    return false;
  }
  return true;
}
