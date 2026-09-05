import { HttpStatus, Injectable } from "@nestjs/common";
import {
  CommerceOfferStatus,
  DeckAccessModel,
  EntitlementGrantStatus,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";

/**
 * What a deck stores about who may open it. Nothing else is needed to
 * decide — not the kind, not the card count, not a feature flag.
 */
export interface DeckAccessSubject {
  id: string;
  accessModel: DeckAccessModel;
  requiredEntitlementKey: string | null;
}

/**
 * What a client is told about who may open it. A price never appears: the
 * store owns what a thing costs, and the price takes no part in deciding
 * what an account may read.
 */
export interface DeckAccessPolicy {
  model: DeckAccessModel;
  requiredEntitlementKey?: string;
  offerCodes?: string[];
}

/**
 * The part of the database this service reads, so the same code answers on a
 * connection and inside somebody else's transaction. A session is created
 * serializably, and the right to create it has to be read in that same
 * snapshot — otherwise a refund committed mid-transaction would decide the
 * question after it was asked.
 */
export type DeckAccessReader = Pick<
  PrismaService,
  "userEntitlementGrant" | "commerceOfferGrant"
>;

/**
 * The one place the rule lives:
 *
 *     access = FREE  OR  an ACTIVE UserEntitlementGrant of the deck's
 *                        requiredEntitlementKey
 *
 * Every route that hands out a paid deck's content asks this service and
 * nothing else. Scattered `if paid` checks in controllers are forbidden by
 * the specification for a reason worth restating: there is no way to audit a
 * rule that is written in six places, and the sixth is always the one that
 * forgot the revoked grant.
 *
 * What it deliberately does not guard:
 *
 * - deck metadata. A locked deck must be discoverable, or nobody learns it
 *   exists to buy it;
 * - review and progress sync. The right to open a deck and the right to keep
 *   your own history are different things, and a refund takes only the first;
 * - a card that also belongs to a free deck. The guard protects the paid
 *   deck's route, not a globally secret country.
 */
@Injectable()
export class DeckAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Answers the canonical question. Anonymous callers reach free decks and
   * nothing else: there is no account to hold a grant.
   */
  async isGranted(
    deck: DeckAccessSubject,
    userId: string | null,
    reader: DeckAccessReader = this.prisma,
  ): Promise<boolean> {
    if (deck.accessModel === DeckAccessModel.FREE) {
      return true;
    }
    const entitlementKey = deck.requiredEntitlementKey;
    // An entitlement deck naming no entitlement names a right nobody can
    // hold. A check constraint keeps the row out of the database; if one
    // appears anyway the guard refuses it rather than reading the absence
    // as "free".
    if (entitlementKey === null || userId === null) {
      return false;
    }

    const grant = await reader.userEntitlementGrant.findFirst({
      where: {
        userId,
        entitlementKey,
        status: EntitlementGrantStatus.ACTIVE,
      },
      select: { id: true },
    });
    return grant !== null;
  }

  /**
   * The same question, thrown rather than returned. The 403 names the deck
   * and the offers that grant it so a client can go and buy one; it carries
   * no price, and it says nothing about the account.
   */
  async requireAccess(
    deck: DeckAccessSubject,
    userId: string | null,
    reader: DeckAccessReader = this.prisma,
  ): Promise<void> {
    if (await this.isGranted(deck, userId, reader)) {
      return;
    }

    const offerCodes = await this.offerCodesByEntitlement(
      deck.requiredEntitlementKey === null ? [] : [deck.requiredEntitlementKey],
      reader,
    );
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      "ENTITLEMENT_REQUIRED",
      "This deck requires a purchase",
      {
        deckId: deck.id,
        offerCodes:
          deck.requiredEntitlementKey === null
            ? []
            : (offerCodes.get(deck.requiredEntitlementKey) ?? []),
      },
    );
  }

  /**
   * The access policy of a page of decks, in one round trip rather than one
   * per deck. Published to everybody: the catalog is how a locked deck is
   * discovered, and what a deck costs to open is not a secret.
   */
  async policiesFor(
    decks: DeckAccessSubject[],
    reader: DeckAccessReader = this.prisma,
  ): Promise<Map<string, DeckAccessPolicy>> {
    const entitlementKeys = [
      ...new Set(
        decks.flatMap((deck) =>
          deck.accessModel === DeckAccessModel.ENTITLEMENT &&
          deck.requiredEntitlementKey !== null
            ? [deck.requiredEntitlementKey]
            : [],
        ),
      ),
    ];
    const offerCodes = await this.offerCodesByEntitlement(
      entitlementKeys,
      reader,
    );

    return new Map(
      decks.map((deck) => [
        deck.id,
        deck.accessModel === DeckAccessModel.ENTITLEMENT &&
        deck.requiredEntitlementKey !== null
          ? {
              model: DeckAccessModel.ENTITLEMENT,
              requiredEntitlementKey: deck.requiredEntitlementKey,
              offerCodes: offerCodes.get(deck.requiredEntitlementKey) ?? [],
            }
          : { model: DeckAccessModel.FREE },
      ]),
    );
  }

  /**
   * Which offers currently grant each of these rights, in the order they
   * should be shown. Only ACTIVE offers: a client turns a code into a store
   * product through the offers endpoint, and a draft or retired offer has no
   * product it could resolve to. An owner keeps a deck whose offer retired —
   * the grant is what opens it, never the listing.
   */
  private async offerCodesByEntitlement(
    entitlementKeys: string[],
    reader: DeckAccessReader,
  ): Promise<Map<string, string[]>> {
    if (entitlementKeys.length === 0) {
      return new Map();
    }

    const grants = await reader.commerceOfferGrant.findMany({
      where: {
        entitlementKey: { in: entitlementKeys },
        offer: { status: CommerceOfferStatus.ACTIVE },
      },
      select: {
        entitlementKey: true,
        offer: { select: { code: true, sortOrder: true } },
      },
    });
    // Ordered here rather than in SQL because the editorial rank is nullable
    // and an unranked offer belongs at the end, not at the front where a
    // NULLS FIRST default would put it.
    const ordered = [...grants].sort((left, right) => {
      const byRank =
        (left.offer.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.offer.sortOrder ?? Number.MAX_SAFE_INTEGER);
      return byRank === 0
        ? left.offer.code.localeCompare(right.offer.code)
        : byRank;
    });

    const byEntitlement = new Map<string, string[]>();
    for (const grant of ordered) {
      const codes = byEntitlement.get(grant.entitlementKey) ?? [];
      codes.push(grant.offer.code);
      byEntitlement.set(grant.entitlementKey, codes);
    }
    return byEntitlement;
  }
}
