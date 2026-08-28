import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../config/environment.validation";
import type { ObjectStorage } from "../../infrastructure/object-storage/object-storage";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminDraftsController } from "./admin-drafts.controller";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
import { DraftAssetCleanupService } from "./draft-asset-cleanup.service";
import { DraftAssetsController } from "./draft-assets.controller";
import { DraftAssetsService } from "./draft-assets.service";
import { DraftDecksController } from "./draft-decks.controller";
import {
  createDraftObjectStorage,
  DRAFT_OBJECT_STORAGE,
  DraftObjectStore,
} from "./draft-object-storage";
import { DraftDecksService } from "./draft-decks.service";
import { DraftDiffService } from "./draft-diff.service";
import { DraftEntitiesController } from "./draft-entities.controller";
import { DraftEntitiesService } from "./draft-entities.service";
import { DraftProposalService } from "./draft-proposal.service";
import { DraftValidationService } from "./draft-validation.service";
import { EditorialDocumentService } from "./editorial-document.service";
import { createGitHubClient, GitHubClient } from "./github-client";
import { PublishRunController } from "./publish-run.controller";
import { PublishRunService } from "./publish-run.service";
import { ReleaseRunController } from "./release-run.controller";
import { ReleaseRunService } from "./release-run.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

@Module({
  imports: [AdminAuthModule],
  controllers: [
    AdminDraftsController,
    DraftAssetsController,
    DraftDecksController,
    DraftEntitiesController,
    ReleaseRunController,
    PublishRunController,
  ],
  providers: [
    AdminDraftsService,
    CatalogSourceService,
    DraftDecksService,
    DraftEntitiesService,
    EditorialDocumentService,
    TaxonomySourceService,
    DraftDiffService,
    DraftValidationService,
    DraftProposalService,
    ReleaseRunService,
    PublishRunService,
    {
      provide: GitHubClient,
      useFactory: (): GitHubClient => createGitHubClient(),
    },
    DraftAssetCleanupService,
    DraftObjectStore,
    {
      provide: DRAFT_OBJECT_STORAGE,
      useFactory: (): ObjectStorage => createDraftObjectStorage(),
    },
    {
      // The upload limit is configuration rather than a constant, so the
      // service takes it as a value instead of reading config itself.
      provide: DraftAssetsService,
      inject: [
        PrismaService,
        AdminDraftsService,
        DraftObjectStore,
        AdminAuditService,
        ConfigService,
      ],
      useFactory: (
        database: PrismaService,
        drafts: AdminDraftsService,
        objects: DraftObjectStore,
        audit: AdminAuditService,
        config: ConfigService<EnvironmentVariables>,
      ): DraftAssetsService =>
        new DraftAssetsService(
          database,
          drafts,
          objects,
          audit,
          config.getOrThrow<number>("ADMIN_ASSET_MAX_BYTES"),
        ),
    },
  ],
  exports: [DraftAssetCleanupService],
})
export class AdminDraftsModule {}
