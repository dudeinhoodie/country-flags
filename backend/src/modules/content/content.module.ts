import { Module } from "@nestjs/common";

import { ContentController } from "./content.controller";
import { ContentService } from "./content.service";
import { DecksController } from "./decks.controller";
import { EntitiesController } from "./entities.controller";

@Module({
  controllers: [ContentController, DecksController, EntitiesController],
  providers: [ContentService],
})
export class ContentModule {}
