import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { RequestWithId } from "../../common/http/request-id.middleware";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import {
  parseSettingsVersion,
  parseUpdateSettingsRequest,
  withDatabaseTimeZone,
} from "./settings.request";
import {
  serializeSettings,
  settingsEtag,
  SettingsService,
} from "./settings.service";

type PrivateRequest = RequestWithId & AuthenticatedRequest;

@Controller("me/settings")
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly database: PrismaService,
  ) {}

  @Get()
  async get(
    @Req() request: PrivateRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const settings = await this.settings.get(request.authenticatedUserId);
    response.setHeader("ETag", settingsEtag(settings.version));
    return serializeSettings(settings);
  }

  @Patch()
  async update(
    @Req() request: PrivateRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const version = parseSettingsVersion(ifMatch);
    const update = await withDatabaseTimeZone(
      this.database,
      parseUpdateSettingsRequest(body),
    );
    const settings = await this.settings.update(
      request.authenticatedUserId,
      version,
      update,
      request.requestId,
    );
    response.setHeader("ETag", settingsEtag(settings.version));
    return serializeSettings(settings);
  }
}
