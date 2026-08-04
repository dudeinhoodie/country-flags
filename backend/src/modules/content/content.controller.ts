import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { parseLimit, parseLocale } from "./content-query";
import { ContentService } from "./content.service";

@Controller("content")
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get("manifest")
  async getManifest(
    @Query("locale") localeValue: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown> | undefined> {
    parseLocale(localeValue);
    const { manifest, checksum } = await this.contentService.getManifest();
    const etag = `"${checksum}"`;
    response.setHeader("ETag", etag);
    if (ifNoneMatch === etag) {
      response.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return manifest;
  }

  @Get("changes")
  listChanges(
    @Query("after") after: string | undefined,
    @Query("locale") localeValue: string | undefined,
    @Query("limit") limitValue: string | undefined,
  ): ReturnType<ContentService["listChanges"]> {
    parseLocale(localeValue);
    return this.contentService.listChanges(after, parseLimit(limitValue));
  }
}
