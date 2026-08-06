import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";

import { RateLimiter } from "../../common/security/rate-limiter.service";
import { type AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { parseLimit } from "../content/content-query";
import { UserChangesService } from "./user-changes.service";

@Controller("me/changes")
@UseGuards(AuthGuard)
export class UserChangesController {
  constructor(
    private readonly changes: UserChangesService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query("after") after: string | undefined,
    @Query("limit") limit: string | undefined,
  ): Promise<Record<string, unknown>> {
    await this.rateLimiter.consume(
      "sync:changes",
      request.authenticatedUserId,
      120,
    );
    return this.changes.list(
      request.authenticatedUserId,
      after,
      parseLimit(limit),
    );
  }
}
