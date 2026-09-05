import { Injectable } from "@nestjs/common";
import { Prisma, StoreNotificationStatus, StoreProvider } from "@prisma/client";

import { JsonLoggerService } from "../../../common/logging/json-logger.service";
import { MetricsService } from "../../../common/telemetry/metrics.service";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { EntitlementService } from "../entitlement.service";
import { AppleNotificationVerifier } from "./apple-notification-verifier";
import type { VerifiedAppleNotification } from "./apple-notification-verifier";

/**
 * The notification types this version acts on.
 *
 * `REFUND` and `REFUND_REVERSED` are the reason this endpoint exists: a
 * refund arrives from Apple, not from the app, and without this path a
 * refunded customer keeps studying a deck they no longer own. `REVOKE` is
 * Family Sharing's withdrawal — off in this version, and recorded anyway so
 * that turning it on later finds a ledger that already understands it.
 * `TEST` is what an operator sends from App Store Connect to prove the URL
 * is right.
 */
const ACTED_ON = new Set([
  "ONE_TIME_CHARGE",
  "REFUND",
  "REFUND_REVERSED",
  "REVOKE",
]);
const TEST = "TEST";

/** Why a notification was recorded but not acted on. */
export type QuarantineReason =
  | "NO_TRANSACTION"
  | "TRANSACTION_REFUSED"
  | "UNKNOWN_PRODUCT"
  | "UNKNOWN_ACCOUNT"
  | "UNHANDLED_TYPE";

export type NotificationOutcome =
  | "processed"
  | "duplicate"
  | { quarantined: QuarantineReason };

/**
 * Apple's own path into the system.
 *
 * Three things make it safe to expose without a session. The signature is
 * checked before anything is written, so an unsigned body leaves no trace.
 * The notification's uuid is unique in the ledger, so Apple's retries — and
 * Apple does retry — land exactly once. And anything this deployment does
 * not recognise is quarantined with a reason rather than dropped, because a
 * refund nobody noticed is the failure this endpoint exists to prevent.
 */
@Injectable()
export class AppleNotificationService {
  constructor(
    private readonly database: PrismaService,
    private readonly verifier: AppleNotificationVerifier,
    private readonly entitlements: EntitlementService,
    private readonly logger: JsonLoggerService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Records a verified notification and acts on it.
   *
   * The caller has already established the signature: by the time anything
   * here runs, Apple said this, about this app, in this store.
   */
  async receive(
    notification: VerifiedAppleNotification,
    requestId: string,
  ): Promise<NotificationOutcome> {
    const existing = await this.database.storeNotification.findUnique({
      where: { notificationUuid: notification.notificationUuid },
      select: { id: true, status: true },
    });
    if (
      existing !== null &&
      existing.status !== StoreNotificationStatus.RECEIVED
    ) {
      // Apple retries until it is acknowledged, and a retry of something
      // already settled must change nothing at all.
      this.metrics.recordStoreNotification("duplicate");
      return "duplicate";
    }

    const row =
      existing ??
      (await this.record(notification, StoreNotificationStatus.RECEIVED));

    const outcome = await this.act(notification, requestId);
    if (outcome === "processed") {
      await this.settle(row.id, StoreNotificationStatus.PROCESSED, null);
      this.metrics.recordStoreNotification("processed");
      this.logger.log({
        message: "Store notification processed",
        event: "store_notification_processed",
        requestId,
        notificationType: notification.notificationType,
        ...(notification.subtype === null
          ? {}
          : { subtype: notification.subtype }),
      });
      return outcome;
    }

    const reason = outcome.quarantined;
    await this.settle(row.id, StoreNotificationStatus.QUARANTINED, reason);
    this.metrics.recordStoreNotification("quarantined");
    // Warn rather than error: nothing is broken, but somebody has to look —
    // an unknown product in production means the catalog and App Store
    // Connect disagree, and that is exactly the alert §17.1 asks for.
    this.logger.warn({
      message: "Store notification quarantined",
      event: "store_notification_quarantined",
      requestId,
      notificationType: notification.notificationType,
      ...(notification.subtype === null
        ? {}
        : { subtype: notification.subtype }),
      reason,
    });
    return outcome;
  }

  private async act(
    notification: VerifiedAppleNotification,
    requestId: string,
  ): Promise<"processed" | { quarantined: QuarantineReason }> {
    if (notification.notificationType === TEST) {
      return "processed";
    }
    if (!ACTED_ON.has(notification.notificationType)) {
      // Subscriptions, price consent, everything this product does not sell.
      // Recorded so the history is complete, and acted on by nobody.
      return { quarantined: "UNHANDLED_TYPE" };
    }
    if (notification.transactionRefusal !== null) {
      return { quarantined: "TRANSACTION_REFUSED" };
    }
    const purchase = notification.transaction;
    if (purchase === null) {
      return { quarantined: "NO_TRANSACTION" };
    }

    const applied = await this.entitlements.applyFromNotification(
      purchase,
      requestId,
    );
    return applied === "applied" ? "processed" : { quarantined: applied };
  }

  private async record(
    notification: VerifiedAppleNotification,
    status: StoreNotificationStatus,
  ): Promise<{ id: string }> {
    try {
      return await this.database.storeNotification.create({
        data: {
          provider: StoreProvider.APPLE_APP_STORE,
          storeEnvironment: this.verifier.storeEnvironment,
          notificationUuid: notification.notificationUuid,
          notificationType: notification.notificationType,
          subtype: notification.subtype,
          signedDate: notification.signedDate,
          payloadHash: notification.payloadHash,
          status,
        },
        select: { id: true },
      });
    } catch (error) {
      // Two deliveries of the same notification at once: the unique key is
      // what settles it, and the row the other request created is the row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return this.database.storeNotification.findUniqueOrThrow({
          where: { notificationUuid: notification.notificationUuid },
          select: { id: true },
        });
      }
      throw error;
    }
  }

  private async settle(
    id: string,
    status: StoreNotificationStatus,
    error: string | null,
  ): Promise<void> {
    await this.database.storeNotification.update({
      where: { id },
      data: { status, error, processedAt: new Date() },
    });
  }
}
