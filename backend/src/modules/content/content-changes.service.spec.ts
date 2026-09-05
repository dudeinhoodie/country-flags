import { ContentChangeOperation, ContentResourceType } from "@prisma/client";

import type { PrismaService } from "../../infrastructure/database/prisma.service";
import type { DeckAccessService } from "../commerce/deck-access.service";
import {
  decodeContentChangeCursor,
  encodeContentChangeCursor,
} from "./content-cursor";
import { ContentService } from "./content.service";

describe("ContentService content changes", () => {
  const contentPointer = { findUnique: jest.fn() };
  const contentChange = { findMany: jest.fn() };
  const transaction = { contentPointer, contentChange };
  const $transaction = jest.fn(
    (callback: (value: typeof transaction) => unknown) => callback(transaction),
  );
  // The change feed is public and account-blind, so the access guard is
  // never consulted on this path; a stub that would throw if it were keeps
  // that honest.
  const deckAccess = {
    policiesFor: jest.fn(() => {
      throw new Error("The public change feed must not read access policy");
    }),
  } as unknown as DeckAccessService;
  const service = new ContentService(
    {
      $transaction,
    } as unknown as PrismaService,
    deckAccess,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    contentPointer.findUnique.mockResolvedValue({ contentVersion: "v2" });
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

    const result = await service.listChanges(after, 2);

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

  it("advances no further than the supplied cursor on an empty page", async () => {
    contentChange.findMany.mockResolvedValue([]);
    const after = encodeContentChangeCursor("v1", 99n);

    const result = await service.listChanges(after, 50);

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(decodeContentChangeCursor(result.nextCursor)).toEqual({
      version: "v2",
      sequence: 99n,
    });
  });
});
