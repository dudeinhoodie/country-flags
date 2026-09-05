import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
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
  parseEntityListQuery,
  parseEntityUpdateRequest,
  parseIfMatchRevision,
} from "./admin-drafts.request";
import { DraftEntitiesService } from "./draft-entities.service";
import type { EntityDetail, EntityListPage } from "./draft-entities.service";

function toDraftStamp(draft: ContentDraft): Record<string, unknown> {
  return {
    draftId: draft.id,
    revision: draft.revision,
    status: draft.status,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

/**
 * The editorial entities of a draft. There is no POST and no DELETE: an
 * entity exists because upstream sources describe it, so the console edits
 * the selection and the overrides but never invents a country.
 */
@Controller("admin/content/drafts/:draftId/entities")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class DraftEntitiesController {
  constructor(
    private readonly entities: DraftEntitiesService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  /**
   * The aggregated list the console renders, filtered on the server.
   *
   * `total` counts what the filters matched rather than what the page holds,
   * so a paged list can say how much work is left.
   */
  @Get()
  list(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
  ): Promise<EntityListPage> {
    return this.entities.list(
      uuid(rawDraftId, "draftId"),
      parseEntityListQuery(request.query),
    );
  }

  @Get(":entityKey")
  async getOne(
    @Param("draftId") rawDraftId: string,
    @Param("entityKey") entityKey: string,
  ): Promise<EntityDetail> {
    return this.entities.getOne(uuid(rawDraftId, "draftId"), entityKey);
  }

  @Patch(":entityKey")
  @RequireAdminRole(AdminRole.EDITOR)
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @Param("entityKey") entityKey: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
    const draft = await this.entities.update(
      request.adminUser,
      uuid(rawDraftId, "draftId"),
      parseIfMatchRevision(ifMatch),
      entityKey,
      parseEntityUpdateRequest(body),
      request.requestId,
    );
    return toDraftStamp(draft);
  }
}
