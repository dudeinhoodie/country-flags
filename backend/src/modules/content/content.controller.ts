import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import {
  CLIENT_APP_VERSION_HEADER,
  CLIENT_PLATFORM_HEADER,
  ClientCompatibilityService,
  GATED_ROUTES,
} from "../client-compatibility/client-compatibility.service";
import { parseLimit, parseLocale } from "./content-query";
import { ContentService } from "./content.service";

@Controller("content")
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly clients: ClientCompatibilityService,
  ) {}

  /**
   * Not gated by client version, and it needs no gate: the manifest describes
   * a release rather than its contents — locales, the change cursor, the
   * checksummed list of the bundle's own documents — and names no deck, card
   * or asset a build could misread.
   */
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
    @Headers(CLIENT_PLATFORM_HEADER) platform: string | undefined,
    @Headers(CLIENT_APP_VERSION_HEADER) appVersion: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): ReturnType<ContentService["listChanges"]> {
    parseLocale(localeValue);
    // The feed is cacheable by anything in front of the service, and it now
    // answers two clients differently; without this a shared cache would hand
    // one client's page to the other.
    response.setHeader(
      "Vary",
      `${CLIENT_APP_VERSION_HEADER}, ${CLIENT_PLATFORM_HEADER}`,
    );
    return this.contentService.listChanges(
      after,
      parseLimit(limitValue),
      this.clients.capabilityOf({
        route: GATED_ROUTES.contentChanges,
        platform,
        appVersion,
      }),
    );
  }
}
