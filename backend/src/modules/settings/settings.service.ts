import { HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma, UserSettings } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import type { UpdateSettingsRequest } from "./settings.request";

export function settingsEtag(version: number): string {
  return `W/"${version}"`;
}

export function serializeSettings(
  settings: UserSettings,
): Record<string, unknown> {
  return {
    sessionSize: settings.sessionSize,
    contentLocale: settings.contentLocale,
    defaultAnswerMode: settings.defaultAnswerMode,
    extraFactTypes: settings.extraFactTypes,
    soundEnabled: settings.soundEnabled,
    hapticsEnabled: settings.hapticsEnabled,
    remindersEnabled: settings.remindersEnabled,
    reminderLocalTime:
      settings.reminderLocalTime === null
        ? null
        : settings.reminderLocalTime.toISOString().slice(11, 16),
    reminderWeekdays: settings.reminderWeekdays,
    desiredRetention: Number(settings.desiredRetention),
    timezone: settings.timezone,
    version: settings.version,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

@Injectable()
export class SettingsService {
  constructor(private readonly database: PrismaService) {}

  async get(userId: string): Promise<UserSettings> {
    return this.database.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async update(
    userId: string,
    version: number,
    update: UpdateSettingsRequest,
    requestId: string,
  ): Promise<UserSettings> {
    return this.database.$transaction(
      async (transaction) => {
        await transaction.userSettings.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        const changed = await transaction.userSettings.updateMany({
          where: { userId, version },
          data: {
            ...(update as Prisma.UserSettingsUpdateManyMutationInput),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          const current = await transaction.userSettings.findUniqueOrThrow({
            where: { userId },
            select: { version: true },
          });
          throw new ApiException(
            HttpStatus.CONFLICT,
            "SETTINGS_VERSION_CONFLICT",
            "Settings were updated on another device",
            { currentVersion: current.version },
          );
        }
        const settings = await transaction.userSettings.findUniqueOrThrow({
          where: { userId },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: userId,
            action: "ACCOUNT_SETTINGS_UPDATED",
            targetType: "USER_SETTINGS",
            targetId: userId,
            requestId,
            metadata: {
              previousVersion: version,
              version: settings.version,
              changedFields: Object.keys(update),
            },
          },
        });
        return settings;
      },
      { isolationLevel: "Serializable" },
    );
  }
}
