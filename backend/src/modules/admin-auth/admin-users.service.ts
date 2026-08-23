import { HttpStatus, Injectable } from "@nestjs/common";
import type { AdminUser, Prisma } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "./admin-audit.service";
import type { AdminUserUpdateRequest } from "./admin-users.request";

function adminUserNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    "The requested resource was not found",
  );
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(
    offset: number,
    limit: number,
  ): Promise<{ items: AdminUser[]; total: number }> {
    const [items, total] = await this.database.$transaction([
      this.database.adminUser.findMany({
        orderBy: { email: "asc" },
        skip: offset,
        take: limit,
      }),
      this.database.adminUser.count(),
    ]);
    return { items, total };
  }

  async getOne(adminUserId: string): Promise<AdminUser> {
    const user = await this.database.adminUser.findUnique({
      where: { id: adminUserId },
    });
    if (user === null) {
      adminUserNotFound();
    }
    return user;
  }

  async update(
    actor: AdminUser,
    targetId: string,
    changes: AdminUserUpdateRequest,
    requestId: string,
  ): Promise<AdminUser> {
    // An ADMIN who could demote or disable themselves could lock the whole
    // contour; the last ADMIN standing must stay able to act.
    if (actor.id === targetId) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "ADMIN_SELF_CHANGE_FORBIDDEN",
        "An administrator cannot change their own role or status",
      );
    }

    return this.database.$transaction(async (transaction) => {
      const target = await transaction.adminUser.findUnique({
        where: { id: targetId },
      });
      if (target === null) {
        adminUserNotFound();
      }

      const roleChanged =
        changes.role !== undefined && changes.role !== target.role;
      const statusChanged =
        changes.status !== undefined && changes.status !== target.status;
      if (!roleChanged && !statusChanged) {
        return target;
      }

      const data: Prisma.AdminUserUpdateInput = {};
      if (roleChanged && changes.role !== undefined) {
        data.role = changes.role;
      }
      if (statusChanged && changes.status !== undefined) {
        data.status = changes.status;
      }
      const updated = await transaction.adminUser.update({
        where: { id: targetId },
        data,
      });

      // Access changes must not keep riding on sessions issued under the
      // old privileges — revoke everything the target had open.
      await transaction.adminSession.updateMany({
        where: { adminUserId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (roleChanged) {
        await this.audit.record(transaction, {
          actorAdminUserId: actor.id,
          action: "admin.user.role_changed",
          targetType: "admin_user",
          targetId,
          requestId,
          metadata: { before: target.role, after: updated.role },
        });
      }
      if (statusChanged) {
        await this.audit.record(transaction, {
          actorAdminUserId: actor.id,
          action: "admin.user.status_changed",
          targetType: "admin_user",
          targetId,
          requestId,
          metadata: { before: target.status, after: updated.status },
        });
      }

      return updated;
    });
  }
}
