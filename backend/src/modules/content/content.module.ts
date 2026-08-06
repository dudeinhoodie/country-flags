import { Module } from "@nestjs/common";

import { ContentController } from "./content.controller";
import { ContentService } from "./content.service";
import { DecksController } from "./decks.controller";

@Module({
  controllers: [ContentController, DecksController],
  providers: [ContentService],
})
export class ContentModule {}
