import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";

import { type AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { parseLimit, parseUuid } from "../content/content-query";
import { ProgressService } from "./progress.service";

@Controller("me")
@UseGuards(AuthGuard)
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get("due-summary")
  dueSummary(
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.progress.getDueSummary(request.authenticatedUserId);
  }

  @Get("progress")
  getProgress(
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.progress.getProgress(request.authenticatedUserId);
  }

  @Get("decks/:deckId/progress")
  deckProgress(
    @Req() request: AuthenticatedRequest,
    @Param("deckId") deckId: string,
  ): Promise<Record<string, unknown>> {
    return this.progress.getDeckProgress(
      request.authenticatedUserId,
      parseUuid(deckId, "deckId"),
    );
  }

  @Get("achievements")
  achievements(
    @Req() request: AuthenticatedRequest,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.progress.listAchievements(
      request.authenticatedUserId,
      cursor,
      parseLimit(limit),
    );
  }
}
