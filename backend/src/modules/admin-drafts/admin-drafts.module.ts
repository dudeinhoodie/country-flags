import { Module } from "@nestjs/common";

import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminDraftsController } from "./admin-drafts.controller";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
import { DraftDecksController } from "./draft-decks.controller";
import { DraftDecksService } from "./draft-decks.service";
import { DraftDiffService } from "./draft-diff.service";
import { DraftProposalService } from "./draft-proposal.service";
import { DraftValidationService } from "./draft-validation.service";
import { EditorialDocumentService } from "./editorial-document.service";
import { createGitHubClient, GitHubClient } from "./github-client";
import { ReleaseRunController } from "./release-run.controller";
import { ReleaseRunService } from "./release-run.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

@Module({
  imports: [AdminAuthModule],
  controllers: [
    AdminDraftsController,
    DraftDecksController,
    ReleaseRunController,
  ],
  providers: [
    AdminDraftsService,
    CatalogSourceService,
    DraftDecksService,
    EditorialDocumentService,
    TaxonomySourceService,
    DraftDiffService,
    DraftValidationService,
    DraftProposalService,
    ReleaseRunService,
    {
      provide: GitHubClient,
      useFactory: (): GitHubClient => createGitHubClient(),
    },
  ],
})
export class AdminDraftsModule {}
