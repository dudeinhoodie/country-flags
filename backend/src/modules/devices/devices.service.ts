import { HttpStatus, Injectable } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { inSerializableTransaction } from "../../infrastructure/database/serializable-transaction";

@Injectable()
export class DevicesService {
  constructor(private readonly database: PrismaService) {}

  async list(
    userId: string,
    currentSessionId: string | null,
  ): Promise<Record<string, unknown>> {
    const [devices, currentSession] = await Promise.all([
      this.database.device.findMany({
        where: { userId, deletedAt: null },
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

  /**
   * Removes a device by marking it, never by deleting the row: review events
   * are immutable and reference the device, so a real DELETE would have to
   * rewrite them and PostgreSQL refuses (issue #439).
   *
   * Serializable so a refresh racing the removal cannot leave a live session
   * behind. A rotation revokes one of this device's sessions and creates its
   * successor in one transaction; the revocation below writes that same
   * session row, so whichever side commits second either sees the successor
   * or is aborted and retried from a snapshot that contains it.
   */
  async delete(
    userId: string,
    deviceId: string,
    requestId: string,
  ): Promise<void> {
    await inSerializableTransaction(this.database, async (transaction) => {
      const now = new Date();
      // A device already removed answers like a missing one: from the
      // user's side it is gone, and the second request changed nothing.
      const removed = await transaction.device.updateMany({
        where: { id: deviceId, userId, deletedAt: null },
        // A removed device must not be reached by a notification either.
        data: { deletedAt: now, pushTokenEncrypted: null },
      });
      if (removed.count === 0) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          "DEVICE_NOT_FOUND",
          "The device was not found",
        );
      }
      const revoked = await transaction.refreshSession.updateMany({
        where: { userId, deviceId, revokedAt: null },
        data: { revokedAt: now },
      });
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
