import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminRole } from "@prisma/client";
import { ConfigService } from "@nestjs/config";

import { uuid } from "../../common/http/request-validation";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { AdminAuthGuard } from "./admin-auth.guard";
import type { AdminAuthenticatedRequest } from "./admin-auth.guard";
import { assertTrustedAdminOrigin } from "./admin-origin";
import { RequireAdminRole } from "./admin-roles";
import { AdminRolesGuard } from "./admin-roles.guard";
import { toAdminUserResponse } from "./admin-user.response";
import {
  parseAdminListQuery,
  parseAdminUserUpdateRequest,
} from "./admin-users.request";
import { AdminUsersService } from "./admin-users.service";

/**
 * Access management is the ADMIN role's whole purpose (§10.2): even the
 * read side stays behind it, because the admin roster is nobody else's
 * business.
 */
@Controller("admin/users")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@RequireAdminRole(AdminRole.ADMIN)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  @Get()
  async list(
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    const { offset, limit } = parseAdminListQuery(request.query);
    const { items, total } = await this.users.list(offset, limit);
    return { items: items.map(toAdminUserResponse), total };
  }

  @Get(":adminUserId")
  async getOne(
    @Param("adminUserId") rawAdminUserId: string,
  ): Promise<Record<string, unknown>> {
    const adminUserId = uuid(rawAdminUserId, "adminUserId");
    return toAdminUserResponse(await this.users.getOne(adminUserId));
  }

  @Patch(":adminUserId")
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("adminUserId") rawAdminUserId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
    const adminUserId = uuid(rawAdminUserId, "adminUserId");
    const changes = parseAdminUserUpdateRequest(body);
    const updated = await this.users.update(
      request.adminUser,
      adminUserId,
      changes,
      request.requestId,
    );
    return toAdminUserResponse(updated);
  }
}
