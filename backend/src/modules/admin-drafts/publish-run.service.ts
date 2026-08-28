import { HttpStatus, Injectable } from "@nestjs/common";
import { PublishRunKind, PublishRunStatus } from "@prisma/client";
import type { AdminUser, PublishRun } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";

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
  ) {}

  /** The run in flight, if any, and what is live right now. */
  async status(): Promise<{
    activeVersion: string | null;
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
      current,
      last,
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
   * Gives up on a run that is still queued.
   *
   * The way out of a stuck queue. A run holds the only live slot — the
   * partial unique index sees to that — so one that no executor ever picks
   * up would block every release after it, with the database as the only
   * remedy. That is not a state an operator should have to escalate out of.
   *
   * Only a queued run: a running one is a job that has already started, and
   * cancelling the record under it would leave the two disagreeing about
   * what happened. Stopping work in flight is the executor's to offer, and
   * it does not yet.
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
      if (run.status !== PublishRunStatus.QUEUED) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "PUBLISH_RUN_NOT_QUEUED",
          `This run is ${run.status.toLowerCase()}, and only a queued run can be cancelled`,
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
