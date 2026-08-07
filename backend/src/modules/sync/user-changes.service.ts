import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  decodeUserChangeCursor,
  encodeUserChangeCursor,
} from "./change-cursor";

@Injectable()
export class UserChangesService {
  constructor(private readonly database: PrismaService) {}

  async list(
    userId: string,
    after: string | undefined,
    limit: number,
  ): Promise<Record<string, unknown>> {
    const user = await this.database.user.findUniqueOrThrow({
      where: { id: userId },
      select: { syncStreamId: true },
    });
    const sequence =
      after === undefined
        ? 0n
        : decodeUserChangeCursor(after, user.syncStreamId);
    const rows = await this.database.userChange.findMany({
      where: { userId, sequence: { gt: sequence } },
      orderBy: { sequence: "asc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);

    return {
      items: items.map((row) => ({
        operation: row.operation,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        // A tombstone omits the payload; the contract types it as a card state
        // object so generated clients keep it.
        ...(row.payload === null ? {} : { payload: row.payload }),
        occurredAt: row.occurredAt.toISOString(),
      })),
      nextCursor: encodeUserChangeCursor(
        user.syncStreamId,
        last?.sequence ?? sequence,
      ),
      hasMore,
    };
  }

  async latestCursor(userId: string): Promise<string> {
    const [user, latest] = await Promise.all([
      this.database.user.findUniqueOrThrow({
        where: { id: userId },
        select: { syncStreamId: true },
      }),
      this.database.userChange.findFirst({
        where: { userId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      }),
    ]);
    return encodeUserChangeCursor(user.syncStreamId, latest?.sequence ?? 0n);
  }
}
