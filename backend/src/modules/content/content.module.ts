import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CommerceModule } from "../commerce/commerce.module";
import { ContentController } from "./content.controller";
import { ContentService } from "./content.service";
import { DecksController } from "./decks.controller";
import { EntitiesController } from "./entities.controller";

@Module({
  imports: [AuthModule, CommerceModule],
  controllers: [ContentController, DecksController, EntitiesController],
  providers: [ContentService],
})
export class ContentModule {}
