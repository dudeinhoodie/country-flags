import { randomUUID } from "node:crypto";

import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { OutboxDeliveryStatus, type Prisma } from "@prisma/client";

import { JsonLoggerService } from "../../common/logging/json-logger.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  LEARNING_EVENT_PUBLISHER,
  type LearningEventPublisher,
} from "./learning-event-publisher";

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 1_000;
const LEASE_MS = 5 * 60 * 1_000;

interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  occurredAt: Date;
  payload: Prisma.JsonValue;
  attemptCount: number;
  leaseToken: string;
}

@Injectable()
export class LearningOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private activeDrain: Promise<number> | undefined;

  constructor(
    private readonly database: PrismaService,
    private readonly logger: JsonLoggerService,
    @Inject(LEARNING_EVENT_PUBLISHER)
    private readonly publisher: LearningEventPublisher,
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
        message: "Learning outbox worker poll failed",
        event: "learning_outbox_worker_poll_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
    });
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
        await this.publisher.publish(event);
        await this.database.learningOutboxEvent.updateMany({
          where: {
            id: event.id,
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

  async metrics(): Promise<Record<string, number | null>> {
    const [pending, processing, failed, oldest] = await Promise.all([
      this.database.learningOutboxEvent.count({
        where: { deliveryStatus: OutboxDeliveryStatus.PENDING },
      }),
      this.database.learningOutboxEvent.count({
        where: { deliveryStatus: OutboxDeliveryStatus.PROCESSING },
      }),
      this.database.learningOutboxEvent.count({
        where: { deliveryStatus: OutboxDeliveryStatus.FAILED },
      }),
      this.database.learningOutboxEvent.findFirst({
        where: { deliveryStatus: OutboxDeliveryStatus.PENDING },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    return {
      pending,
      processing,
      deadLetter: failed,
      oldestPendingAgeMs:
        oldest === null
          ? null
          : Math.max(0, Date.now() - oldest.createdAt.getTime()),
    };
  }

  private async claim(): Promise<ClaimedOutboxEvent | null> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const rows = await this.database.$queryRaw<ClaimedOutboxEvent[]>`
      WITH candidate AS (
        SELECT "id"
        FROM "learning_outbox"
        WHERE (
          "delivery_status" = 'PENDING'
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
        ) OR (
          "delivery_status" = 'PROCESSING'
          AND "lease_expires_at" <= ${now}
        )
        ORDER BY "created_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "learning_outbox" AS event
      SET
        "delivery_status" = 'PROCESSING',
        "attempt_count" = event."attempt_count" + 1,
        "lease_token" = ${leaseToken}::uuid,
        "lease_expires_at" = ${leaseExpiresAt}
      FROM candidate
      WHERE event."id" = candidate."id"
      RETURNING
        event."id",
        event."event_type" AS "eventType",
        event."occurred_at" AS "occurredAt",
        event."payload",
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
    const released = await this.database.learningOutboxEvent.updateMany({
      where: {
        id: event.id,
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
        ? "Learning outbox event moved to dead letter"
        : "Learning outbox delivery will be retried",
      event: failed
        ? "learning_outbox_dead_lettered"
        : "learning_outbox_retry_scheduled",
      outboxEventId: event.id,
      attemptCount: event.attemptCount,
      errorClass: errorCode,
    });
  }
}
