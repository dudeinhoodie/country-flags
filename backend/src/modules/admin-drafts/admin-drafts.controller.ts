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
import { AdminRole } from "@prisma/client";
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
} from "./admin-drafts.request";
import { AdminDraftsService } from "./admin-drafts.service";

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

  private assertTrustedOrigin(request: AdminAuthenticatedRequest): void {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
  }
}
