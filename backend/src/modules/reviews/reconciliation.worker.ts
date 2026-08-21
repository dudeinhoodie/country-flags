import { randomUUID } from "node:crypto";

import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ReconciliationJobStatus } from "@prisma/client";

import { JsonLoggerService } from "../../common/logging/json-logger.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { ProgressService } from "../progress/progress.service";
import { ReviewsService } from "./reviews.service";

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 1_000;
const LEASE_MS = 5 * 60 * 1_000;

interface ClaimedJob {
  id: string;
  userId: string;
  learningCardId: string;
  targetSchedulerVersion: string;
  attemptCount: number;
  leaseToken: string;
}

@Injectable()
export class ReconciliationWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private activeDrain: Promise<number> | undefined;

  constructor(
    private readonly database: PrismaService,
    private readonly reviews: ReviewsService,
    private readonly progress: ProgressService,
    private readonly logger: JsonLoggerService,
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
        message: "Reconciliation worker poll failed",
        event: "reconciliation_worker_poll_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }

  async drain(limit = 25): Promise<number> {
    if (this.activeDrain !== undefined) return this.activeDrain;
    const activeDrain = this.drainClaimed(limit);
    this.activeDrain = activeDrain;
    try {
      // Awaited rather than returned bare, so the cleanup below runs after the
      // drain rather than while it is still going.
      return await activeDrain;
    } finally {
      if (this.activeDrain === activeDrain) this.activeDrain = undefined;
    }
  }

  private async drainClaimed(limit: number): Promise<number> {
    let processed = 0;
    while (processed < limit) {
      const job = await this.claim();
      if (job === null) {
        break;
      }
      try {
        await this.reviews.reconcileCard(
          job.id,
          job.userId,
          job.learningCardId,
          job.targetSchedulerVersion,
          job.leaseToken,
        );
      } catch (error) {
        await this.retryOrDeadLetter(job, error);
        processed += 1;
        continue;
      }
      try {
        await this.progress.rebuildUser(job.userId);
      } catch (error) {
        this.logger.warn({
          message: "Progress rebuild failed after reconciliation",
          event: "reconciliation_progress_rebuild_failed",
          reconciliationJobId: job.id,
          errorClass: error instanceof Error ? error.name : "UnknownError",
        });
      }
      processed += 1;
    }
    return processed;
  }

  async metrics(): Promise<Record<string, number | null>> {
    const [pending, processing, failed, oldest] = await Promise.all([
      this.database.reconciliationJob.count({
        where: { status: ReconciliationJobStatus.PENDING },
      }),
      this.database.reconciliationJob.count({
        where: { status: ReconciliationJobStatus.PROCESSING },
      }),
      this.database.reconciliationJob.count({
        where: { status: ReconciliationJobStatus.FAILED },
      }),
      this.database.reconciliationJob.findFirst({
        where: { status: ReconciliationJobStatus.PENDING },
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

  private async claim(): Promise<ClaimedJob | null> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const rows = await this.database.$queryRaw<ClaimedJob[]>`
      WITH candidate AS (
        SELECT "id"
        FROM "reconciliation_jobs"
        WHERE (
          "status" = 'PENDING'
          AND "available_at" <= ${now}
        ) OR (
          "status" = 'PROCESSING'
          AND "lease_expires_at" <= ${now}
        )
        ORDER BY "created_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "reconciliation_jobs" AS job
      SET
        "status" = 'PROCESSING',
        "attempt_count" = job."attempt_count" + 1,
        "lease_token" = ${leaseToken}::uuid,
        "lease_expires_at" = ${leaseExpiresAt},
        "updated_at" = ${now}
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING
        job."id",
        job."user_id" AS "userId",
        job."learning_card_id" AS "learningCardId",
        job."target_scheduler_version" AS "targetSchedulerVersion",
        job."attempt_count" AS "attemptCount",
        job."lease_token"::text AS "leaseToken"
    `;
    return rows[0] ?? null;
  }

  private async retryOrDeadLetter(
    job: ClaimedJob,
    error: unknown,
  ): Promise<void> {
    const failed = job.attemptCount >= MAX_ATTEMPTS;
    const now = new Date();
    const errorCode = error instanceof Error ? error.name : "UnknownError";
    const released = await this.database.reconciliationJob.updateMany({
      where: {
        id: job.id,
        status: ReconciliationJobStatus.PROCESSING,
        leaseToken: job.leaseToken,
      },
      data: {
        status: failed
          ? ReconciliationJobStatus.FAILED
          : ReconciliationJobStatus.PENDING,
        availableAt: failed
          ? now
          : new Date(now.getTime() + 2 ** (job.attemptCount - 1) * 1_000),
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        deadLetteredAt: failed ? now : null,
      },
    });
    if (released.count !== 1) {
      return;
    }
    this.logger.warn({
      message: failed
        ? "Reconciliation job moved to dead letter"
        : "Reconciliation job will be retried",
      event: failed
        ? "reconciliation_job_dead_lettered"
        : "reconciliation_job_retry_scheduled",
      reconciliationJobId: job.id,
      attemptCount: job.attemptCount,
      errorClass: errorCode,
    });
  }
}
