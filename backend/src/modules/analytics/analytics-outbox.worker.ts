import { randomUUID } from "node:crypto";

import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  ConsentCategory,
  OutboxDeliveryStatus,
  type Prisma,
} from "@prisma/client";

import { JsonLoggerService } from "../../common/logging/json-logger.service";
import {
  WorkerBacklogService,
  type WorkerBacklogSnapshot,
} from "../../common/telemetry/worker-backlog.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  ANALYTICS_EXPORTER,
  type AnalyticsExporter,
} from "./analytics-exporter";

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 1_000;
const LEASE_MS = 5 * 60 * 1_000;
const DELIVERED_RETENTION_MS = 60 * 60 * 1_000;
/** The `queue` label every analytics-outbox gauge, log line and alert is written against. */
const ANALYTICS_OUTBOX_QUEUE = "analytics";

interface ClaimedOutboxEvent {
  eventId: string;
  eventName: string;
  schemaVersion: number;
  occurredAt: Date;
  analyticsSubjectId: string | null;
  anonymousId: string | null;
  consentCategory: ConsentCategory;
  properties: Prisma.JsonValue;
  context: Prisma.JsonValue;
  attemptCount: number;
  leaseToken: string;
}

@Injectable()
export class AnalyticsOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private activeDrain: Promise<number> | undefined;

  constructor(
    private readonly database: PrismaService,
    private readonly logger: JsonLoggerService,
    private readonly backlog: WorkerBacklogService,
    @Inject(ANALYTICS_EXPORTER)
    private readonly exporter: AnalyticsExporter,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.runScheduled(), POLL_INTERVAL_MS);
    this.timer.unref();
    this.runScheduled();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
    await this.activeDrain?.catch(() => undefined);
  }

  private runScheduled(): void {
    void this.drain().catch((error: unknown) => {
      this.logger.warn({
        message: "Analytics outbox worker poll failed",
        event: "analytics_outbox_worker_poll_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
    });
    void this.reportBacklog().catch(() => undefined);
    void this.expireDelivered().catch(() => undefined);
  }

  async drain(limit = 100): Promise<number> {
    if (this.activeDrain !== undefined) return this.activeDrain;
    const activeDrain = this.drainClaimed(limit);
    this.activeDrain = activeDrain;
    try {
      return await activeDrain;
    } finally {
      if (this.activeDrain === activeDrain) this.activeDrain = undefined;
    }
  }

  private async drainClaimed(limit: number): Promise<number> {
    let processed = 0;
    while (processed < limit) {
      const event = await this.claim();
      if (event === null) {
        break;
      }
      try {
        await this.exporter.publish({
          eventId: event.eventId,
          eventName: event.eventName,
          schemaVersion: event.schemaVersion,
          occurredAt: event.occurredAt,
          analyticsSubjectId: event.analyticsSubjectId,
          anonymousId: event.anonymousId,
          consentCategory: event.consentCategory,
          properties: event.properties,
          context: event.context,
        });
        await this.database.analyticsOutboxEvent.updateMany({
          where: {
            eventId: event.eventId,
            deliveryStatus: OutboxDeliveryStatus.PROCESSING,
            leaseToken: event.leaseToken,
          },
          data: {
            deliveryStatus: OutboxDeliveryStatus.DELIVERED,
            deliveredAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            lastErrorCode: null,
          },
        });
      } catch (error) {
        await this.retryOrDeadLetter(event, error);
      }
      processed += 1;
    }
    return processed;
  }

  /** Delivered rows expire quickly — nothing about them needs to be queryable once handed off. */
  private async expireDelivered(): Promise<void> {
    await this.database.analyticsOutboxEvent.deleteMany({
      where: {
        deliveryStatus: OutboxDeliveryStatus.DELIVERED,
        deliveredAt: { lte: new Date(Date.now() - DELIVERED_RETENTION_MS) },
      },
    });
  }

  async metrics(): Promise<WorkerBacklogSnapshot> {
    const [pending, processing, failed, oldest] = await Promise.all([
      this.database.analyticsOutboxEvent.count({
        where: { deliveryStatus: OutboxDeliveryStatus.PENDING },
      }),
      this.database.analyticsOutboxEvent.count({
        where: { deliveryStatus: OutboxDeliveryStatus.PROCESSING },
      }),
      this.database.analyticsOutboxEvent.count({
        where: { deliveryStatus: OutboxDeliveryStatus.FAILED },
      }),
      this.database.analyticsOutboxEvent.findFirst({
        where: { deliveryStatus: OutboxDeliveryStatus.PENDING },
        orderBy: { receivedAt: "asc" },
        select: { receivedAt: true },
      }),
    ]);
    return {
      pending,
      processing,
      deadLetter: failed,
      oldestPendingAgeMs:
        oldest === null
          ? null
          : Math.max(0, Date.now() - oldest.receivedAt.getTime()),
    };
  }

  private async reportBacklog(): Promise<void> {
    this.backlog.report(ANALYTICS_OUTBOX_QUEUE, await this.metrics());
  }

  private async claim(): Promise<ClaimedOutboxEvent | null> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const rows = await this.database.$queryRaw<ClaimedOutboxEvent[]>`
      WITH candidate AS (
        SELECT "event_id"
        FROM "analytics_outbox"
        WHERE (
          "delivery_status" = 'PENDING'
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
        ) OR (
          "delivery_status" = 'PROCESSING'
          AND "lease_expires_at" <= ${now}
        )
        ORDER BY "received_at" ASC, "event_id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "analytics_outbox" AS event
      SET
        "delivery_status" = 'PROCESSING',
        "attempt_count" = event."attempt_count" + 1,
        "lease_token" = ${leaseToken}::uuid,
        "lease_expires_at" = ${leaseExpiresAt}
      FROM candidate
      WHERE event."event_id" = candidate."event_id"
      RETURNING
        event."event_id" AS "eventId",
        event."event_name" AS "eventName",
        event."schema_version" AS "schemaVersion",
        event."occurred_at" AS "occurredAt",
        event."analytics_subject_id" AS "analyticsSubjectId",
        event."anonymous_id" AS "anonymousId",
        event."consent_category" AS "consentCategory",
        event."properties",
        event."context",
        event."attempt_count" AS "attemptCount",
        event."lease_token"::text AS "leaseToken"
    `;
    return rows[0] ?? null;
  }

  private async retryOrDeadLetter(
    event: ClaimedOutboxEvent,
    error: unknown,
  ): Promise<void> {
    const failed = event.attemptCount >= MAX_ATTEMPTS;
    const now = new Date();
    const errorCode = error instanceof Error ? error.name : "UnknownError";
    const released = await this.database.analyticsOutboxEvent.updateMany({
      where: {
        eventId: event.eventId,
        deliveryStatus: OutboxDeliveryStatus.PROCESSING,
        leaseToken: event.leaseToken,
      },
      data: {
        deliveryStatus: failed
          ? OutboxDeliveryStatus.FAILED
          : OutboxDeliveryStatus.PENDING,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        nextAttemptAt: failed
          ? null
          : new Date(now.getTime() + 2 ** (event.attemptCount - 1) * 1_000),
      },
    });
    if (released.count !== 1) {
      return;
    }
    this.logger.warn({
      message: failed
        ? "Analytics outbox event moved to dead letter"
        : "Analytics outbox delivery will be retried",
      event: failed
        ? "analytics_outbox_dead_lettered"
        : "analytics_outbox_retry_scheduled",
      outboxEventId: event.eventId,
      attemptCount: event.attemptCount,
      errorClass: errorCode,
    });
  }
}
