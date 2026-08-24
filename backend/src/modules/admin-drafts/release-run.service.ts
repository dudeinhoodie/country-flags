import { HttpStatus, Injectable } from "@nestjs/common";
import type { AdminUser } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { GitHubClient } from "./github-client";
import type { WorkflowRun } from "./github-client";

export interface PublishRunRequest {
  contentVersion: string;
  minimumClientVersion: string;
}

export interface PublishRunStatus {
  configured: boolean;
  activeVersion: string | null;
  lastRun: WorkflowRun | null;
}

/**
 * The console starts the existing publish workflow and watches it; it never
 * publishes itself. The signing key stays in CI and the twenty-minute
 * serializable transaction stays on a direct database connection, which is
 * the whole reason the release path is two-phase (ADR-014, plan §11).
 */
@Injectable()
export class ReleaseRunService {
  constructor(
    private readonly database: PrismaService,
    private readonly github: GitHubClient,
    private readonly audit: AdminAuditService,
  ) {}

  async status(): Promise<PublishRunStatus> {
    const pointer = await this.database.contentPointer.findUnique({
      where: { key: "active" },
      select: { contentVersion: true },
    });
    return {
      configured: this.github.isConfigured,
      activeVersion: pointer?.contentVersion ?? null,
      lastRun: this.github.isConfigured
        ? await this.github.latestPublishRun()
        : null,
    };
  }

  async start(
    actor: AdminUser,
    request: PublishRunRequest,
    requestId: string,
  ): Promise<PublishRunStatus> {
    const pointer = await this.database.contentPointer.findUnique({
      where: { key: "active" },
      select: { contentVersion: true },
    });
    // Publishing the version that is already active is a no-op the
    // publisher answers with `alreadyPublished`, which reads as success and
    // teaches an operator that nothing they do matters.
    if (pointer?.contentVersion === request.contentVersion) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "VERSION_ALREADY_PUBLISHED",
        `Version ${request.contentVersion} is already the active release; publish a new version instead`,
      );
    }

    await this.github.dispatchPublish(
      request.contentVersion,
      request.minimumClientVersion,
    );
    await this.audit.record(this.database, {
      actorAdminUserId: actor.id,
      action: "admin.release.publish_run_started",
      targetType: "content_release",
      targetId: request.contentVersion,
      requestId,
      metadata: {
        contentVersion: request.contentVersion,
        minimumClientVersion: request.minimumClientVersion,
      },
    });
    return this.status();
  }
}
