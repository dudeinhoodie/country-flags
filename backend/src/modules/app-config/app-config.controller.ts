import { Controller, Get, Headers, Query, Res } from "@nestjs/common";
import type { Response } from "express";

import {
  canonicalLocale,
  validationError,
} from "../../common/http/request-validation";
import { AppConfigService, type AppConfigSnapshot } from "./app-config.service";

const PLATFORM_VALUES = ["android", "ios", "web"] as const;
const APP_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

@Controller("app-config")
export class AppConfigController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  async getConfig(
    @Query("platform") platform: string | undefined,
    @Query("appVersion") appVersion: string | undefined,
    @Query("locale") locale: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AppConfigSnapshot | undefined> {
    if (
      platform === undefined ||
      !PLATFORM_VALUES.includes(platform as (typeof PLATFORM_VALUES)[number])
    ) {
      validationError("platform", "must be ios, android, or web");
    }
    if (appVersion === undefined || !APP_VERSION_PATTERN.test(appVersion)) {
      validationError("appVersion", "must be a semantic version");
    }
    const snapshot = await this.config.snapshot({
      platform: platform as (typeof PLATFORM_VALUES)[number],
      appVersion,
      locale: canonicalLocale(locale, "locale"),
    });
    const etag = `"${snapshot.configVersion}"`;
    response.setHeader("ETag", etag);
    response.setHeader("Cache-Control", "private, max-age=300");
    if (ifNoneMatch === etag) {
      response.status(304);
      return undefined;
    }
    return snapshot;
  }
}
