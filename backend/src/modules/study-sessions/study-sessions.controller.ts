import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import {
  type TestAuthenticatedRequest,
  TestAuthGuard,
} from "../auth/testing/test-auth.guard";
import { parseUuid } from "../content/content-query";
import { parseCreateStudySessionRequest } from "./study-session.request";
import { StudySessionsService } from "./study-sessions.service";

@Controller("study-sessions")
@UseGuards(TestAuthGuard)
export class StudySessionsController {
  constructor(private readonly sessions: StudySessionsService) {}

  @Post()
  async create(
    @Req() request: TestAuthenticatedRequest,
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
    @Req() request: TestAuthenticatedRequest,
    @Param("sessionId") sessionId: string,
  ): Promise<Record<string, unknown>> {
    return this.sessions.get(
      request.authenticatedUserId,
      parseUuid(sessionId, "sessionId"),
    );
  }
}
