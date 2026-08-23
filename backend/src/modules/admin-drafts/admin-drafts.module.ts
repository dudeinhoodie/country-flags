import { Module } from "@nestjs/common";

import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminDraftsController } from "./admin-drafts.controller";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
import { EditorialDocumentService } from "./editorial-document.service";

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminDraftsController],
  providers: [
    AdminDraftsService,
    CatalogSourceService,
    EditorialDocumentService,
  ],
})
export class AdminDraftsModule {}
