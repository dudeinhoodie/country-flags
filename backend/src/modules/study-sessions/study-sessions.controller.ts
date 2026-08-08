import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import { type AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { parseUuid } from "../content/content-query";
import {
  parseCompleteStudySessionRequest,
  parseCreateStudySessionRequest,
} from "./study-session.request";
import { StudySessionsService } from "./study-sessions.service";

@Controller("study-sessions")
@UseGuards(AuthGuard)
export class StudySessionsController {
  constructor(private readonly sessions: StudySessionsService) {}

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const result = await this.sessions.create(
      request.authenticatedUserId,
      parseCreateStudySessionRequest(body),
    );
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.session;
  }

  @Get(":sessionId")
  get(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
  ): Promise<Record<string, unknown>> {
    return this.sessions.get(
      request.authenticatedUserId,
      parseUuid(sessionId, "sessionId"),
    );
  }

  @Post(":sessionId/complete")
  @HttpCode(HttpStatus.OK)
  complete(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.sessions.complete(
      request.authenticatedUserId,
      parseUuid(sessionId, "sessionId"),
      parseCompleteStudySessionRequest(body),
    );
  }
}
