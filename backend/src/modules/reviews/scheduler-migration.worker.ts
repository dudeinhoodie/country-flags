import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  ReconciliationJobStatus,
  SchedulerDefinitionStatus,
} from "@prisma/client";

import { JsonLoggerService } from "../../common/logging/json-logger.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";

const POLL_INTERVAL_MS = 2_000;
const PAGE_SIZE = 100;

@Injectable()
export class SchedulerMigrationWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private activeDrain: Promise<number> | undefined;

  constructor(
    private readonly database: PrismaService,
    private readonly logger: JsonLoggerService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.runScheduled(), POLL_INTERVAL_MS);
    this.timer.unref();
    this.runScheduled();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    await this.activeDrain?.catch(() => undefined);
  }

  private runScheduled(): void {
    void this.drain().catch((error: unknown) => {
      this.logger.warn({
        message: "Scheduler migration worker poll failed",
        event: "scheduler_migration_worker_poll_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }

  async drain(): Promise<number> {
    if (this.activeDrain !== undefined) return this.activeDrain;
    const activeDrain = this.drainOnce();
    this.activeDrain = activeDrain;
    try {
      return await activeDrain;
    } finally {
      if (this.activeDrain === activeDrain) this.activeDrain = undefined;
    }
  }

  private async drainOnce(): Promise<number> {
    await this.ensureRunForActiveScheduler();
    return this.processNextPage();
  }

  private async ensureRunForActiveScheduler(): Promise<void> {
    const active = await this.database.schedulerDefinition.findFirst({
      where: { status: SchedulerDefinitionStatus.ACTIVE },
      select: { version: true },
    });
    if (active === null) return;
    const mismatchedState = await this.database.userCardState.findFirst({
      where: { schedulerVersion: { not: active.version } },
      select: { userId: true },
    });
    if (mismatchedState === null) return;
    const existing = await this.database.schedulerMigrationRun.findUnique({
      where: { targetSchedulerVersion: active.version },
    });
    if (existing === null) {
      await this.database.schedulerMigrationRun.create({
        data: { targetSchedulerVersion: active.version },
      });
    } else if (existing.status === ReconciliationJobStatus.COMPLETED) {
      await this.database.schedulerMigrationRun.update({
        where: { id: existing.id },
        data: {
          status: ReconciliationJobStatus.PENDING,
          afterUserId: null,
          afterLearningCardId: null,
          completedAt: null,
        },
      });
    }
  }

  private async processNextPage(): Promise<number> {
    return this.database.$transaction(async (transaction) => {
      const runs = await transaction.$queryRaw<
        Array<{
          id: string;
          targetSchedulerVersion: string;
          afterUserId: string | null;
          afterLearningCardId: string | null;
        }>
      >`
        SELECT "id",
          "target_scheduler_version" AS "targetSchedulerVersion",
          "after_user_id"::text AS "afterUserId",
          "after_learning_card_id"::text AS "afterLearningCardId"
        FROM "scheduler_migration_runs"
        WHERE "status" IN ('PENDING', 'PROCESSING')
        ORDER BY "created_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const run = runs[0];
      if (run === undefined) return 0;

      await transaction.schedulerMigrationRun.update({
        where: { id: run.id },
        data: { status: ReconciliationJobStatus.PROCESSING },
      });
      const after =
        run.afterUserId === null || run.afterLearningCardId === null
          ? undefined
          : {
              OR: [
                { userId: { gt: run.afterUserId } },
                {
                  userId: run.afterUserId,
                  learningCardId: { gt: run.afterLearningCardId },
                },
              ],
            };
      const states = await transaction.userCardState.findMany({
        where: {
          schedulerVersion: { not: run.targetSchedulerVersion },
          ...after,
        },
        orderBy: [{ userId: "asc" }, { learningCardId: "asc" }],
        take: PAGE_SIZE,
        select: { userId: true, learningCardId: true },
      });

      if (states.length > 0) {
        await transaction.reconciliationJob.createMany({
          data: states.map((state) => ({
            userId: state.userId,
            learningCardId: state.learningCardId,
            targetSchedulerVersion: run.targetSchedulerVersion,
            reason: "SCHEDULER_MIGRATION",
          })),
          skipDuplicates: true,
        });
        const last = states.at(-1)!;
        await transaction.schedulerMigrationRun.update({
          where: { id: run.id },
          data: {
            afterUserId: last.userId,
            afterLearningCardId: last.learningCardId,
          },
        });
        return states.length;
      }

      const [activeJobs, failedJobs] = await Promise.all([
        transaction.reconciliationJob.count({
          where: {
            targetSchedulerVersion: run.targetSchedulerVersion,
            status: {
              in: [
                ReconciliationJobStatus.PENDING,
                ReconciliationJobStatus.PROCESSING,
              ],
            },
          },
        }),
        transaction.reconciliationJob.count({
          where: {
            targetSchedulerVersion: run.targetSchedulerVersion,
            status: ReconciliationJobStatus.FAILED,
          },
        }),
      ]);
      if (activeJobs > 0) return 0;
      await transaction.schedulerMigrationRun.update({
        where: { id: run.id },
        data:
          failedJobs > 0
            ? { status: ReconciliationJobStatus.FAILED }
            : {
                status: ReconciliationJobStatus.COMPLETED,
                completedAt: new Date(),
              },
      });
      return 0;
    });
  }
}
