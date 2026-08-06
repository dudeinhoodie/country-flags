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

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import {
  parsePrivacySettingsVersion,
  parseUpdatePrivacySettingsRequest,
} from "./privacy-settings.request";
import {
  PrivacySettingsService,
  privacySettingsEtag,
  serializePrivacySettings,
} from "./privacy-settings.service";

@Controller("me/privacy-settings")
@UseGuards(AuthGuard)
export class PrivacySettingsController {
  constructor(private readonly privacySettings: PrivacySettingsService) {}

  @Get()
  async get(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const settings = await this.privacySettings.get(
      request.authenticatedUserId,
    );
    response.setHeader("ETag", privacySettingsEtag(settings.version));
    return serializePrivacySettings(settings);
  }

  @Patch()
  async update(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const settings = await this.privacySettings.update(
      request.authenticatedUserId,
      parsePrivacySettingsVersion(ifMatch),
      parseUpdatePrivacySettingsRequest(body),
    );
    response.setHeader("ETag", privacySettingsEtag(settings.version));
    return serializePrivacySettings(settings);
  }
}
