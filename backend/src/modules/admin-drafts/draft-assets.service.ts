import { HttpStatus, Injectable } from "@nestjs/common";
import {
  inspectImage,
  sha256,
  UnsafeAssetError,
} from "@country-flags/asset-core";
import { AssetType, DraftAssetValidationStatus } from "@prisma/client";
import type { AdminUser, DraftAsset } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { AdminDraftsService } from "./admin-drafts.service";
import { DraftObjectStore } from "./draft-object-storage";

export interface DraftAssetUpload {
  entityContentKey: string;
  assetType: AssetType;
  variant: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl?: string;
  attribution?: string;
  replacementReason: string;
  idempotencyKey?: string;
}

function rejected(code: string, message: string): never {
  throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

@Injectable()
export class DraftAssetsService {
  constructor(
    private readonly database: PrismaService,
    private readonly drafts: AdminDraftsService,
    private readonly objects: DraftObjectStore,
    private readonly audit: AdminAuditService,
    private readonly maximumBytes: number,
  ) {}

  async list(draftId: string): Promise<DraftAsset[]> {
    await this.drafts.get(draftId);
    return this.database.draftAsset.findMany({
      where: { draftId },
      orderBy: [{ entityContentKey: "asc" }, { assetType: "asc" }],
    });
  }

  async getOne(draftId: string, assetId: string): Promise<DraftAsset> {
    const asset = await this.database.draftAsset.findFirst({
      where: { id: assetId, draftId },
    });
    if (asset === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
      );
    }
    return asset;
  }

  async bytesOf(
    draftId: string,
    assetId: string,
  ): Promise<{
    body: Buffer;
    mimeType: string;
  }> {
    const asset = await this.getOne(draftId, assetId);
    const body = await this.objects.get(asset.objectKey);
    if (body === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "RESOURCE_NOT_FOUND",
        "The draft object is no longer stored",
      );
    }
    return { body, mimeType: asset.mimeType };
  }

  async upload(
    actor: AdminUser,
    draftId: string,
    file: { buffer: Buffer; size: number },
    upload: DraftAssetUpload,
    requestId: string,
  ): Promise<DraftAsset> {
    const draft = await this.drafts.get(draftId);
    if (file.size > this.maximumBytes) {
      rejected(
        "ASSET_TOO_LARGE",
        `The file exceeds the ${String(this.maximumBytes)} byte limit`,
      );
    }
    if (file.size === 0) {
      rejected("ASSET_EMPTY", "The file is empty");
    }

    // What the bytes are decides everything; the filename and the
    // client-declared media type are attacker-controlled and ignored.
    let inspection;
    try {
      inspection = inspectImage(file.buffer);
    } catch (error) {
      if (error instanceof UnsafeAssetError) {
        rejected("ASSET_REJECTED", error.message);
      }
      throw error;
    }

    const body =
      inspection.svg === undefined
        ? file.buffer
        : Buffer.from(inspection.svg, "utf8");
    const checksum = sha256(body);
    const extension = inspection.mimeType === "image/png" ? "png" : "svg";
    const objectKey = this.objects.objectKey(draftId, checksum, extension);

    const existing = await this.database.draftAsset.findUnique({
      where: { objectKey },
    });
    if (existing !== null) {
      // The same bytes for the same draft are the same asset: a retried
      // upload must not leave a second row or a second object behind.
      return existing;
    }

    await this.objects.put(objectKey, body, inspection.mimeType);

    return this.database.$transaction(async (transaction) => {
      const created = await transaction.draftAsset.upsert({
        where: {
          draftId_entityContentKey_assetType_variant: {
            draftId,
            entityContentKey: upload.entityContentKey,
            assetType: upload.assetType,
            variant: upload.variant,
          },
        },
        create: {
          draftId,
          entityContentKey: upload.entityContentKey,
          assetType: upload.assetType,
          variant: upload.variant,
          objectKey,
          mimeType: inspection.mimeType,
          sha256: checksum,
          width: inspection.widthPx,
          height: inspection.heightPx,
          aspectRatio: inspection.aspectRatio,
          sourceUrl: upload.sourceUrl,
          licenseName: upload.licenseName,
          licenseUrl: upload.licenseUrl ?? null,
          attribution: upload.attribution ?? null,
          replacementReason: upload.replacementReason,
          validationStatus: DraftAssetValidationStatus.VALID,
        },
        update: {
          objectKey,
          mimeType: inspection.mimeType,
          sha256: checksum,
          width: inspection.widthPx,
          height: inspection.heightPx,
          aspectRatio: inspection.aspectRatio,
          sourceUrl: upload.sourceUrl,
          licenseName: upload.licenseName,
          licenseUrl: upload.licenseUrl ?? null,
          attribution: upload.attribution ?? null,
          replacementReason: upload.replacementReason,
          validationStatus: DraftAssetValidationStatus.VALID,
        },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.draft.asset_uploaded",
        targetType: "draft_asset",
        targetId: created.id,
        requestId,
        metadata: {
          draftId: draft.id,
          entityContentKey: upload.entityContentKey,
          assetType: upload.assetType,
          sha256: checksum,
          reason: upload.replacementReason,
        },
      });
      return created;
    });
  }

  async remove(
    actor: AdminUser,
    draftId: string,
    assetId: string,
    requestId: string,
  ): Promise<void> {
    const asset = await this.getOne(draftId, assetId);
    await this.database.$transaction(async (transaction) => {
      await transaction.draftAsset.delete({ where: { id: asset.id } });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.draft.asset_removed",
        targetType: "draft_asset",
        targetId: asset.id,
        requestId,
        metadata: {
          draftId,
          entityContentKey: asset.entityContentKey,
          objectKey: asset.objectKey,
        },
      });
    });
    // The object itself is left for the cleanup job: deleting it here would
    // race a preview that is already in flight, and the job knows what is
    // still referenced.
  }
}
