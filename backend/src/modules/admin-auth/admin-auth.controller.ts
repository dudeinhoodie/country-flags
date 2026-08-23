import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AdminUser } from "@prisma/client";
import type { Response } from "express";

import type { RequestWithId } from "../../common/http/request-id.middleware";
import { RateLimiter } from "../../common/security/rate-limiter.service";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { AdminAuthGuard } from "./admin-auth.guard";
import type { AdminAuthenticatedRequest } from "./admin-auth.guard";
import { parseAdminGoogleLoginRequest } from "./admin-auth.request";
import { AdminAuthService } from "./admin-auth.service";
import { assertTrustedAdminOrigin } from "./admin-origin";
import { AdminSessionService } from "./admin-session.service";
import type { AdminSessionContext } from "./admin-session.service";

function sessionContext(request: RequestWithId): AdminSessionContext {
  return {
    ipAddress: request.ip ?? request.socket.remoteAddress ?? "unknown-client",
    userAgent: request.header("user-agent"),
  };
}

function toAdminUserResponse(user: AdminUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

@Controller("admin")
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly sessions: AdminSessionService,
    private readonly rateLimiter: RateLimiter,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  @Post("auth/google")
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    // Origin first: rejecting a foreign origin costs nothing, while the
    // rate limit budget should protect token verification and the database.
    this.assertTrustedOrigin(request);
    await this.rateLimiter.consume(
      "admin-auth:google",
      request.ip ?? "unknown",
      10,
    );
    const parsed = parseAdminGoogleLoginRequest(body);
    const result = await this.auth.loginWithGoogle(
      parsed.idToken,
      sessionContext(request),
    );
    this.sessions.attachCookie(
      response,
      result.token,
      result.absoluteTtlSeconds,
    );
    return toAdminUserResponse(result.user);
  }

  @Post("auth/logout")
  @UseGuards(AdminAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AdminAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.assertTrustedOrigin(request);
    await this.sessions.revoke(request.adminSessionId);
    this.sessions.clearCookie(response);
  }

  @Get("me")
  @UseGuards(AdminAuthGuard)
  me(@Req() request: AdminAuthenticatedRequest): Record<string, unknown> {
    return toAdminUserResponse(request.adminUser);
  }

  private assertTrustedOrigin(request: RequestWithId): void {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
  }
}
