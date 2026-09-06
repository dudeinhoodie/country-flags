import {
  ContentChangeOperation,
  ContentResourceType,
  DeckAccessModel,
} from "@prisma/client";

import type { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  PAID_CONTENT_AWARE,
  PAID_CONTENT_UNAWARE,
} from "../client-compatibility/client-compatibility.service";
import { DeckAccessService } from "../commerce/deck-access.service";
import { ContentAccessProjectionService } from "./content-access-projection.service";
import {
  decodeContentChangeCursor,
  encodeContentChangeCursor,
} from "./content-cursor";
import { ContentService } from "./content.service";

const PUBLIC_CARD_ID = "60000000-0000-4000-8000-000000000001";
const PAID_CARD_ID = "60000000-0000-4000-8000-00000000000a";
const PAID_ASSET_ID = "40000000-0000-4000-8000-00000000000a";
const FREE_DECK = {
  id: "70000000-0000-4000-8000-000000000001",
  accessModel: DeckAccessModel.FREE,
  requiredEntitlementKey: null,
};
const PAID_DECK = {
  id: "70000000-0000-4000-8000-00000000000a",
  accessModel: DeckAccessModel.ENTITLEMENT,
  requiredEntitlementKey: "entitlement.european_coats",
};

interface MembershipQuery {
  where: {
    learningCardId?: { in: string[] };
    learningCard?: {
      revisions?: { some: { promptAssetId: { in: string[] } } };
    };
  };
}

describe("ContentService content changes", () => {
  const contentPointer = { findUnique: jest.fn() };
  const contentChange = { findMany: jest.fn() };
  const deckCard = { findMany: jest.fn() };
  const deck = { findMany: jest.fn() };
  const transaction = { contentPointer, contentChange };
  const $transaction = jest.fn(
    (callback: (value: typeof transaction) => unknown) => callback(transaction),
  );
  const prisma = { $transaction, deck, deckCard } as unknown as PrismaService;
  // The change feed is public and account-blind: it asks which decks reach a
  // resource, never which decks this reader has bought. `policiesFor` would
  // be the account-shaped question, and a stub that throws keeps that honest.
  const deckAccess = new DeckAccessService(prisma);
  jest.spyOn(deckAccess, "policiesFor").mockImplementation(() => {
    throw new Error("The public change feed must not read access policy");
  });
  const service = new ContentService(
    prisma,
    deckAccess,
    new ContentAccessProjectionService(prisma, deckAccess),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    contentPointer.findUnique.mockResolvedValue({ contentVersion: "v2" });
    // Every card of the release belongs to the free deck unless a test says
    // otherwise; the asset query answers nothing, which is the shape of a
    // release nobody sells anything in.
    deckCard.findMany.mockImplementation((query: MembershipQuery) =>
      Promise.resolve(
        query.where.learningCardId === undefined
          ? []
          : query.where.learningCardId.in.map((learningCardId) => ({
              learningCardId,
              isPreview: false,
              deck: FREE_DECK,
            })),
      ),
    );
    // Only the free deck answers the "which of these can an old build draw"
    // query, which is what the database would say for this fixture.
    deck.findMany.mockResolvedValue([{ id: FREE_DECK.id }]);
  });

  it("lists a stable page after the monotonic sequence cursor", async () => {
    let receivedQuery: unknown;
    const changes = [
      {
        sequence: 42n,
        operation: ContentChangeOperation.UPSERT,
        resourceType: ContentResourceType.ENTITY,
        resourceId: "30000000-0000-4000-8000-000000000001",
        contentVersion: "v2",
      },
      {
        sequence: 43n,
        operation: ContentChangeOperation.RETIRE,
        resourceType: ContentResourceType.LEARNING_CARD,
        resourceId: "60000000-0000-4000-8000-000000000001",
        contentVersion: "v2",
      },
      {
        sequence: 44n,
        operation: ContentChangeOperation.UPSERT,
        resourceType: ContentResourceType.DECK,
        resourceId: "70000000-0000-4000-8000-000000000001",
        contentVersion: "v2",
      },
    ];
    contentChange.findMany.mockImplementation((query: unknown) => {
      receivedQuery = query;
      return Promise.resolve(changes);
    });
    const after = encodeContentChangeCursor("v1", 41n);

    const result = await service.listChanges(after, 2, PAID_CONTENT_AWARE);

    const query = receivedQuery as {
      where: { sequence: { gt: bigint } };
      orderBy: { sequence: string };
      take: number;
    };
    expect(query.where.sequence).toEqual({ gt: 41n });
    expect(query.orderBy).toEqual({ sequence: "asc" });
    expect(query.take).toBe(3);
    expect(result).toMatchObject({
      items: [
        {
          operation: "UPSERT",
          resourceType: "ENTITY",
          resourceId: "30000000-0000-4000-8000-000000000001",
          contentVersion: "v2",
        },
        {
          operation: "RETIRE",
          resourceType: "LEARNING_CARD",
          resourceId: "60000000-0000-4000-8000-000000000001",
          contentVersion: "v2",
        },
      ],
      hasMore: true,
      contentVersion: "v2",
    });
    expect(typeof result.nextCursor).toBe("string");
    expect(decodeContentChangeCursor(result.nextCursor)).toEqual({
      version: "v2",
      sequence: 43n,
    });
    expect(result.items[1]).toEqual({
      operation: "RETIRE",
      resourceType: "LEARNING_CARD",
      resourceId: "60000000-0000-4000-8000-000000000001",
      contentVersion: "v2",
    });
  });

  it("announces neither the card nor the drawing only a paid deck reaches", async () => {
    deckCard.findMany.mockImplementation((query: MembershipQuery) =>
      Promise.resolve(
        query.where.learningCardId === undefined
          ? // The asset query: the coat is prompted by a card the paid deck
            // alone holds.
            [
              {
                isPreview: false,
                deck: PAID_DECK,
                learningCard: { revisions: [{ promptAssetId: PAID_ASSET_ID }] },
              },
            ]
          : query.where.learningCardId.in.map((learningCardId) => ({
              learningCardId,
              isPreview: false,
              deck: learningCardId === PAID_CARD_ID ? PAID_DECK : FREE_DECK,
            })),
      ),
    );
    contentChange.findMany.mockResolvedValue([
      {
        sequence: 50n,
        operation: ContentChangeOperation.UPSERT,
        resourceType: ContentResourceType.ASSET,
        resourceId: PAID_ASSET_ID,
        contentVersion: "v2",
      },
      {
        sequence: 51n,
        operation: ContentChangeOperation.UPSERT,
        resourceType: ContentResourceType.LEARNING_CARD,
        resourceId: PAID_CARD_ID,
        contentVersion: "v2",
      },
      {
        sequence: 52n,
        operation: ContentChangeOperation.UPSERT,
        resourceType: ContentResourceType.LEARNING_CARD,
        resourceId: PUBLIC_CARD_ID,
        contentVersion: "v2",
      },
      {
        sequence: 53n,
        operation: ContentChangeOperation.UPSERT,
        resourceType: ContentResourceType.DECK,
        resourceId: PAID_DECK.id,
        contentVersion: "v2",
      },
    ]);

    const result = await service.listChanges(
      encodeContentChangeCursor("v2", 49n),
      50,
      PAID_CONTENT_AWARE,
    );

    // The deck survives — the catalog publishes it to everybody, and this is
    // the event that tells an owner to come back for its cards.
    expect(result.items).toEqual([
      {
        operation: "UPSERT",
        resourceType: "LEARNING_CARD",
        resourceId: PUBLIC_CARD_ID,
        contentVersion: "v2",
      },
      {
        operation: "UPSERT",
        resourceType: "DECK",
        resourceId: PAID_DECK.id,
        contentVersion: "v2",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(PAID_ASSET_ID);
    expect(JSON.stringify(result)).not.toContain(PAID_CARD_ID);
    // Withheld rows still move the reader past them, or a release that is
    // mostly paid would be an infinite page of nothing.
    expect(decodeContentChangeCursor(result.nextCursor)).toEqual({
      version: "v2",
      sequence: 53n,
    });
  });

  it("still announces the withdrawal of a card nothing reaches any more", async () => {
    // Retiring a card deletes its deck memberships, so by the time this is
    // read the card is reachable through nothing and classifies as closed.
    // Withholding it would be the one case that matters: a client told
    // nothing keeps withdrawn content for good.
    deckCard.findMany.mockResolvedValue([]);
    contentChange.findMany.mockResolvedValue([
      {
        sequence: 60n,
        operation: ContentChangeOperation.RETIRE,
        resourceType: ContentResourceType.LEARNING_CARD,
        resourceId: PAID_CARD_ID,
        contentVersion: "v2",
      },
      {
        sequence: 61n,
        operation: ContentChangeOperation.RETIRE,
        resourceType: ContentResourceType.ASSET,
        resourceId: PAID_ASSET_ID,
        contentVersion: "v2",
      },
    ]);

    const result = await service.listChanges(
      encodeContentChangeCursor("v2", 59n),
      50,
      PAID_CONTENT_AWARE,
    );

    expect(result.items.map(({ resourceId }) => resourceId)).toEqual([
      PAID_CARD_ID,
      PAID_ASSET_ID,
    ]);
  });

  it("advances no further than the supplied cursor on an empty page", async () => {
    contentChange.findMany.mockResolvedValue([]);
    const after = encodeContentChangeCursor("v1", 99n);

    const result = await service.listChanges(after, 50, PAID_CONTENT_AWARE);

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(decodeContentChangeCursor(result.nextCursor)).toEqual({
      version: "v2",
      sequence: 99n,
    });
  });
  describe("a build that predates the paid-deck contract", () => {
    const deckChanges = [
      {
        sequence: 70n,
        operation: ContentChangeOperation.UPSERT,
        resourceType: ContentResourceType.DECK,
        resourceId: FREE_DECK.id,
        contentVersion: "v2",
      },
      {
        sequence: 71n,
        operation: ContentChangeOperation.UPSERT,
        resourceType: ContentResourceType.DECK,
        resourceId: PAID_DECK.id,
        contentVersion: "v2",
      },
      {
        sequence: 72n,
        operation: ContentChangeOperation.RETIRE,
        resourceType: ContentResourceType.DECK,
        resourceId: PAID_DECK.id,
        contentVersion: "v2",
      },
    ];

    it("hears about the free deck, never the locked one, and still about a withdrawal", async () => {
      contentChange.findMany.mockResolvedValue(deckChanges);

      const result = await service.listChanges(
        encodeContentChangeCursor("v2", 69n),
        50,
        PAID_CONTENT_UNAWARE,
      );

      expect(result.items).toEqual([
        {
          operation: "UPSERT",
          resourceType: "DECK",
          resourceId: FREE_DECK.id,
          contentVersion: "v2",
        },
        // A RETIRE always survives. It is the one event whose whole purpose
        // is to tell a client to forget something, and a build that is never
        // told keeps withdrawn content for good.
        {
          operation: "RETIRE",
          resourceType: "DECK",
          resourceId: PAID_DECK.id,
          contentVersion: "v2",
        },
      ]);
      expect(deck.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: [FREE_DECK.id, PAID_DECK.id] },
            accessModel: { in: [DeckAccessModel.FREE] },
          },
        }),
      );
      // The cursor is computed from the page the database returned, so a
      // release that is mostly locked still terminates.
      expect(decodeContentChangeCursor(result.nextCursor)).toEqual({
        version: "v2",
        sequence: 72n,
      });
    });

    it("asks nothing of the deck table for a build that can draw them all", async () => {
      contentChange.findMany.mockResolvedValue(deckChanges);

      const result = await service.listChanges(
        encodeContentChangeCursor("v2", 69n),
        50,
        PAID_CONTENT_AWARE,
      );

      expect(result.items.map(({ resourceId }) => resourceId)).toEqual([
        FREE_DECK.id,
        PAID_DECK.id,
        PAID_DECK.id,
      ]);
      expect(deck.findMany).not.toHaveBeenCalled();
    });

    it("keeps a locked deck's shop window out of an old build's feed", async () => {
      // The card is one the locked deck publishes as a preview on purpose,
      // which makes it PUBLIC_PREVIEW: a newer build may show it inside the
      // paywall, and an older one has no paywall to put it in.
      deckCard.findMany.mockImplementation((query: MembershipQuery) =>
        Promise.resolve(
          query.where.learningCardId === undefined
            ? []
            : query.where.learningCardId.in.map((learningCardId) => ({
                learningCardId,
                isPreview: learningCardId === PAID_CARD_ID,
                deck: learningCardId === PAID_CARD_ID ? PAID_DECK : FREE_DECK,
              })),
        ),
      );
      const changes = [
        {
          sequence: 80n,
          operation: ContentChangeOperation.UPSERT,
          resourceType: ContentResourceType.LEARNING_CARD,
          resourceId: PAID_CARD_ID,
          contentVersion: "v2",
        },
        {
          sequence: 81n,
          operation: ContentChangeOperation.UPSERT,
          resourceType: ContentResourceType.LEARNING_CARD,
          resourceId: PUBLIC_CARD_ID,
          contentVersion: "v2",
        },
      ];
      contentChange.findMany.mockResolvedValue(changes);
      const after = encodeContentChangeCursor("v2", 79n);

      const shown = await service.listChanges(after, 50, PAID_CONTENT_AWARE);
      const withheld = await service.listChanges(
        after,
        50,
        PAID_CONTENT_UNAWARE,
      );

      expect(shown.items.map(({ resourceId }) => resourceId)).toEqual([
        PAID_CARD_ID,
        PUBLIC_CARD_ID,
      ]);
      expect(withheld.items.map(({ resourceId }) => resourceId)).toEqual([
        PUBLIC_CARD_ID,
      ]);
    });
  });
});
