import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminRole } from "@prisma/client";

import type { EnvironmentVariables } from "../../config/environment.validation";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../admin-auth/admin-auth.guard";
import { assertTrustedAdminOrigin } from "../admin-auth/admin-origin";
import { RequireAdminRole } from "../admin-auth/admin-roles";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import { parsePublishRunRequest } from "./admin-drafts.request";
import { ReleaseRunService } from "./release-run.service";

@Controller("admin/content/releases")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class ReleaseRunController {
  constructor(
    private readonly releases: ReleaseRunService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  @Get("publish-run")
  status(): Promise<Record<string, unknown>> {
    return this.releases.status() as unknown as Promise<
      Record<string, unknown>
    >;
  }

  /**
   * Starting a release is deliberately a separate action from proposing
   * one: a merged pull request changes the catalog, a publish run changes
   * what every client reads.
   */
  @Post("publish-run")
  @RequireAdminRole(AdminRole.PUBLISHER)
  @HttpCode(HttpStatus.ACCEPTED)
  async start(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
    const parsed = parsePublishRunRequest(body);
    const status = await this.releases.start(
      request.adminUser,
      parsed,
      request.requestId,
    );
    return status as unknown as Record<string, unknown>;
  }
}
