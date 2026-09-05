import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { AuthenticatedRequest } from "../auth/auth.guard";
import { StrictOptionalAuthGuard } from "../auth/strict-optional-auth.guard";
import { parseLimit, parseLocale, parseUuid } from "./content-query";
import { ContentService } from "./content.service";

@Controller("decks")
export class DecksController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  listDecks(
    @Query("locale") localeValue: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limitValue: string | undefined,
  ): ReturnType<ContentService["listDecks"]> {
    return this.contentService.listDecks(
      parseLocale(localeValue),
      cursor,
      parseLimit(limitValue),
    );
  }

  @Get(":deckId")
  getDeck(
    @Param("deckId") deckId: string,
    @Query("locale") localeValue: string | undefined,
  ): ReturnType<ContentService["getDeck"]> {
    return this.contentService.getDeck(
      parseUuid(deckId, "deckId"),
      parseLocale(localeValue),
    );
  }

  /**
   * The only route in the catalog whose answer depends on who is asking, so
   * it is also the only one that must never sit in a shared cache: one
   * owner's page served to the next reader would undo the guard entirely.
   * Whether the deck is free is not the point — the status code itself
   * varies by bearer.
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
