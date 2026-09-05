import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminRole } from "@prisma/client";
import type { ContentDraft } from "@prisma/client";

import { uuid } from "../../common/http/request-validation";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../admin-auth/admin-auth.guard";
import { assertTrustedAdminOrigin } from "../admin-auth/admin-origin";
import { RequireAdminRole } from "../admin-auth/admin-roles";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import {
  parseDeckCreateRequest,
  parseDeckUpdateRequest,
  parseIfMatchRevision,
} from "./admin-drafts.request";
import { DraftDecksService } from "./draft-decks.service";
import type { DeckDetailView } from "./draft-decks.service";

function toDraftStamp(draft: ContentDraft): Record<string, unknown> {
  return {
    draftId: draft.id,
    revision: draft.revision,
    status: draft.status,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

@Controller("admin/content/drafts/:draftId/decks")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class DraftDecksController {
  constructor(
    private readonly decks: DraftDecksService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  @Get()
  async list(
    @Param("draftId") rawDraftId: string,
  ): Promise<Record<string, unknown>> {
    const items = await this.decks.list(uuid(rawDraftId, "draftId"));
    return { items, total: items.length };
  }

  @Get(":deckKey")
  async getOne(
    @Param("draftId") rawDraftId: string,
    @Param("deckKey") deckKey: string,
  ): Promise<DeckDetailView> {
    return this.decks.getOne(uuid(rawDraftId, "draftId"), deckKey);
  }

  @Post()
  @RequireAdminRole(AdminRole.EDITOR)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const draft = await this.decks.create(
      request.adminUser,
      uuid(rawDraftId, "draftId"),
      parseIfMatchRevision(ifMatch),
      parseDeckCreateRequest(body),
      request.requestId,
    );
    return toDraftStamp(draft);
  }

  @Patch(":deckKey")
  @RequireAdminRole(AdminRole.EDITOR)
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @Param("deckKey") deckKey: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const draft = await this.decks.update(
      request.adminUser,
      uuid(rawDraftId, "draftId"),
      parseIfMatchRevision(ifMatch),
      deckKey,
      parseDeckUpdateRequest(body),
      request.requestId,
    );
    return toDraftStamp(draft);
  }

  @Delete(":deckKey")
  @RequireAdminRole(AdminRole.EDITOR)
  async remove(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @Param("deckKey") deckKey: string,
    @Headers("if-match") ifMatch: string | undefined,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const draft = await this.decks.remove(
      request.adminUser,
      uuid(rawDraftId, "draftId"),
      parseIfMatchRevision(ifMatch),
      deckKey,
      request.requestId,
    );
    return toDraftStamp(draft);
  }

  private assertTrustedOrigin(request: AdminAuthenticatedRequest): void {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
  }
}
