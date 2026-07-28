import { Controller, Get, Param, Query } from "@nestjs/common";

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

  @Get(":deckId/cards")
  listDeckCards(
    @Param("deckId") deckId: string,
    @Query("locale") localeValue: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limitValue: string | undefined,
  ): ReturnType<ContentService["listDeckCards"]> {
    return this.contentService.listDeckCards(
      parseUuid(deckId, "deckId"),
      parseLocale(localeValue),
      cursor,
      parseLimit(limitValue),
    );
  }
}
