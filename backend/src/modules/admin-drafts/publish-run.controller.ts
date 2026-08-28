import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminRole } from "@prisma/client";
import type { PublishRun } from "@prisma/client";

import { uuid } from "../../common/http/request-validation";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../admin-auth/admin-auth.guard";
import { assertTrustedAdminOrigin } from "../admin-auth/admin-origin";
import { RequireAdminRole } from "../admin-auth/admin-roles";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import {
  parsePublishRunRequest,
  parseReleaseRollbackRequest,
} from "./admin-drafts.request";
import { PublishRunService } from "./publish-run.service";

/**
 * Publishing and rolling back from the product, as recorded runs (ADR-017).
 *
 * The sibling `ReleaseRunController` dispatches the CI workflow and stays:
 * it is the only path that can publish from an arbitrary commit, and the way
 * in when this contour is broken. These endpoints are the other path — they
 * write a row and return. Nothing here applies a release: the work belongs to
 * an executor with its own database rights and the signing key this service
 * never sees, and the twenty-minute serializable transaction it runs would
 * outlive any request made to this controller.
 *
 * So the answer is 202 with a run, never 200 with a result.
 */
@Controller("admin/content/releases")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class PublishRunController {
  constructor(
    private readonly runs: PublishRunService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  /// Reading is open to every authenticated admin: watching a release is not
  /// the same permission as starting one.
  @Get("runs")
  async listRuns(): Promise<Record<string, unknown>> {
    const state = await this.runs.status();
    return {
      activeVersion: state.activeVersion,
      current: state.current === null ? null : apiRun(state.current),
      last: state.last === null ? null : apiRun(state.last),
    };
  }

  @Get("runs/:runId")
  async getRun(
    @Param("runId") rawRunId: string,
  ): Promise<Record<string, unknown>> {
    return apiRun(await this.runs.get(uuid(rawRunId, "runId")));
  }

  @Post("publish")
  @RequireAdminRole(AdminRole.PUBLISHER)
  @HttpCode(HttpStatus.ACCEPTED)
  async publish(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    const run = await this.runs.publish(
      request.adminUser,
      parsePublishRunRequest(body),
      request.requestId,
    );
    return apiRun(run);
  }

  /// The way out of a queue nothing is draining, which is a state this
  /// deployment can be in for as long as the executor is not there yet.
  @Post("runs/:runId/cancel")
  @RequireAdminRole(AdminRole.PUBLISHER)
  async cancelRun(
    @Req() request: AdminAuthenticatedRequest,
    @Param("runId") rawRunId: string,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    const run = await this.runs.cancel(
      request.adminUser,
      uuid(rawRunId, "runId"),
      request.requestId,
    );
    return apiRun(run);
  }

  @Post("rollback")
  @RequireAdminRole(AdminRole.PUBLISHER)
  @HttpCode(HttpStatus.ACCEPTED)
  async rollback(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    const run = await this.runs.rollback(
      request.adminUser,
      parseReleaseRollbackRequest(body),
      request.requestId,
    );
    return apiRun(run);
  }

  /// Both writes are cross-site targets worth refusing at the door: a
  /// release is not something a page on another origin gets to start.
  private assertConsoleOrigin(request: AdminAuthenticatedRequest): void {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
  }
}

/**
 * The stored run as the contract shapes it.
 *
 * The failure is one object rather than two loose columns, because a code
 * without its message is not something a screen can show, and the record
 * has both or neither.
 */
function apiRun(run: PublishRun): Record<string, unknown> {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    contentVersion: run.contentVersion,
    minimumClientVersion: run.minimumClientVersion,
    previousVersion: run.previousVersion,
    stage: run.stage,
    failure:
      run.failureCode === null
        ? null
        : {
            code: run.failureCode,
            message: run.failureMessage ?? "",
          },
    executionName: run.executionName,
    requestedByAdminUserId: run.requestedByAdminUserId,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
