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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminRole } from "@prisma/client";
import type { ContentDraft, DraftAsset } from "@prisma/client";
import type { Response } from "express";

import { ApiException } from "../../common/http/api.exception";
import { uuid } from "../../common/http/request-validation";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../admin-auth/admin-auth.guard";
import { assertTrustedAdminOrigin } from "../admin-auth/admin-origin";
import { RequireAdminRole } from "../admin-auth/admin-roles";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import {
  parseDraftAssetPatch,
  parseDraftAssetUpload,
  parseIfMatchRevision,
} from "./admin-drafts.request";
import { DraftAssetsService, isoDay } from "./draft-assets.service";

interface UploadedMultipartFile {
  buffer: Buffer;
  size: number;
}

function toAssetResponse(asset: DraftAsset): Record<string, unknown> {
  return {
    id: asset.id,
    draftId: asset.draftId,
    entityContentKey: asset.entityContentKey,
    assetType: asset.assetType,
    variant: asset.variant,
    mimeType: asset.mimeType,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    aspectRatio:
      asset.aspectRatio === null ? null : asset.aspectRatio.toNumber(),
    sourceUrl: asset.sourceUrl,
    licenseName: asset.licenseName,
    licenseUrl: asset.licenseUrl,
    attribution: asset.attribution,
    replacementReason: asset.replacementReason,
    validationStatus: asset.validationStatus,
    validFrom: asset.validFrom === null ? null : isoDay(asset.validFrom),
    validTo: asset.validTo === null ? null : isoDay(asset.validTo),
    // Always an object, never absent: a symbol with no words yet and a
    // symbol whose words were never asked for read the same to a client.
    localizations: asset.localizations ?? {},
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

function toDraftStamp(draft: ContentDraft): Record<string, unknown> {
  return {
    draftId: draft.id,
    revision: draft.revision,
    status: draft.status,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

@Controller("admin/content/drafts/:draftId/assets")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class DraftAssetsController {
  constructor(
    private readonly assets: DraftAssetsService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  @Get()
  async list(
    @Param("draftId") rawDraftId: string,
  ): Promise<Record<string, unknown>> {
    const items = await this.assets.list(uuid(rawDraftId, "draftId"));
    return { items: items.map(toAssetResponse), total: items.length };
  }

  @Post()
  @RequireAdminRole(AdminRole.EDITOR)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @UploadedFile() file: UploadedMultipartFile | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    if (file === undefined) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more fields are invalid",
        { fields: [{ field: "file", message: "is required" }] },
      );
    }
    const asset = await this.assets.upload(
      request.adminUser,
      uuid(rawDraftId, "draftId"),
      file,
      parseDraftAssetUpload(body),
      request.requestId,
    );
    return toAssetResponse(asset);
  }

  /**
   * Draft bytes are served through the backend rather than linked at
   * storage: the draft bucket is not public, and it must stay that way.
   */
  @Get(":assetId/preview")
  async preview(
    @Param("draftId") rawDraftId: string,
    @Param("assetId") rawAssetId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Buffer> {
    const { body, mimeType } = await this.assets.bytesOf(
      uuid(rawDraftId, "draftId"),
      uuid(rawAssetId, "assetId"),
    );
    response.setHeader("Content-Type", mimeType);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    // A drawing served from the API origin must not be able to act there.
    response.setHeader("Content-Security-Policy", "default-src 'none'");
    return body;
  }

  /**
   * Metadata, validity and the symbol's own words. The drawing is not
   * touched: new bytes arrive through the upload, and retiring a symbol is
   * closing its validity here rather than deleting it.
   */
  @Patch(":assetId")
  @RequireAdminRole(AdminRole.EDITOR)
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @Param("assetId") rawAssetId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertTrustedOrigin(request);
    const draft = await this.assets.update(
      request.adminUser,
      uuid(rawDraftId, "draftId"),
      uuid(rawAssetId, "assetId"),
      parseIfMatchRevision(ifMatch),
      parseDraftAssetPatch(body),
      request.requestId,
    );
    return toDraftStamp(draft);
  }

  @Delete(":assetId")
  @RequireAdminRole(AdminRole.EDITOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
    @Param("assetId") rawAssetId: string,
  ): Promise<void> {
    this.assertTrustedOrigin(request);
    await this.assets.remove(
      request.adminUser,
      uuid(rawDraftId, "draftId"),
      uuid(rawAssetId, "assetId"),
      request.requestId,
    );
  }

  private assertTrustedOrigin(request: AdminAuthenticatedRequest): void {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
  }
}
