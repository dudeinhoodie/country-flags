import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";

import { type AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { parseLimit } from "../content/content-query";
import { UserChangesService } from "./user-changes.service";

@Controller("me/changes")
@UseGuards(AuthGuard)
export class UserChangesController {
  constructor(private readonly changes: UserChangesService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query("after") after: string | undefined,
    @Query("limit") limit: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.changes.list(
      request.authenticatedUserId,
      after,
      parseLimit(limit),
    );
  }
}
