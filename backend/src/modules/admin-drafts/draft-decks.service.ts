import { HttpStatus, Injectable } from "@nestjs/common";
import { CardStatus } from "@prisma/client";
import type { AdminUser, ContentDraft } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
import {
  assertAccessChangeIsAllowed,
  assertDeckCardsAreSound,
  cardIdentity,
  deckNeedsV3,
  previewCardIdsOf,
  previewCardsFromIds,
  resolveDeckCards,
  withDeckDefaults,
} from "./deck-cards";
import type { ResolvedDeckCard } from "./deck-cards";
import {
  assertDeckIsSound,
  membersMode,
  resolveDeckMembers,
} from "./deck-membership";
import type {
  EditorialDeck,
  EditorialDeckAccess,
  EditorialEntity,
  MembershipContext,
} from "./deck-membership";
import {
  EDITORIAL_SCHEMA_VERSION,
  liftEditorialDocumentToV3,
} from "./editorial-document.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

interface EditorialCatalogDocument extends Record<string, unknown> {
  schemaVersion: number;
  supportedLocales: string[];
  entities: EditorialEntity[];
  decks: EditorialDeck[];
}

export interface DeckView {
  key: string;
  kind: string;
  names: Record<string, { name: string; description: string }>;
  membersMode: string;
  members: EditorialDeck["members"];
  memberCount: number;
  defaultTemplateCode?: string;
  defaultTemplateSchemaVersion?: number;
  access?: EditorialDeckAccess;
  previewCardIds?: string[];
}

export interface DeckDetailView extends DeckView {
  memberKeys: string[];
  resolvedMemberCards: ResolvedDeckCard[];
}

/**
 * A deck as the console writes it. Previews arrive as ids because the admin
 * contract names cards rather than editorial refs; the catalog stores them
 * back in the shape its own members are written in.
 */
export type DeckWriteInput = Omit<EditorialDeck, "previewCards"> & {
  previewCardIds?: string[];
};

function asCatalog(document: unknown): EditorialCatalogDocument {
  return document as EditorialCatalogDocument;
}

/**
 * Whether the document already speaks v3. Once it does, every deck in it
 * must carry the default template the v3 schema requires, even one that
 * would have been happy in v2.
 */
function isV3(catalog: EditorialCatalogDocument): boolean {
  return catalog.schemaVersion === EDITORIAL_SCHEMA_VERSION;
}

function deckNotFound(deckKey: string): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    `The draft has no deck ${deckKey}`,
  );
}

@Injectable()
export class DraftDecksService {
  constructor(
    private readonly database: PrismaService,
    private readonly drafts: AdminDraftsService,
    private readonly taxonomy: TaxonomySourceService,
    private readonly catalog: CatalogSourceService,
  ) {}

  async list(draftId: string): Promise<DeckView[]> {
    const draft = await this.drafts.get(draftId);
    const catalog = asCatalog(draft.document);
    const context = await this.context(catalog);
    return catalog.decks.map((deck) => this.toView(deck, context));
  }

  async getOne(draftId: string, deckKey: string): Promise<DeckDetailView> {
    const draft = await this.drafts.get(draftId);
    const catalog = asCatalog(draft.document);
    const deck = catalog.decks.find((entry) => entry.key === deckKey);
    if (deck === undefined) {
      deckNotFound(deckKey);
    }
    const context = await this.context(catalog);
    const cards = this.safeCards(deck, context);
    return {
      ...this.toView(deck, context),
      memberKeys: this.safeMembers(deck, context),
      resolvedMemberCards: await this.withPublishedCardIds(
        cards,
        draft.baseContentVersion,
      ),
    };
  }

  async create(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    input: DeckWriteInput,
    requestId: string,
  ): Promise<ContentDraft> {
    const relations = await this.taxonomy.publishedRelations();
    const published = this.publishedAccess();
    return this.drafts.applyDocumentChange(
      actor,
      draftId,
      expectedRevision,
      (current) => {
        const catalog = asCatalog(current);
        if (catalog.decks.some((entry) => entry.key === input.key)) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "DECK_KEY_TAKEN",
            `The draft already has a deck ${input.key}`,
          );
        }
        const deck = this.assemble(input, isV3(catalog));
        assertAccessChangeIsAllowed(
          deck.key,
          published.get(deck.key),
          deck.access,
        );
        this.assertSound(deck, catalog, relations);
        return this.store(
          { ...catalog, decks: [...catalog.decks, deck] },
          deck,
        );
      },
      {
        action: "admin.draft.deck_created",
        metadata: {
          deckKey: input.key,
          membersMode: membersMode(input.members),
          accessModel: input.access?.model ?? "FREE",
        },
      },
      requestId,
    );
  }

  async update(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    deckKey: string,
    changes: Partial<Omit<DeckWriteInput, "key">>,
    requestId: string,
  ): Promise<ContentDraft> {
    const relations = await this.taxonomy.publishedRelations();
    const published = this.publishedAccess();
    return this.drafts.applyDocumentChange(
      actor,
      draftId,
      expectedRevision,
      (current) => {
        const catalog = asCatalog(current);
        const index = catalog.decks.findIndex((entry) => entry.key === deckKey);
        if (index === -1) {
          deckNotFound(deckKey);
        }
        const existing = catalog.decks[index]!;
        // Only what the request names is replaced: editing a deck's RU name
        // must not quietly rewrite an `all-current` membership into a list.
        // Previews travel as ids rather than as the stored refs: the ones
        // the request did not name are re-read from the deck as it stands.
        const next = this.assemble(
          {
            ...existing,
            ...changes,
            key: deckKey,
            previewCardIds:
              changes.previewCardIds ?? previewCardIdsOf(existing),
          },
          isV3(catalog),
        );
        assertAccessChangeIsAllowed(
          deckKey,
          published.get(deckKey),
          next.access,
        );
        this.assertSound(next, catalog, relations);
        const decks = [...catalog.decks];
        decks[index] = next;
        return this.store({ ...catalog, decks }, next);
      },
      {
        action: "admin.draft.deck_updated",
        metadata: {
          deckKey,
          changed: Object.keys(changes).sort(),
        },
      },
      requestId,
    );
  }

  async remove(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    deckKey: string,
    requestId: string,
  ): Promise<ContentDraft> {
    return this.drafts.applyDocumentChange(
      actor,
      draftId,
      expectedRevision,
      (current) => {
        const catalog = asCatalog(current);
        if (!catalog.decks.some((entry) => entry.key === deckKey)) {
          deckNotFound(deckKey);
        }
        if (catalog.decks.length === 1) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "DECK_LAST_REMAINING",
            "A catalog must publish at least one deck",
          );
        }
        return {
          ...catalog,
          decks: catalog.decks.filter((entry) => entry.key !== deckKey),
        };
      },
      {
        action: "admin.draft.deck_deleted",
        metadata: { deckKey },
      },
      requestId,
    );
  }

  /**
   * The deck as the catalog will hold it: defaults filled in, previews
   * turned back into refs, and a free deck left without an access block at
   * all — "absent means free" is what the catalog already says, and writing
   * it out would move an untouched catalog to v3 for nothing.
   */
  private assemble(input: DeckWriteInput, catalogIsV3: boolean): EditorialDeck {
    const deck: EditorialDeck = {
      key: input.key,
      kind: input.kind,
      names: input.names,
      members: input.members,
      ...(input.defaultTemplateCode === undefined
        ? {}
        : { defaultTemplateCode: input.defaultTemplateCode }),
      ...(input.defaultTemplateSchemaVersion === undefined
        ? {}
        : { defaultTemplateSchemaVersion: input.defaultTemplateSchemaVersion }),
      ...(input.access === undefined || input.access.model === "FREE"
        ? {}
        : {
            access: {
              model: "ENTITLEMENT" as const,
              requiredEntitlementKey:
                input.access.requiredEntitlementKey ?? null,
            },
          }),
    };
    const previews = input.previewCardIds ?? [];
    if (previews.length > 0) {
      deck.previewCards = previewCardsFromIds(deck, previews);
    }
    return withDeckDefaults(deck, catalogIsV3);
  }

  /**
   * A document moves to v3 the moment a deck says something v2 cannot: a
   * template, an access model, a preview or an explicit card ref.
   */
  private store(
    catalog: EditorialCatalogDocument,
    deck: EditorialDeck,
  ): Record<string, unknown> {
    return deckNeedsV3(deck) ? liftEditorialDocumentToV3(catalog) : catalog;
  }

  /**
   * What the deployed release published, read from the catalog the image
   * carries rather than from the draft — a draft can be edited into saying
   * anything, and the question here is what buyers already have.
   */
  private publishedAccess(): Map<string, EditorialDeckAccess> {
    const decks = new Map<string, EditorialDeckAccess>();
    let document: unknown;
    try {
      document = this.catalog.read().document;
    } catch {
      // A deployment without the catalog file cannot judge the change; the
      // publish gate still refuses it against the real release.
      return decks;
    }
    for (const deck of asCatalog(document).decks ?? []) {
      // Absent access is what the catalog writes for a free deck, and a
      // free deck is exactly what must not quietly become paid.
      decks.set(deck.key, deck.access ?? { model: "FREE" });
    }
    return decks;
  }

  private assertSound(
    deck: EditorialDeck,
    catalog: EditorialCatalogDocument,
    relations: Awaited<ReturnType<TaxonomySourceService["publishedRelations"]>>,
  ): void {
    const context: MembershipContext = {
      entities: catalog.entities,
      relations: this.taxonomy.merge(relations, catalog.additionalRelations),
    };
    assertDeckIsSound(deck, context, catalog.supportedLocales);
    assertDeckCardsAreSound(deck, context);
  }

  private async context(
    catalog: EditorialCatalogDocument,
  ): Promise<MembershipContext> {
    return {
      entities: catalog.entities,
      relations: this.taxonomy.merge(
        await this.taxonomy.publishedRelations(),
        catalog.additionalRelations,
      ),
    };
  }

  private toView(deck: EditorialDeck, context: MembershipContext): DeckView {
    return {
      key: deck.key,
      kind: deck.kind,
      names: deck.names,
      membersMode: membersMode(deck.members),
      members: deck.members,
      memberCount: this.safeCards(deck, context).length,
      ...(deck.defaultTemplateCode === undefined
        ? {}
        : { defaultTemplateCode: deck.defaultTemplateCode }),
      ...(deck.defaultTemplateSchemaVersion === undefined
        ? {}
        : { defaultTemplateSchemaVersion: deck.defaultTemplateSchemaVersion }),
      ...(deck.access === undefined ? {} : { access: deck.access }),
      previewCardIds: previewCardIdsOf(deck),
    };
  }

  /**
   * A deck already in the draft can be unresolvable (a taxonomy node the
   * catalog stopped classifying); listing decks must still work so the
   * editor can go fix it, so resolution failure reads as "holds nothing".
   */
  private safeMembers(
    deck: EditorialDeck,
    context: MembershipContext,
  ): string[] {
    try {
      return resolveDeckMembers(deck, context);
    } catch {
      return [];
    }
  }

  private safeCards(
    deck: EditorialDeck,
    context: MembershipContext,
  ): ResolvedDeckCard[] {
    try {
      return resolveDeckCards(deck, context);
    } catch {
      return [];
    }
  }

  /**
   * The card each member resolves to in the release the draft started from.
   * A pair the release never built has no id yet, and saying so is the
   * point: it tells the editor the deck holds something new.
   */
  private async withPublishedCardIds(
    cards: ResolvedDeckCard[],
    contentVersion: string,
  ): Promise<ResolvedDeckCard[]> {
    if (cards.length === 0) {
      return cards;
    }
    const published = await this.database.learningCard.findMany({
      where: {
        contentVersion,
        status: CardStatus.ACTIVE,
        subject: {
          contentKey: { in: [...new Set(cards.map((card) => card.entityKey))] },
        },
      },
      select: {
        id: true,
        subject: { select: { contentKey: true } },
        template: { select: { code: true, schemaVersion: true } },
      },
    });
    const idByCard = new Map(
      published.map((card) => [
        cardIdentity({
          entityKey: card.subject.contentKey,
          templateCode: card.template.code,
          templateSchemaVersion: card.template.schemaVersion,
        }),
        card.id,
      ]),
    );
    return cards.map((card) => ({
      ...card,
      learningCardId: idByCard.get(cardIdentity(card)) ?? null,
    }));
  }
}
