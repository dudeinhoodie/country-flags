import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { AuthenticatedRequest } from "../auth/auth.guard";
import { StrictOptionalAuthGuard } from "../auth/strict-optional-auth.guard";
import {
  CLIENT_APP_VERSION_HEADER,
  CLIENT_PLATFORM_HEADER,
  ClientCompatibilityService,
  GATED_ROUTES,
} from "../client-compatibility/client-compatibility.service";
import { parseLimit, parseLocale, parseUuid } from "./content-query";
import { ContentService } from "./content.service";

/**
 * The catalog now reads two headers every build of the app already sends, so
 * both routes below vary by them. `Vary` is not decoration here: these
 * answers are cacheable by anything in front of the service, and a page built
 * for a StoreKit client served from a shared cache to a build that predates
 * it is the exact failure the gate exists to prevent.
 */
const CLIENT_VARY = `${CLIENT_APP_VERSION_HEADER}, ${CLIENT_PLATFORM_HEADER}`;

@Controller("decks")
export class DecksController {
  constructor(
    private readonly contentService: ContentService,
    private readonly clients: ClientCompatibilityService,
  ) {}

  @Get()
  listDecks(
    @Query("locale") localeValue: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limitValue: string | undefined,
    @Headers(CLIENT_PLATFORM_HEADER) platform: string | undefined,
    @Headers(CLIENT_APP_VERSION_HEADER) appVersion: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): ReturnType<ContentService["listDecks"]> {
    response.setHeader("Vary", CLIENT_VARY);
    return this.contentService.listDecks(
      parseLocale(localeValue),
      cursor,
      parseLimit(limitValue),
      this.clients.capabilityOf({
        route: GATED_ROUTES.deckCatalog,
        platform,
        appVersion,
      }),
    );
  }

  @Get(":deckId")
  getDeck(
    @Param("deckId") deckId: string,
    @Query("locale") localeValue: string | undefined,
    @Headers(CLIENT_PLATFORM_HEADER) platform: string | undefined,
    @Headers(CLIENT_APP_VERSION_HEADER) appVersion: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): ReturnType<ContentService["getDeck"]> {
    response.setHeader("Vary", CLIENT_VARY);
    return this.contentService.getDeck(
      parseUuid(deckId, "deckId"),
      parseLocale(localeValue),
      this.clients.capabilityOf({
        route: GATED_ROUTES.deck,
        platform,
        appVersion,
      }),
    );
  }

  /**
   * The only route in the catalog whose answer depends on who is asking, so
   * it is also the only one that must never sit in a shared cache: one
   * owner's page served to the next reader would undo the guard entirely.
   * Whether the deck is free is not the point — the status code itself
   * varies by bearer.
   *
   * No client-version gate here, deliberately. A build too old to understand
   * the access model cannot discover a locked deck's id any more, and one
   * that arrives with an id anyway is an owner mid-upgrade whose purchase the
   * entitlement guard answers correctly. Withholding cards by build would be
   * a second rule about who may open a deck, and there is only one.
   */
  @Get(":deckId/cards")
  @UseGuards(StrictOptionalAuthGuard)
  listDeckCards(
    @Req() request: AuthenticatedRequest,
    @Param("deckId") deckId: string,
    @Query("locale") localeValue: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limitValue: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): ReturnType<ContentService["listDeckCards"]> {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Vary", "Authorization");
    return this.contentService.listDeckCards(
      parseUuid(deckId, "deckId"),
      request.authenticatedUserId ?? null,
      parseLocale(localeValue),
      cursor,
      parseLimit(limitValue),
    );
  }
}
