import { HttpStatus, Injectable } from "@nestjs/common";
import {
  inspectImage,
  sha256,
  UnsafeAssetError,
} from "@country-flags/asset-core";
import { AssetType, DraftAssetValidationStatus, Prisma } from "@prisma/client";
import type { AdminUser, ContentDraft, DraftAsset } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { AdminDraftsService } from "./admin-drafts.service";
import type {
  AssetLocalizations,
  DraftAssetPatchInput,
} from "./admin-drafts.request";
import { inspectSafeArea } from "./asset-safe-area";
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
  validFrom?: string;
  validTo?: string;
  localizations?: AssetLocalizations;
  idempotencyKey?: string;
}

function rejected(code: string, message: string): never {
  throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

function assetNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    "The requested resource was not found",
  );
}

/** A validity date is a calendar day, stored midnight UTC in a DATE column. */
function calendarDay(iso: string | null): Date | null {
  return iso === null ? null : new Date(`${iso}T00:00:00.000Z`);
}

/** The same day on the way out. A DATE has no time of day to report. */
export function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Localizations are stored as one document. Absent means "leave the words
 * alone", so it contributes no column at all rather than an explicit null,
 * which Prisma would read as an instruction to erase them.
 */
function localizationsOf(localizations: AssetLocalizations | undefined): {
  localizations?: Prisma.InputJsonValue;
} {
  return localizations === undefined
    ? {}
    : { localizations: localizations as Prisma.InputJsonValue };
}

/**
 * A drawing may not stop being the symbol before it became one. Checked
 * against what the row will hold after the change, not only against what
 * the request carried: closing a period is usually a one-field patch.
 */
function assertValidityOrdered(
  validFrom: Date | null,
  validTo: Date | null,
): void {
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    rejected(
      "ASSET_VALIDITY_INVERTED",
      "The drawing would stop being the symbol before it became one",
    );
  }
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
      assetNotFound();
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

    // Safe enough to store is not the same as usable on a card. A coat of
    // arms is held to the aspect-fit safe area here, while the editor can
    // still choose a different drawing, rather than at publish time.
    const refusal = inspectSafeArea(upload.assetType, inspection);
    if (refusal !== null) {
      rejected(refusal.code, refusal.message);
    }

    const validFrom = calendarDay(upload.validFrom ?? null);
    const validTo = calendarDay(upload.validTo ?? null);
    assertValidityOrdered(validFrom, validTo);

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
      if (
        existing.entityContentKey !== upload.entityContentKey ||
        existing.assetType !== upload.assetType ||
        existing.variant !== upload.variant
      ) {
        // The object key is the checksum, so these exact bytes are already
        // in this draft as a different symbol. Handing that row back would
        // tell the editor their coat of arms was saved while what they are
        // looking at is somebody else's flag.
        rejected(
          "ASSET_BYTES_ALREADY_USED",
          `These bytes are already in this draft as ${existing.entityContentKey} ${existing.assetType} (${existing.variant})`,
        );
      }
      // The same bytes for the same symbol are the same asset: a retried
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
          validFrom,
          validTo,
          ...localizationsOf(upload.localizations),
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
          validFrom,
          validTo,
          ...localizationsOf(upload.localizations),
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
          variant: upload.variant,
          sha256: checksum,
          reason: upload.replacementReason,
        },
      });
      return created;
    });
  }

  /**
   * Provenance, validity and the symbol's own name and story.
   *
   * The bytes are untouched — replacing a drawing goes through the upload —
   * so this is where a symbol is retired: an editor closes the period, and
   * the row stays where it is with the drawing, the checksum and the licence
   * intact. Deleting it would take the answer out of the draft and leave the
   * audit trail pointing at nothing.
   *
   * The asset lives in its own table, but the draft it belongs to has moved,
   * so the change goes through the same revision guard every other editorial
   * mutation uses and answers with the new draft stamp.
   */
  async update(
    actor: AdminUser,
    draftId: string,
    assetId: string,
    expectedRevision: number,
    changes: DraftAssetPatchInput,
    requestId: string,
  ): Promise<ContentDraft> {
    const asset = await this.getOne(draftId, assetId);
    const validFrom =
      changes.validFrom === undefined
        ? asset.validFrom
        : calendarDay(changes.validFrom);
    const validTo =
      changes.validTo === undefined
        ? asset.validTo
        : calendarDay(changes.validTo);
    assertValidityOrdered(validFrom, validTo);

    // Closing an open period is the act of retiring a symbol, and it reads
    // as one in the audit trail rather than as another metadata edit.
    const retired = asset.validTo === null && validTo !== null;

    return this.drafts.applyDraftChange(
      actor,
      draftId,
      expectedRevision,
      async (transaction) => {
        const changed = await transaction.draftAsset.updateMany({
          where: { id: assetId, draftId },
          data: {
            ...(changes.sourceUrl === undefined
              ? {}
              : { sourceUrl: changes.sourceUrl }),
            ...(changes.licenseName === undefined
              ? {}
              : { licenseName: changes.licenseName }),
            ...(changes.licenseUrl === undefined
              ? {}
              : { licenseUrl: changes.licenseUrl }),
            ...(changes.attribution === undefined
              ? {}
              : { attribution: changes.attribution }),
            ...(changes.replacementReason === undefined
              ? {}
              : { replacementReason: changes.replacementReason }),
            ...(changes.validFrom === undefined ? {} : { validFrom }),
            ...(changes.validTo === undefined ? {} : { validTo }),
            ...localizationsOf(changes.localizations),
          },
        });
        if (changed.count === 0) {
          // Read a moment ago, gone now: something removed it between the
          // two statements, and the revision bump would be a lie.
          assetNotFound();
        }
        return {};
      },
      {
        action: retired
          ? "admin.draft.asset_retired"
          : "admin.draft.asset_updated",
        targetType: "draft_asset",
        targetId: asset.id,
        metadata: {
          draftId,
          entityContentKey: asset.entityContentKey,
          assetType: asset.assetType,
          variant: asset.variant,
          fields: Object.keys(changes).sort(),
          validFrom: validFrom === null ? null : isoDay(validFrom),
          validTo: validTo === null ? null : isoDay(validTo),
        },
      },
      requestId,
    );
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
