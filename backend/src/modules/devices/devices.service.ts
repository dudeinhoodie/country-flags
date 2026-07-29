import { HttpStatus, Injectable } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";

@Injectable()
export class DevicesService {
  constructor(private readonly database: PrismaService) {}

  async list(
    userId: string,
    currentSessionId: string | null,
  ): Promise<Record<string, unknown>> {
    const [devices, currentSession] = await Promise.all([
      this.database.device.findMany({
        where: { userId },
        orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      }),
      currentSessionId === null
        ? null
        : this.database.refreshSession.findFirst({
            where: { id: currentSessionId, userId },
            select: { deviceId: true },
          }),
    ]);
    return {
      items: devices.map((device) => ({
        id: device.id,
        platform: device.platform,
        appVersion: device.appVersion,
        locale: device.locale,
        timezone: device.timezone,
        lastSeenAt: device.lastSeenAt.toISOString(),
        current: device.id === currentSession?.deviceId,
      })),
    };
  }

  async delete(
    userId: string,
    deviceId: string,
    requestId: string,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const device = await transaction.device.findFirst({
        where: { id: deviceId, userId },
        select: { id: true },
      });
      if (device === null) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          "DEVICE_NOT_FOUND",
          "The device was not found",
        );
      }
      const now = new Date();
      const revoked = await transaction.refreshSession.updateMany({
        where: { userId, deviceId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.device.delete({ where: { id: deviceId } });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          action: "ACCOUNT_DEVICE_REMOVED",
          targetType: "DEVICE",
          targetId: deviceId,
          requestId,
          metadata: { revokedSessionCount: revoked.count },
        },
      });
    });
  }
}
