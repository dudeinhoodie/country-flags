import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ConsentCategory,
  ConsentSource,
  ConsentStatus,
  OutboxDeliveryStatus,
  type Prisma,
  type UserPrivacySettings,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { lockAccountForWrite } from "../users/account-write-guard";
import type { UpdatePrivacySettingsRequest } from "./privacy-settings.request";

export const CURRENT_PRIVACY_POLICY_VERSION = "privacy-policy-v1";

export function privacySettingsEtag(version: number): string {
  return `W/"${version}"`;
}

export function serializePrivacySettings(
  settings: UserPrivacySettings,
): Record<string, unknown> {
  return {
    productAnalyticsStatus: settings.productAnalyticsStatus,
    diagnosticsStatus: settings.diagnosticsStatus,
    policyVersion: settings.policyVersion,
    version: settings.version,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

@Injectable()
export class PrivacySettingsService {
  constructor(private readonly database: PrismaService) {}

  async get(userId: string): Promise<UserPrivacySettings> {
    // The read creates the defaults, so it is a write like any other and
    // must not bring an erased account's privacy record back.
    return this.database.$transaction(async (transaction) => {
      await lockAccountForWrite(transaction, userId);
      return transaction.userPrivacySettings.upsert({
        where: { userId },
        create: { userId, policyVersion: CURRENT_PRIVACY_POLICY_VERSION },
        update: {},
      });
    });
  }

  async update(
    userId: string,
    version: number,
    update: UpdatePrivacySettingsRequest,
  ): Promise<UserPrivacySettings> {
    return this.database.$transaction(
      async (transaction) => {
        const before = await transaction.userPrivacySettings.upsert({
          where: { userId },
          create: { userId, policyVersion: CURRENT_PRIVACY_POLICY_VERSION },
          update: {},
        });

        const changed = await transaction.userPrivacySettings.updateMany({
          where: { userId, version },
          data: { ...update, version: { increment: 1 } },
        });
        if (changed.count !== 1) {
          const current =
            await transaction.userPrivacySettings.findUniqueOrThrow({
              where: { userId },
              select: { version: true },
            });
          throw new ApiException(
            HttpStatus.CONFLICT,
            "PRIVACY_SETTINGS_VERSION_CONFLICT",
            "Privacy settings were updated on another device",
            { currentVersion: current.version },
          );
        }

        const after = await transaction.userPrivacySettings.findUniqueOrThrow({
          where: { userId },
        });

        await this.recordConsentChanges(transaction, userId, before, after);

        // Product events are forwarded only under GRANTED, so any move away
        // from it — a denial, or a step back to UNKNOWN or NOT_REQUIRED —
        // withdraws everything still queued but not yet delivered.
        if (
          after.productAnalyticsStatus !== ConsentStatus.GRANTED &&
          after.productAnalyticsStatus !== before.productAnalyticsStatus
        ) {
          await transaction.analyticsOutboxEvent.deleteMany({
            where: {
              analyticsSubjectId: userId,
              consentCategory: ConsentCategory.PRODUCT_ANALYTICS,
              deliveryStatus: OutboxDeliveryStatus.PENDING,
            },
          });
        }

        return after;
      },
      { isolationLevel: "Serializable" },
    );
  }

  private async recordConsentChanges(
    transaction: Prisma.TransactionClient,
    userId: string,
    before: UserPrivacySettings,
    after: UserPrivacySettings,
  ): Promise<void> {
    const changes: {
      category: ConsentCategory;
      previousStatus: ConsentStatus;
      newStatus: ConsentStatus;
    }[] = [];
    if (before.productAnalyticsStatus !== after.productAnalyticsStatus) {
      changes.push({
        category: ConsentCategory.PRODUCT_ANALYTICS,
        previousStatus: before.productAnalyticsStatus,
        newStatus: after.productAnalyticsStatus,
      });
    }
    if (before.diagnosticsStatus !== after.diagnosticsStatus) {
      changes.push({
        category: ConsentCategory.DIAGNOSTICS,
        previousStatus: before.diagnosticsStatus,
        newStatus: after.diagnosticsStatus,
      });
    }
    for (const change of changes) {
      await transaction.privacyConsentEvent.create({
        data: {
          userId,
          category: change.category,
          previousStatus: change.previousStatus,
          newStatus: change.newStatus,
          policyVersion: after.policyVersion,
          // No client platform is carried on this request; the generic API
          // boundary is the closest available source until one is added.
          source: ConsentSource.WEB,
        },
      });
    }
  }
}
