import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  type Prisma,
  ReconciliationJobStatus,
  SchedulerDefinitionStatus,
} from "@prisma/client";

import { JsonLoggerService } from "../../common/logging/json-logger.service";
import {
  WorkerBacklogService,
  type WorkerBacklogSnapshot,
} from "../../common/telemetry/worker-backlog.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";

/** How soon the worker polls again after a poll that found work. */
export const POLL_INTERVAL_MS = 2_000;
/**
 * The longest an idle worker waits between polls. A scheduler version changes
 * with a deploy, and a new revision polls as it starts, so an idle worker has
 * nothing to be quick about; but the backlog heartbeat rides on the poll, and
 * the "worker stopped reporting" alert fires after fifteen silent minutes.
 */
export const MAX_IDLE_POLL_INTERVAL_MS = 5 * 60_000;
const PAGE_SIZE = 100;
/** The `queue` label every scheduler-migration gauge, log line and alert is written against. */
const SCHEDULER_MIGRATION_QUEUE = "scheduler-migration";
const UNFINISHED_RUN_STATUSES = [
  ReconciliationJobStatus.PENDING,
  ReconciliationJobStatus.PROCESSING,
];

/**
 * The wait before the next poll. A poll that queued a page keeps the pace; a
 * poll that found nothing doubles the wait, up to the idle ceiling. There is
 * rarely anything to migrate: a new scheduler version is a deploy-time event,
 * and polling an idle queue every two seconds on every instance only kept the
 * database from ever going quiet (#452).
 */
export function nextPollDelay(previousDelayMs: number, queued: number): number {
  if (queued > 0) return POLL_INTERVAL_MS;
  return Math.min(
    Math.max(previousDelayMs, POLL_INTERVAL_MS) * 2,
    MAX_IDLE_POLL_INTERVAL_MS,
  );
}

@Injectable()
export class SchedulerMigrationWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private activeDrain: Promise<number> | undefined;
  private pollDelayMs = POLL_INTERVAL_MS;
  private stopped = false;

  constructor(
    private readonly database: PrismaService,
    private readonly logger: JsonLoggerService,
    private readonly backlog: WorkerBacklogService,
  ) {}

  onModuleInit(): void {
    this.runScheduled();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    await this.activeDrain?.catch(() => undefined);
  }

  /**
   * One poll, then the next one scheduled by what this one found. A timeout
   * chain rather than an interval, because the interval is not fixed; and
   * polls never overlap, so a slow drain delays the next poll instead of
   * queueing behind it.
   */
  private runScheduled(): void {
    void this.backlog.report(SCHEDULER_MIGRATION_QUEUE, () => this.metrics());
    void this.drain()
      .then(
        (queued) => queued,
        (error: unknown) => {
          this.logger.warn({
            message: "Scheduler migration worker poll failed",
            event: "scheduler_migration_worker_poll_failed",
            errorClass: error instanceof Error ? error.name : "UnknownError",
          });
          // A failing database is not hammered either: a failed poll backs
          // off like an idle one.
          return 0;
        },
      )
      .then((queued) => {
        this.pollDelayMs = nextPollDelay(this.pollDelayMs, queued);
        if (this.stopped) return;
        this.timer = setTimeout(() => this.runScheduled(), this.pollDelayMs);
        this.timer.unref();
      });
  }

  /**
   * A migration run is a backlog of one long job rather than of many small ones,
   * so the age reported is time since the run last advanced, not time since it
   * started: a run over millions of card states is legitimately old, and only a
   * run that stopped moving is worth an alert. `processNextPage` writes `status`
   * on every poll it claims a run in, which is what keeps `updatedAt` fresh
   * while work is actually happening.
   */
  async metrics(): Promise<WorkerBacklogSnapshot> {
    const [unfinished, processing, failed, stalest] = await Promise.all([
      this.database.schedulerMigrationRun.count({
        where: { status: { in: UNFINISHED_RUN_STATUSES } },
      }),
      this.database.schedulerMigrationRun.count({
        where: { status: ReconciliationJobStatus.PROCESSING },
      }),
      this.database.schedulerMigrationRun.count({
        where: { status: ReconciliationJobStatus.FAILED },
      }),
      this.database.schedulerMigrationRun.findFirst({
        where: { status: { in: UNFINISHED_RUN_STATUSES } },
        orderBy: { updatedAt: "asc" },
        select: { updatedAt: true },
      }),
    ]);
    return {
      pending: unfinished,
      processing,
      deadLetter: failed,
      oldestPendingAgeMs:
        stalest === null
          ? null
          : Math.max(0, Date.now() - stalest.updatedAt.getTime()),
    };
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
    if (!(await this.hasStateOnAnotherVersion(active.version))) return;
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

  /**
   * Whether any card state is on a version other than `version`, answered from
   * the two ends of the `scheduler_version` index: every state is on `version`
   * exactly when the lowest and the highest version both are. The obvious
   * query, the first state whose version is not `version`, cannot use a btree
   * index for `<>`, and on the common answer — none — it read the whole table.
   */
  private async hasStateOnAnotherVersion(version: string): Promise<boolean> {
    const [range] = await this.database.$queryRaw<
      Array<{ lowest: string | null; highest: string | null }>
    >`
      SELECT
        (SELECT "scheduler_version" FROM "user_card_states"
          ORDER BY "scheduler_version" ASC LIMIT 1) AS "lowest",
        (SELECT "scheduler_version" FROM "user_card_states"
          ORDER BY "scheduler_version" DESC LIMIT 1) AS "highest"
    `;
    if (range === undefined || range.lowest === null) return false;
    return range.lowest !== version || range.highest !== version;
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
      const after: Prisma.UserCardStateWhereInput[] =
        run.afterUserId === null || run.afterLearningCardId === null
          ? []
          : [
              {
                OR: [
                  { userId: { gt: run.afterUserId } },
                  {
                    userId: run.afterUserId,
                    learningCardId: { gt: run.afterLearningCardId },
                  },
                ],
              },
            ];
      const states = await transaction.userCardState.findMany({
        where: {
          AND: [
            // Below or above rather than `not`: two ranges the
            // `scheduler_version` index can serve, where `<>` is a filter
            // over every row the scan passes.
            {
              OR: [
                { schedulerVersion: { lt: run.targetSchedulerVersion } },
                { schedulerVersion: { gt: run.targetSchedulerVersion } },
              ],
            },
            ...after,
          ],
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
