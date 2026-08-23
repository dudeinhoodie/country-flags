import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";

export interface AdminAuditEntry {
  actorAdminUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string;
  requestId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Every admin mutation records who did what to whom. Callers inside a
 * transaction pass their transaction client so the audit row cannot outlive
 * a rolled-back change (or miss a committed one).
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly database: PrismaService) {}

  async record(
    client: Prisma.TransactionClient | PrismaService,
    entry: AdminAuditEntry,
  ): Promise<void> {
    await client.adminAuditEvent.create({
      data: {
        actorAdminUserId: entry.actorAdminUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        requestId: entry.requestId ?? null,
        metadata: entry.metadata ?? {},
      },
      select: { id: true },
    });
  }
}
