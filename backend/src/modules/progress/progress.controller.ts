import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { RateLimiter } from "../../common/security/rate-limiter.service";
import { type AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { parseLimit, parseUuid } from "../content/content-query";
import { parseDeleteProgressRequest } from "./delete-progress.request";
import { ProgressDeletionService } from "./progress-deletion.service";
import { ProgressService } from "./progress.service";

type PrivateRequest = RequestWithId & AuthenticatedRequest;

@Controller("me")
@UseGuards(AuthGuard)
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly deletion: ProgressDeletionService,
    private readonly rateLimiter: RateLimiter,
  ) {}

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

  @Delete("progress")
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteProgress(
    @Req() request: PrivateRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    // A signed-in session and an explicit confirmation are the whole gate:
    // the fresh provider proof this used to demand killed the flow on
    // devices where reauthentication could not complete, and progress —
    // unlike the account itself — is recoverable by studying again.
    parseDeleteProgressRequest(body);
    if (request.authenticatedSessionId === null) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "SESSION_ACCESS_TOKEN_REQUIRED",
        "A session access token is required for this operation",
      );
    }
    await this.rateLimiter.consume(
      "account:delete-progress",
      request.authenticatedUserId,
      3,
    );
    return this.deletion.delete(request.authenticatedUserId, request.requestId);
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
