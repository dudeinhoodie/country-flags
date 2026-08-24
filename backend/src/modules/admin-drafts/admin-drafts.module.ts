import { Module } from "@nestjs/common";

import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminDraftsController } from "./admin-drafts.controller";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
import { DraftDecksController } from "./draft-decks.controller";
import { DraftDecksService } from "./draft-decks.service";
import { DraftDiffService } from "./draft-diff.service";
import { DraftValidationService } from "./draft-validation.service";
import { EditorialDocumentService } from "./editorial-document.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminDraftsController, DraftDecksController],
  providers: [
    AdminDraftsService,
    CatalogSourceService,
    DraftDecksService,
    EditorialDocumentService,
    TaxonomySourceService,
    DraftDiffService,
    DraftValidationService,
  ],
})
export class AdminDraftsModule {}
