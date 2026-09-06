import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../config/environment.validation";
import type { ObjectStorage } from "../../infrastructure/object-storage/object-storage";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { ContentModule } from "../content/content.module";
import { AdminDraftsController } from "./admin-drafts.controller";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
import { DraftAssetCleanupService } from "./draft-asset-cleanup.service";
import { DraftCandidatesController } from "./draft-candidates.controller";
import { DraftCandidatesService } from "./draft-candidates.service";
import { DraftReadModelService } from "./draft-read-model.service";
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
import {
  createPublisherJobClient,
  PublisherJobClient,
} from "./publisher-job.client";
import { ReleaseRunController } from "./release-run.controller";
import { ReleaseRunService } from "./release-run.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

@Module({
  // The console asks the same question about a draft that the public
  // projection asks about a release — "who may see this" — and it must get
  // the same answer, so it uses that service rather than a copy of the rule
  // (#356, ADR-019).
  imports: [AdminAuthModule, ContentModule],
  controllers: [
    AdminDraftsController,
    DraftAssetsController,
    DraftCandidatesController,
    DraftDecksController,
    DraftEntitiesController,
    ReleaseRunController,
    PublishRunController,
  ],
  providers: [
    AdminDraftsService,
    CatalogSourceService,
    DraftCandidatesService,
    DraftDecksService,
    DraftEntitiesService,
    DraftReadModelService,
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
    {
      // The console's whole reach into the publisher: it may ask for a run.
      // The signing key and the right to write content belong to the job's
      // own service account, and this process has neither (ADR-017 §1).
      provide: PublisherJobClient,
      useFactory: (): PublisherJobClient => createPublisherJobClient(),
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
