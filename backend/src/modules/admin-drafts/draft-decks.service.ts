import { HttpStatus, Injectable } from "@nestjs/common";
import type { AdminUser, ContentDraft } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { AdminDraftsService } from "./admin-drafts.service";
import {
  assertDeckIsSound,
  membersMode,
  resolveDeckMembers,
} from "./deck-membership";
import type {
  EditorialDeck,
  EditorialEntity,
  MembershipContext,
} from "./deck-membership";
import { TaxonomySourceService } from "./taxonomy-source.service";

interface EditorialCatalogDocument extends Record<string, unknown> {
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
}

function asCatalog(document: unknown): EditorialCatalogDocument {
  return document as EditorialCatalogDocument;
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
    private readonly drafts: AdminDraftsService,
    private readonly taxonomy: TaxonomySourceService,
  ) {}

  async list(draftId: string): Promise<DeckView[]> {
    const draft = await this.drafts.get(draftId);
    const catalog = asCatalog(draft.document);
    const context = await this.context(catalog);
    return catalog.decks.map((deck) => this.toView(deck, context));
  }

  async getOne(
    draftId: string,
    deckKey: string,
  ): Promise<DeckView & { memberKeys: string[] }> {
    const draft = await this.drafts.get(draftId);
    const catalog = asCatalog(draft.document);
    const deck = catalog.decks.find((entry) => entry.key === deckKey);
    if (deck === undefined) {
      deckNotFound(deckKey);
    }
    const context = await this.context(catalog);
    return {
      ...this.toView(deck, context),
      memberKeys: this.safeMembers(deck, context),
    };
  }

  async create(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    deck: EditorialDeck,
    requestId: string,
  ): Promise<ContentDraft> {
    const relations = await this.taxonomy.publishedRelations();
    return this.drafts.applyDocumentChange(
      actor,
      draftId,
      expectedRevision,
      (current) => {
        const catalog = asCatalog(current);
        if (catalog.decks.some((entry) => entry.key === deck.key)) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "DECK_KEY_TAKEN",
            `The draft already has a deck ${deck.key}`,
          );
        }
        this.assertSound(deck, catalog, relations);
        return { ...catalog, decks: [...catalog.decks, deck] };
      },
      {
        action: "admin.draft.deck_created",
        metadata: { deckKey: deck.key, membersMode: membersMode(deck.members) },
      },
      requestId,
    );
  }

  async update(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    deckKey: string,
    changes: Partial<Omit<EditorialDeck, "key">>,
    requestId: string,
  ): Promise<ContentDraft> {
    const relations = await this.taxonomy.publishedRelations();
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
        const next: EditorialDeck = {
          ...existing,
          ...(changes.kind === undefined ? {} : { kind: changes.kind }),
          ...(changes.names === undefined ? {} : { names: changes.names }),
          ...(changes.members === undefined
            ? {}
            : { members: changes.members }),
        };
        this.assertSound(next, catalog, relations);
        const decks = [...catalog.decks];
        decks[index] = next;
        return { ...catalog, decks };
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

  private assertSound(
    deck: EditorialDeck,
    catalog: EditorialCatalogDocument,
    relations: Awaited<ReturnType<TaxonomySourceService["publishedRelations"]>>,
  ): void {
    assertDeckIsSound(
      deck,
      {
        entities: catalog.entities,
        relations: this.taxonomy.merge(relations, catalog.additionalRelations),
      },
      catalog.supportedLocales,
    );
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
      memberCount: this.safeMembers(deck, context).length,
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
}
