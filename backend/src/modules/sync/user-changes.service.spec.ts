import { UserChangeOperation, UserChangeResourceType } from "@prisma/client";

import type { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  decodeUserChangeCursor,
  encodeUserChangeCursor,
} from "./change-cursor";
import { UserChangesService } from "./user-changes.service";

describe("UserChangesService", () => {
  const userId = "10000000-0000-4000-8000-000000000001";
  const scopeId = "20000000-0000-4000-8000-000000000001";
  const user = { findUniqueOrThrow: jest.fn() };
  const userChange = { findMany: jest.fn(), findFirst: jest.fn() };
  const service = new UserChangesService({
    user,
    userChange,
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    user.findUniqueOrThrow.mockResolvedValue({ syncStreamId: scopeId });
  });

  it("returns a stable page and preserves tombstones", async () => {
    userChange.findMany.mockResolvedValue([
      {
        sequence: 8n,
        operation: UserChangeOperation.UPSERT,
        resourceType: UserChangeResourceType.CARD_STATE,
        resourceId: "60000000-0000-4000-8000-000000000001",
        payload: { learningCardId: "60000000-0000-4000-8000-000000000001" },
        occurredAt: new Date("2026-08-04T10:00:00.000Z"),
      },
      {
        sequence: 9n,
        operation: UserChangeOperation.TOMBSTONE,
        resourceType: UserChangeResourceType.CARD_STATE,
        resourceId: "60000000-0000-4000-8000-000000000002",
        payload: null,
        occurredAt: new Date("2026-08-04T10:01:00.000Z"),
      },
      {
        sequence: 10n,
        operation: UserChangeOperation.UPSERT,
        resourceType: UserChangeResourceType.CARD_STATE,
        resourceId: "60000000-0000-4000-8000-000000000003",
        payload: { learningCardId: "60000000-0000-4000-8000-000000000003" },
        occurredAt: new Date("2026-08-04T10:02:00.000Z"),
      },
    ]);

    const result = await service.list(
      userId,
      encodeUserChangeCursor(scopeId, 7n),
      2,
    );

    expect(userChange.findMany).toHaveBeenCalledWith({
      where: { userId, sequence: { gt: 7n } },
      orderBy: { sequence: "asc" },
      take: 3,
    });
    expect(result).toMatchObject({
      hasMore: true,
      items: [{ operation: "UPSERT" }, { operation: "TOMBSTONE" }],
    });
    // A tombstone omits the payload instead of sending null.
    expect(
      (result.items as Array<Record<string, unknown>>)[1],
    ).not.toHaveProperty("payload");
    expect(decodeUserChangeCursor(result.nextCursor as string, scopeId)).toBe(
      9n,
    );
  });

  it("starts at sequence zero when the cursor is omitted", async () => {
    userChange.findMany.mockResolvedValue([]);
    const result = await service.list(userId, undefined, 50);
    expect(decodeUserChangeCursor(result.nextCursor as string, scopeId)).toBe(
      0n,
    );
  });
});
