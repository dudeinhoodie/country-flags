import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ContentReleaseStatus,
  PublishRunKind,
  PublishRunStatus,
} from "@prisma/client";
import type { AdminUser, Prisma, PublishRun } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import {
  isExecutorLost,
  lastHeardFrom,
  PUBLISH_RUN_LEASE_MS,
} from "../content/publisher/publish-run-lease";
import { PublisherJobClient } from "./publisher-job.client";

/** What the console asks for when it wants a release published. */
export interface PublishRequest {
  contentVersion: string;
  minimumClientVersion: string;
}

/** What it asks for when it wants the active pointer moved back. */
export interface RollbackRequest {
  toVersion: string;
}

/**
 * Publishing and rolling back as recorded runs (ADR-017).
 *
 * A run is queued, not performed: applying a release is a Serializable
 * transaction with a twenty-minute timeout, which no HTTP request survives.
 * This service owns the record and its rules; the executor that picks the
 * run up is a job with its own service account, its own database rights and
 * the signing key this service never sees.
 *
 * Refusing a second run belongs here rather than to the executor: a request
 * that cannot succeed should be answered now, not after twenty minutes of
 * losing a race over the active pointer.
 */
@Injectable()
export class PublishRunService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly publisher: PublisherJobClient,
  ) {}

  /** The run in flight, if any, and what is live right now. */
  async status(): Promise<{
    activeVersion: string | null;
    executorConfigured: boolean;
    current: PublishRun | null;
    last: PublishRun | null;
  }> {
    const [pointer, current, last] = await this.database.$transaction([
      this.database.contentPointer.findUnique({
        where: { key: "active" },
        select: { contentVersion: true },
      }),
      this.database.publishRun.findFirst({
        where: {
          status: { in: [PublishRunStatus.QUEUED, PublishRunStatus.RUNNING] },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.database.publishRun.findFirst({
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      activeVersion: pointer?.contentVersion ?? null,
      executorConfigured: this.publisher.isConfigured,
      current,
      last,
    };
  }

  /**
   * The releases a rollback may return to, newest first.
   *
   * Only ones this deployment actually applied: a version that exists as a
   * draft row, or that another environment published, is not somewhere the
   * pointer can go. Offering the list rather than a text field is what keeps
   * the screen from inviting a typo that answers 422.
   */
  async listReleases(): Promise<Record<string, unknown>> {
    const [pointer, releases] = await this.database.$transaction([
      this.database.contentPointer.findUnique({
        where: { key: "active" },
        select: { contentVersion: true },
      }),
      this.database.contentRelease.findMany({
        where: {
          status: {
            in: [ContentReleaseStatus.PUBLISHED, ContentReleaseStatus.RETIRED],
          },
          publishedAt: { not: null },
        },
        orderBy: { publishedAt: "desc" },
        take: 50,
        select: {
          version: true,
          status: true,
          publishedAt: true,
          retiredAt: true,
        },
      }),
    ]);
    const active = pointer?.contentVersion ?? null;
    return {
      activeVersion: active,
      releases: releases.map((release) => ({
        version: release.version,
        status: release.status,
        isActive: release.version === active,
        publishedAt: release.publishedAt?.toISOString() ?? null,
        retiredAt: release.retiredAt?.toISOString() ?? null,
      })),
    };
  }

  async get(runId: string): Promise<PublishRun> {
    const run = await this.database.publishRun.findUnique({
      where: { id: runId },
    });
    if (run === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
      );
    }
    return run;
  }

  async publish(
    actor: AdminUser,
    request: PublishRequest,
    requestId: string,
  ): Promise<PublishRun> {
    const active = await this.activeVersion();
    // Republishing the live version is a no-op the publisher reports as
    // success, which teaches an operator that nothing they do matters.
    if (active === request.contentVersion) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "CONTENT_VERSION_ALREADY_ACTIVE",
        `Version ${request.contentVersion} is already the active release; a new release must carry a new version`,
      );
    }
    return this.queue(
      actor,
      {
        kind: PublishRunKind.PUBLISH,
        contentVersion: request.contentVersion,
        minimumClientVersion: request.minimumClientVersion,
        previousVersion: active,
      },
      requestId,
    );
  }

  async rollback(
    actor: AdminUser,
    request: RollbackRequest,
    requestId: string,
  ): Promise<PublishRun> {
    const active = await this.activeVersion();
    if (active === request.toVersion) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "CONTENT_VERSION_ALREADY_ACTIVE",
        `Version ${request.toVersion} is already the active release`,
      );
    }
    // Only a release this deployment actually published: rolling back to a
    // version that was never applied would point clients at nothing.
    const target = await this.database.contentRelease.findUnique({
      where: { version: request.toVersion },
      select: { publishedAt: true },
    });
    if (target === null || target.publishedAt === null) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "CONTENT_VERSION_NOT_PUBLISHED",
        `Version ${request.toVersion} was never published, so there is nothing to return to`,
      );
    }
    return this.queue(
      actor,
      {
        kind: PublishRunKind.ROLLBACK,
        contentVersion: request.toVersion,
        // The release being returned to already carries its own.
        minimumClientVersion: null,
        previousVersion: active,
      },
      requestId,
    );
  }

  private async activeVersion(): Promise<string | null> {
    const pointer = await this.database.contentPointer.findUnique({
      where: { key: "active" },
      select: { contentVersion: true },
    });
    return pointer?.contentVersion ?? null;
  }

  /**
   * Gives up on a run nobody is carrying out.
   *
   * The way out of a stuck slot. A run holds the only live slot (the partial
   * unique index sees to that), so a run nobody finishes would block every
   * release after it, with the database as the only remedy. That is not a
   * state an operator should have to escalate out of. There are two ways to
   * get into it:
   *
   * - A queued run no executor ever picks up. It is cancelled: nothing
   *   happened.
   * - A running run whose job died. A killed job writes nothing on its way
   *   out, so the run would stay `RUNNING` for good (#452). Once its
   *   heartbeat is older than the lease, it is failed with
   *   `PUBLISH_RUN_EXECUTOR_LOST`. Not cancelled, because the job did start,
   *   and the record says what is live now. The release transaction applies
   *   whole or not at all, so the active version is the whole answer.
   *
   * A running run that is still reporting is refused. Its job is alive, and
   * giving up the record under it would leave the two disagreeing about what
   * happened.
   */
  async cancel(
    actor: AdminUser,
    runId: string,
    requestId: string,
  ): Promise<PublishRun> {
    return this.database.$transaction(async (transaction) => {
      const run = await transaction.publishRun.findUnique({
        where: { id: runId },
      });
      if (run === null) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          "RESOURCE_NOT_FOUND",
          "The requested resource was not found",
        );
      }
      if (run.status === PublishRunStatus.RUNNING) {
        return this.abandon(transaction, actor, run, requestId);
      }
      if (run.status !== PublishRunStatus.QUEUED) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "PUBLISH_RUN_NOT_QUEUED",
          `This run is ${run.status.toLowerCase()}, and only a queued run, or a running one whose job stopped reporting, can be given up`,
        );
      }

      const cancelled = await transaction.publishRun.update({
        where: { id: runId },
        data: {
          status: PublishRunStatus.CANCELLED,
          finishedAt: new Date(),
        },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.release.run_cancelled",
        targetType: "publish_run",
        targetId: runId,
        requestId,
        metadata: {
          kind: run.kind,
          contentVersion: run.contentVersion,
        },
      });
      return cancelled;
    });
  }

  /** Fails a running run whose executor has stopped reporting. */
  private async abandon(
    transaction: Prisma.TransactionClient,
    actor: AdminUser,
    run: PublishRun,
    requestId: string,
  ): Promise<PublishRun> {
    const now = new Date();
    if (!isExecutorLost(run, now)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "PUBLISH_RUN_EXECUTOR_ALIVE",
        "The publisher job is still reporting on this run. Wait for it to finish",
        { heartbeatAt: lastHeardFrom(run)?.toISOString() ?? null },
      );
    }

    const pointer = await transaction.contentPointer.findUnique({
      where: { key: "active" },
      select: { contentVersion: true },
    });
    const activeVersion = pointer?.contentVersion ?? null;
    const heard = lastHeardFrom(run);
    // Conditional on the beat just read, not only on the status: a job that
    // reported between that read and this write is alive after all, and the
    // run stays its.
    const abandoned = await transaction.publishRun.updateMany({
      where: {
        id: run.id,
        status: PublishRunStatus.RUNNING,
        heartbeatAt: { lt: new Date(now.getTime() - PUBLISH_RUN_LEASE_MS) },
      },
      data: {
        status: PublishRunStatus.FAILED,
        failureCode: "PUBLISH_RUN_EXECUTOR_LOST",
        failureMessage: `The publisher job stopped reporting${
          heard === null ? "" : ` at ${heard.toISOString()}`
        } without recording an outcome: it was killed or it crashed. The release applies whole or not at all, and the active version is ${
          activeVersion ?? "none"
        }.`,
        finishedAt: now,
      },
    });
    if (abandoned.count === 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "PUBLISH_RUN_EXECUTOR_ALIVE",
        "The publisher job reported on this run just now. Wait for it to finish",
      );
    }

    await this.audit.record(transaction, {
      actorAdminUserId: actor.id,
      action: "admin.release.run_abandoned",
      targetType: "publish_run",
      targetId: run.id,
      requestId,
      metadata: {
        kind: run.kind,
        contentVersion: run.contentVersion,
        lastHeardAt: heard?.toISOString() ?? null,
        activeVersion,
        executionName: run.executionName,
      },
    });
    return (
      (await transaction.publishRun.findUnique({ where: { id: run.id } })) ??
      run
    );
  }

  private async queue(
    actor: AdminUser,
    run: {
      kind: PublishRunKind;
      contentVersion: string;
      minimumClientVersion: string | null;
      previousVersion: string | null;
    },
    requestId: string,
  ): Promise<PublishRun> {
    return this.startExecution(await this.record(actor, run, requestId));
  }

  /**
   * Hands the committed run to the executor (ADR-017 §2).
   *
   * After the commit, never inside it: the job reads the row it was started
   * for, and a row that is still uncommitted is a row it cannot see.
   *
   * A deployment with no job configured leaves the run queued and says so —
   * the console shows that nothing is draining the queue, and cancelling is
   * the way out. A job that refuses to start is different: the run holds the
   * only live slot, and leaving it queued would block every release after it
   * with the database as the only remedy. So it is failed here, with the
   * reason on the record.
   */
  private async startExecution(run: PublishRun): Promise<PublishRun> {
    if (!this.publisher.isConfigured) {
      return run;
    }
    try {
      const executionName = await this.publisher.start(run.id);
      if (executionName.length === 0) {
        return run;
      }
      // Deliberately unguarded by status. An execution can be quick enough
      // to have claimed — or even finished — the run before this write
      // lands, and in every one of those states this is still the execution
      // that ran it, so the handle belongs on the row. `updateMany` rather
      // than `update` because a row that is gone is not worth an exception
      // on a path whose real work has already succeeded.
      await this.database.publishRun.updateMany({
        where: { id: run.id },
        data: { executionName },
      });
      return { ...run, executionName };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.database.publishRun.updateMany({
        // Only while it is still queued: a start that failed on the way back
        // may well have started, and a job already running must not be
        // declared dead by the request that asked for it.
        where: { id: run.id, status: PublishRunStatus.QUEUED },
        data: {
          status: PublishRunStatus.FAILED,
          failureCode: "PUBLISH_RUN_NOT_STARTED",
          failureMessage: message.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
      if (failed.count === 0) {
        return run;
      }
      return (
        (await this.database.publishRun.findUnique({
          where: { id: run.id },
        })) ?? run
      );
    }
  }

  private async record(
    actor: AdminUser,
    run: {
      kind: PublishRunKind;
      contentVersion: string;
      minimumClientVersion: string | null;
      previousVersion: string | null;
    },
    requestId: string,
  ): Promise<PublishRun> {
    return this.database.$transaction(async (transaction) => {
      // The partial unique index refuses a second live run, and this reads
      // it first only to answer with the run already in flight rather than
      // with a constraint violation.
      const inFlight = await transaction.publishRun.findFirst({
        where: {
          status: { in: [PublishRunStatus.QUEUED, PublishRunStatus.RUNNING] },
        },
        select: { id: true, kind: true, contentVersion: true },
      });
      if (inFlight !== null) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "PUBLISH_RUN_IN_FLIGHT",
          "Another release run is already under way; wait for it to finish",
          {
            runId: inFlight.id,
            kind: inFlight.kind,
            contentVersion: inFlight.contentVersion,
          },
        );
      }

      const created = await transaction.publishRun.create({
        data: {
          kind: run.kind,
          contentVersion: run.contentVersion,
          minimumClientVersion: run.minimumClientVersion,
          previousVersion: run.previousVersion,
          requestedByAdminUserId: actor.id,
        },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action:
          run.kind === PublishRunKind.PUBLISH
            ? "admin.release.publish_queued"
            : "admin.release.rollback_queued",
        targetType: "publish_run",
        targetId: created.id,
        requestId,
        metadata: {
          contentVersion: run.contentVersion,
          previousVersion: run.previousVersion,
          ...(run.minimumClientVersion === null
            ? {}
            : { minimumClientVersion: run.minimumClientVersion }),
        },
      });
      return created;
    });
  }
}
