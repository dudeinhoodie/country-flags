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
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import {
  parseSettingsVersion,
  parseUpdateSettingsRequest,
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
  constructor(private readonly settings: SettingsService) {}

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
    const settings = await this.settings.update(
      request.authenticatedUserId,
      parseSettingsVersion(ifMatch),
      parseUpdateSettingsRequest(body),
      request.requestId,
    );
    response.setHeader("ETag", settingsEtag(settings.version));
    return serializeSettings(settings);
  }
}
