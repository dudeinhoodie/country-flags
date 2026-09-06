import { Injectable } from "@nestjs/common";
import { CardStatus, DeckStatus } from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  DeckAccessService,
  type DeckAccessSubject,
} from "../commerce/deck-access.service";

/**
 * What a published thing is worth showing to somebody who has bought nothing.
 *
 * - `PUBLIC` — the free catalog reaches it, so every caller may have it;
 * - `PUBLIC_PREVIEW` — only a locked deck reaches it, but an editor chose it
 *   as one of that deck's preview cards, which is a deliberate exception;
 * - `PAID_ONLY` — nothing a stranger may open reaches it.
 */
export type ContentVisibility = "PUBLIC" | "PUBLIC_PREVIEW" | "PAID_ONLY";

/** Whether the public projection may carry a thing with this visibility. */
export function isPubliclyVisible(visibility: ContentVisibility): boolean {
  return visibility !== "PAID_ONLY";
}

/**
 * One way a deck reaches a card, an asset or an entity: the deck itself, and
 * whether it reaches it through a card published as that deck's preview.
 *
 * Public because the admin console asks the same question about a draft,
 * where the decks are the ones an editor is writing rather than the ones the
 * release published. Building that list is the caller's job; deciding what it
 * means is this service's, and there is only one implementation of that.
 */
export interface DeckReach {
  deck: DeckAccessSubject;
  preview: boolean;
}

const DECK_ACCESS_SELECT = {
  id: true,
  accessModel: true,
  requiredEntitlementKey: true,
} as const;

/**
 * The one place that decides what the public half of the catalog contains.
 *
 * `GET /v1/entities/{id}`, the manifest and `GET /v1/content/changes` carry no
 * account context on purpose (ADR-019): they must be cacheable by anybody in
 * front of the service, and an answer that varied by bearer would eventually
 * be handed to the wrong reader. So they cannot ask "may *you* open this" —
 * they ask this service "may *anybody* open this", once, and publish only what
 * comes back public.
 *
 * It is not a second copy of the access rule. The question "is this material
 * public" is exactly the question "would a caller with no account at all be
 * allowed to open a deck that holds it", and that is put verbatim to
 * `DeckAccessService.isGranted(deck, null)` — the same method that guards
 * `GET /v1/decks/{id}/cards` and session creation. Nothing here reads a grant,
 * a feature flag or an entitlement key of its own.
 *
 * Reachability, not secrecy. A card that belongs to a free deck as well as a
 * paid one stays public, because buying a deck buys that deck's route and its
 * study flow — it does not make a country's flag a secret.
 */
@Injectable()
export class ContentAccessProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deckAccess: DeckAccessService,
  ) {}

  /**
   * The visibility of each of these assets, by the card that prompts with it.
   *
   * An asset no published deck reaches at all is withheld. The projection
   * publishes what is known to be free rather than what has not yet been
   * proved paid: artwork imported for a deck that has not been assembled yet
   * would otherwise be public for exactly as long as it takes to notice.
   */
  async assetVisibility(
    assetIds: string[],
  ): Promise<Map<string, ContentVisibility>> {
    if (assetIds.length === 0) {
      return new Map();
    }

    const wanted = new Set(assetIds);
    const memberships = await this.prisma.deckCard.findMany({
      where: {
        deck: { status: DeckStatus.PUBLISHED },
        learningCard: {
          status: CardStatus.ACTIVE,
          revisions: {
            some: { retiredAt: null, promptAssetId: { in: assetIds } },
          },
        },
      },
      select: {
        isPreview: true,
        deck: { select: DECK_ACCESS_SELECT },
        learningCard: {
          select: {
            // The revision the card is actually served with. A card that has
            // moved on to another drawing no longer reaches the old one, and
            // the old one must not inherit the card's deck for it.
            revisions: {
              where: { retiredAt: null },
              orderBy: { revision: "desc" },
              take: 1,
              select: { promptAssetId: true },
            },
          },
        },
      },
    });

    const reach = new Map<string, DeckReach[]>();
    for (const membership of memberships) {
      const assetId = membership.learningCard.revisions[0]?.promptAssetId;
      if (assetId === undefined || assetId === null || !wanted.has(assetId)) {
        continue;
      }
      this.record(reach, assetId, membership);
    }
    return this.visibilityByReach(assetIds, reach, "PAID_ONLY");
  }

  /**
   * The visibility of each of these learning cards, by the decks that hold it.
   *
   * A card in no published deck is withheld for the same reason an unreachable
   * asset is: no route serves it, so naming it can only tell a stranger that
   * it exists.
   */
  async cardVisibility(
    cardIds: string[],
  ): Promise<Map<string, ContentVisibility>> {
    if (cardIds.length === 0) {
      return new Map();
    }

    const memberships = await this.prisma.deckCard.findMany({
      where: {
        learningCardId: { in: cardIds },
        deck: { status: DeckStatus.PUBLISHED },
      },
      select: {
        learningCardId: true,
        isPreview: true,
        deck: { select: DECK_ACCESS_SELECT },
      },
    });

    const reach = new Map<string, DeckReach[]>();
    for (const membership of memberships) {
      this.record(reach, membership.learningCardId, membership);
    }
    return this.visibilityByReach(cardIds, reach, "PAID_ONLY");
  }

  /**
   * The visibility of each of these entities, by the decks that teach them.
   *
   * The fallback is the other way round here: an entity no card teaches is
   * public. A region, a subregion and a country's parent are structure rather
   * than merchandise — nothing sells them, the free client navigates by them,
   * and withholding them would close a door nobody was coming through. What
   * makes an entity paid-only is that every card naming it as its subject is,
   * which is how a U.S. state that only the paid deck teaches stays out of the
   * public projection while Germany — taught for free — stays in it whatever
   * else is hung off her.
   */
  async entityVisibility(
    entityIds: string[],
  ): Promise<Map<string, ContentVisibility>> {
    if (entityIds.length === 0) {
      return new Map();
    }

    const memberships = await this.prisma.deckCard.findMany({
      where: {
        deck: { status: DeckStatus.PUBLISHED },
        learningCard: {
          status: CardStatus.ACTIVE,
          subjectEntityId: { in: entityIds },
        },
      },
      select: {
        isPreview: true,
        deck: { select: DECK_ACCESS_SELECT },
        learningCard: { select: { subjectEntityId: true } },
      },
    });

    const reach = new Map<string, DeckReach[]>();
    for (const membership of memberships) {
      this.record(reach, membership.learningCard.subjectEntityId, membership);
    }
    return this.visibilityByReach(entityIds, reach, "PUBLIC");
  }

  private record(
    reach: Map<string, DeckReach[]>,
    resourceId: string,
    membership: { isPreview: boolean; deck: DeckAccessSubject },
  ): void {
    const reaches = reach.get(resourceId) ?? [];
    reaches.push({ deck: membership.deck, preview: membership.isPreview });
    reach.set(resourceId, reaches);
  }

  /**
   * The same verdict for a set of resources, each with the decks that reach
   * it and one answer for a resource nothing reaches.
   *
   * The fallback differs by what is being classified rather than by who is
   * asking — an unreachable drawing is withheld, an unreachable entity is
   * structure — so the caller states it and the rule stays here.
   */
  async visibilityByReach(
    resourceIds: string[],
    reach: Map<string, DeckReach[]>,
    unreached: ContentVisibility,
  ): Promise<Map<string, ContentVisibility>> {
    const visibility = new Map<string, ContentVisibility>();
    for (const resourceId of resourceIds) {
      const reaches = reach.get(resourceId);
      visibility.set(
        resourceId,
        reaches === undefined || reaches.length === 0
          ? unreached
          : await this.visibilityOf(reaches),
      );
    }
    return visibility;
  }

  /**
   * What one resource is worth showing to somebody who has bought nothing,
   * given every deck that reaches it.
   *
   * This is the whole policy, and it is deliberately the only copy of it:
   * the published projection reaches it through the queries above, and the
   * admin console reaches it with the decks a draft is about to publish
   * (ADR-019 §7.4). A second implementation would be a second answer.
   */
  async visibilityOf(reaches: DeckReach[]): Promise<ContentVisibility> {
    for (const { deck } of reaches) {
      // Asked of nobody in particular. `isGranted` answers a free deck without
      // touching the database and refuses an entitlement deck for an account
      // that is not there, so this is the access rule itself rather than a
      // paraphrase of it — and it costs no query.
      if (await this.deckAccess.isGranted(deck, null)) {
        return "PUBLIC";
      }
    }
    return reaches.some(({ preview }) => preview)
      ? "PUBLIC_PREVIEW"
      : "PAID_ONLY";
  }
}
