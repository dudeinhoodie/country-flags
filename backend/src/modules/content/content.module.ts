import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { ContentController } from "./content.controller";
import { ContentHttpExceptionFilter } from "./content-http-exception.filter";
import { ContentService } from "./content.service";
import { DecksController } from "./decks.controller";

@Module({
  controllers: [ContentController, DecksController],
  providers: [
    ContentService,
    {
      provide: APP_FILTER,
      useClass: ContentHttpExceptionFilter,
    },
  ],
})
export class ContentModule {}
