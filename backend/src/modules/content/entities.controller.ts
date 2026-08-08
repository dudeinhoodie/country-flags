import { Controller, Get, Param, Query } from "@nestjs/common";

import { parseLocale, parseUuid } from "./content-query";
import { ContentService } from "./content.service";

@Controller("entities")
export class EntitiesController {
  constructor(private readonly contentService: ContentService) {}

  @Get(":entityId")
  getEntity(
    @Param("entityId") entityId: string,
    @Query("locale") localeValue: string | undefined,
  ): ReturnType<ContentService["getEntity"]> {
    return this.contentService.getEntity(
      parseUuid(entityId, "entityId"),
      parseLocale(localeValue),
    );
  }
}
