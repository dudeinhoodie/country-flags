import { HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import type { UpdateUserRequest } from "./user.request";
import { serializeUser } from "./user.serializer";

@Injectable()
export class UsersService {
  constructor(private readonly database: PrismaService) {}

  async get(userId: string): Promise<Record<string, unknown>> {
    const user = await this.database.user.findFirst({
      where: { id: userId, status: "ACTIVE" },
    });
    if (user === null) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "ACCOUNT_UNAVAILABLE",
        "The account is not available",
      );
    }
    return serializeUser(user);
  }

  async update(
    userId: string,
    update: UpdateUserRequest,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.database.$transaction(async (transaction) => {
      const existing = await transaction.user.findFirst({
        where: { id: userId, status: "ACTIVE" },
        select: { id: true },
      });
      if (existing === null) {
        throw new ApiException(
          HttpStatus.UNAUTHORIZED,
          "ACCOUNT_UNAVAILABLE",
          "The account is not available",
        );
      }
      const updated = await transaction.user.update({
        where: { id: userId },
        data: update,
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          action: "ACCOUNT_PROFILE_UPDATED",
          targetType: "USER",
          targetId: userId,
          requestId,
          metadata: {
            changedFields: Object.keys(update),
          } satisfies Prisma.InputJsonValue,
        },
      });
      return updated;
    });
    return serializeUser(user);
  }
}
