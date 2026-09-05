import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminRole, Prisma } from "@prisma/client";
import type { ContentDraft } from "@prisma/client";
import type { Response } from "express";

import { uuid } from "../../common/http/request-validation";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../admin-auth/admin-auth.guard";
import { assertTrustedAdminOrigin } from "../admin-auth/admin-origin";
import { RequireAdminRole } from "../admin-auth/admin-roles";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import { parseAdminListQuery } from "../admin-auth/admin-users.request";
import {
  parseDraftUpdateRequest,
  parseIfMatchRevision,
  parseProposalRequest,
} from "./admin-drafts.request";
import { AdminDraftsService } from "./admin-drafts.service";
import { DraftDiffService } from "./draft-diff.service";
import { DraftProposalService } from "./draft-proposal.service";
import { DraftValidationService } from "./draft-validation.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

function toDraftSummary(draft: ContentDraft): Record<string, unknown> {
  return {
    id: draft.id,
    baseContentVersion: draft.baseContentVersion,
    baseCatalogCommit: draft.baseCatalogCommit,
    schemaVersion: draft.schemaVersion,
    revision: draft.revision,
    status: draft.status,
    proposalUrl: draft.proposalUrl,
    createdByAdminUserId: draft.createdByAdminUserId,
    updatedByAdminUserId: draft.updatedByAdminUserId,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function toDraftDetail(draft: ContentDraft): Record<string, unknown> {
  return {
    ...toDraftSummary(draft),
    document: draft.document,
    validationReport: draft.validationReport,
  };
}

@Controller("admin/content/drafts")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class AdminDraftsController {
  constructor(
    private readonly drafts: AdminDraftsService,
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly validation: DraftValidationService,
    private readonly diffs: DraftDiffService,
    private readonly taxonomy: TaxonomySourceService,
    private readonly proposals: DraftProposalService,
  ) {}

  @Get()
  async list(
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    const { offset, limit } = parseAdminListQuery(request.query);
    const { items, total } = await this.drafts.list(offset, limit);
    return { items: items.map(toDraftSummary), total };
  }

  @Post()
  @RequireAdminRole(AdminRole.EDITOR)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const draft = await this.drafts.create(
      request.adminUser,
      request.requestId,
    );
    return toDraftDetail(draft);
  }

  @Get(":draftId")
  async get(
    @Param("draftId") rawDraftId: string,
  ): Promise<Record<string, unknown>> {
    return toDraftDetail(await this.drafts.get(uuid(rawDraftId, "draftId")));
  }

  @Patch(":draftId")
  @RequireAdminRole(AdminRole.EDITOR)
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const draftId = uuid(rawDraftId, "draftId");
    const expectedRevision = parseIfMatchRevision(ifMatch);
    const parsed = parseDraftUpdateRequest(body);
    const draft = await this.drafts.updateDocument(
      request.adminUser,
      draftId,
      expectedRevision,
      parsed.document,
      request.requestId,
    );
    return toDraftDetail(draft);
  }

  @Post(":draftId/validate")
  @RequireAdminRole(AdminRole.EDITOR)
  @HttpCode(HttpStatus.OK)
  async validate(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const draftId = uuid(rawDraftId, "draftId");
    const draft = await this.drafts.get(draftId);
    const report = this.validation.validate(
      draft.document,
      await this.membershipContext(draft.document),
      await this.drafts.draftAssetsOf(draftId),
      await this.drafts.publishedDeckAccess(),
    );
    const stored = await this.drafts.storeValidationReport(
      draftId,
      report as unknown as Prisma.InputJsonValue,
      report.blocking,
    );
    return { status: stored.status, revision: stored.revision, report };
  }

  @Get(":draftId/diff")
  async diff(
    @Param("draftId") rawDraftId: string,
  ): Promise<Record<string, unknown>> {
    const draft = await this.drafts.get(uuid(rawDraftId, "draftId"));
    return this.diffs.diff(
      draft,
      await this.membershipContext(draft.document),
    ) as unknown as Record<string, unknown>;
  }

  @Post(":draftId/proposal")
  @RequireAdminRole(AdminRole.PUBLISHER)
  @HttpCode(HttpStatus.CREATED)
  async propose(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const draftId = uuid(rawDraftId, "draftId");
    const draft = await this.drafts.get(draftId);
    const diff = await this.diffs.diff(
      draft,
      await this.membershipContext(draft.document),
    );
    const result = await this.proposals.propose(
      request.adminUser,
      draftId,
      parseProposalRequest(body),
      diff,
      request.requestId,
    );
    return result as unknown as Record<string, unknown>;
  }

  @Get(":draftId/export")
  async export(
    @Param("draftId") rawDraftId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const { content, filename } = await this.drafts.exportDocument(
      uuid(rawDraftId, "draftId"),
    );
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    return content;
  }

  private async membershipContext(
    document: unknown,
  ): Promise<{ entities: never[]; relations: never[] }> {
    const catalog = document as {
      entities: never[];
      additionalRelations?: unknown;
    };
    return {
      entities: catalog.entities,
      relations: this.taxonomy.merge(
        await this.taxonomy.publishedRelations(),
        catalog.additionalRelations,
      ) as never[],
    };
  }

  private assertTrustedOrigin(request: AdminAuthenticatedRequest): void {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
  }
}
