import { Injectable } from "@nestjs/common";
import { CardStatus, DeckStatus } from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import { deckCodeFromKey } from "../content/bundle/bundle-mapper";
import { membersMode, resolveDeckMembers } from "./deck-membership";
import type {
  EditorialDeck,
  EditorialEntity,
  MembershipContext,
} from "./deck-membership";

export interface DeckDiffEntry {
  deckKey: string;
  change: "added" | "removed" | "changed";
  details: string[];
}

export interface AssetDiffEntry {
  entityContentKey: string;
  assetType: string;
  change: "replaced" | "added";
  reason: string | null;
}

export interface DraftDiff {
  baseContentVersion: string;
  isEmpty: boolean;
  decks: DeckDiffEntry[];
  assets: AssetDiffEntry[];
}

interface EditorialCatalogDocument {
  entities: EditorialEntity[];
  decks: EditorialDeck[];
}

/**
 * An editorial deck key and a published deck code are two namespaces: the
 * release build derives `Deck.code` from `deck.key`, so comparing them
 * directly would report every deck as new. The diff maps through the
 * publisher's own derivation, which is the only thing guaranteed to agree
 * with what a release actually produces.
 *
 * What a release built from this draft would change, said in the domain's
 * own words — decks, membership and replaced drawings — rather than as a
 * JSON patch. An editor decides whether to propose from this, and a JSON
 * patch is not a thing anyone can decide from.
 *
 * Entity facts derived from upstream sources are deliberately absent: the
 * console does not own them (ADR-014 §4), so a diff that claimed to show
 * them would be showing noise from the last source refresh.
 */
@Injectable()
export class DraftDiffService {
  constructor(private readonly database: PrismaService) {}

  async diff(
    draft: {
      id: string;
      baseContentVersion: string;
      document: unknown;
    },
    context: MembershipContext,
  ): Promise<DraftDiff> {
    const catalog = draft.document as EditorialCatalogDocument;
    const published = await this.database.deck.findMany({
      where: { status: DeckStatus.PUBLISHED },
      include: {
        localizations: true,
        _count: {
          select: {
            cards: { where: { learningCard: { status: CardStatus.ACTIVE } } },
          },
        },
      },
    });
    const publishedByCode = new Map(published.map((deck) => [deck.code, deck]));

    const decks: DeckDiffEntry[] = [];
    for (const deck of catalog.decks) {
      const counterpart = publishedByCode.get(deckCodeFromKey(deck.key));
      if (counterpart === undefined) {
        decks.push({
          deckKey: deck.key,
          change: "added",
          details: [
            `New ${membersMode(deck.members)} deck holding ${String(
              this.safeCount(deck, context),
            )} countries`,
          ],
        });
        continue;
      }
      const details: string[] = [];
      const memberCount = this.safeCount(deck, context);
      if (memberCount !== counterpart._count.cards) {
        details.push(
          `Countries: ${String(counterpart._count.cards)} → ${String(memberCount)}`,
        );
      }
      for (const localization of counterpart.localizations) {
        const locale = localization.locale.toLowerCase();
        const next = deck.names[locale];
        if (next === undefined) {
          details.push(`Localization removed: ${locale}`);
          continue;
        }
        if (next.name !== localization.name) {
          details.push(
            `Name (${locale}): "${localization.name}" → "${next.name}"`,
          );
        }
        if (next.description !== localization.description) {
          details.push(`Description (${locale}) changed`);
        }
      }
      const publishedLocales = new Set(
        counterpart.localizations.map(({ locale }) => locale.toLowerCase()),
      );
      for (const locale of Object.keys(deck.names)) {
        if (!publishedLocales.has(locale)) {
          details.push(`Localization added: ${locale}`);
        }
      }
      if (details.length > 0) {
        decks.push({ deckKey: deck.key, change: "changed", details });
      }
    }

    const draftDeckCodes = new Set(
      catalog.decks.map((deck) => deckCodeFromKey(deck.key)),
    );
    for (const deck of published) {
      if (!draftDeckCodes.has(deck.code)) {
        decks.push({
          deckKey: deck.code,
          change: "removed",
          details: [`Was publishing ${String(deck._count.cards)} countries`],
        });
      }
    }

    const uploaded = await this.database.draftAsset.findMany({
      where: { draftId: draft.id },
      orderBy: [{ entityContentKey: "asc" }],
    });
    const assets: AssetDiffEntry[] = uploaded.map((asset) => ({
      entityContentKey: asset.entityContentKey,
      assetType: asset.assetType,
      change: "replaced",
      reason: asset.replacementReason,
    }));

    return {
      baseContentVersion: draft.baseContentVersion,
      isEmpty: decks.length === 0 && assets.length === 0,
      decks: decks.sort((left, right) =>
        left.deckKey.localeCompare(right.deckKey),
      ),
      assets,
    };
  }

  /**
   * A deck that cannot be resolved counts as zero here; validation is what
   * reports it as an error, and a diff that threw would hide every other
   * change behind one broken deck.
   */
  private safeCount(deck: EditorialDeck, context: MembershipContext): number {
    try {
      return resolveDeckMembers(deck, context).length;
    } catch {
      return 0;
    }
  }
}
