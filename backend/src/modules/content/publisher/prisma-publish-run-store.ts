import {
  PublishRunStatus,
  type PrismaClient,
  type PublishRun,
} from "@prisma/client";

import { PUBLISH_STAGES, type PublishRunStore } from "./publish-run-executor";

/**
 * The run record in the database, for the executor.
 *
 * Every write here is conditional on the status the executor believes the
 * run is in. A job can be started twice for the same run — Cloud Run retries
 * an execution whose container exited badly — and the second attempt must
 * find nothing to do rather than restart a twenty-minute transaction beside
 * the first one.
 */
export class PrismaPublishRunStore implements PublishRunStore {
  constructor(private readonly database: PrismaClient) {}

  async claim(
    runId: string | null,
    executionName: string | null,
  ): Promise<PublishRun | null> {
    const id = runId ?? (await this.nextQueuedRunId());
    if (id === null) {
      return null;
    }

    // The claim is the update, not the read above it: `updateMany` with the
    // status in the filter is one statement, so two executors racing for the
    // same row leave exactly one of them with a count of 1.
    const claimed = await this.database.publishRun.updateMany({
      where: { id, status: PublishRunStatus.QUEUED },
      data: {
        status: PublishRunStatus.RUNNING,
        startedAt: new Date(),
        stage: PUBLISH_STAGES.claimed,
        ...(executionName === null ? {} : { executionName }),
      },
    });
    if (claimed.count === 0) {
      return null;
    }
    return this.database.publishRun.findUnique({ where: { id } });
  }

  private async nextQueuedRunId(): Promise<string | null> {
    // Oldest first. There is at most one live run — the partial unique index
    // sees to that — but ordering costs nothing and makes a manual drain of a
    // queue behave the way anyone would expect it to.
    const queued = await this.database.publishRun.findFirst({
      where: { status: PublishRunStatus.QUEUED },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return queued?.id ?? null;
  }

  async recordStage(runId: string, stage: string): Promise<void> {
    // Only while it is still ours. A run cancelled out from under the job
    // should not be dragged back into looking alive by a stage update.
    await this.database.publishRun.updateMany({
      where: { id: runId, status: PublishRunStatus.RUNNING },
      data: { stage },
    });
  }

  async recordSuccess(runId: string): Promise<void> {
    await this.database.publishRun.updateMany({
      where: { id: runId, status: PublishRunStatus.RUNNING },
      data: {
        status: PublishRunStatus.SUCCEEDED,
        stage: PUBLISH_STAGES.done,
        finishedAt: new Date(),
      },
    });
  }

  async recordFailure(
    runId: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.database.publishRun.updateMany({
      where: { id: runId, status: PublishRunStatus.RUNNING },
      data: {
        status: PublishRunStatus.FAILED,
        failureCode: code,
        failureMessage: message,
        finishedAt: new Date(),
      },
    });
  }
}
