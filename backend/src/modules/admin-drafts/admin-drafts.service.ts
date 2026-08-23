import { HttpStatus, Injectable } from "@nestjs/common";
import { ContentDraftStatus, Prisma } from "@prisma/client";
import type { AdminUser, ContentDraft } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { CatalogSourceService } from "./catalog-source.service";
import { EditorialDocumentService } from "./editorial-document.service";
import { stableJson } from "./stable-json";

function draftNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    "The requested resource was not found",
  );
}

@Injectable()
export class AdminDraftsService {
  constructor(
    private readonly database: PrismaService,
    private readonly documents: EditorialDocumentService,
    private readonly catalog: CatalogSourceService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(
    offset: number,
    limit: number,
  ): Promise<{ items: ContentDraft[]; total: number }> {
    const [items, total] = await this.database.$transaction([
      this.database.contentDraft.findMany({
        orderBy: { updatedAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.database.contentDraft.count(),
    ]);
    return { items, total };
  }

  async get(draftId: string): Promise<ContentDraft> {
    const draft = await this.database.contentDraft.findUnique({
      where: { id: draftId },
    });
    if (draft === null) {
      draftNotFound();
    }
    return draft;
  }

  async create(actor: AdminUser, requestId: string): Promise<ContentDraft> {
    const snapshot = this.catalog.read();
    const document = this.documents.assertValid(snapshot.document);

    const pointer = await this.database.contentPointer.findUnique({
      where: { key: "active" },
      select: { contentVersion: true },
    });
    if (pointer === null) {
      // A draft diffs and releases against the active version; without one
      // there is nothing to base the editorial cycle on.
      throw new ApiException(
        HttpStatus.CONFLICT,
        "NO_ACTIVE_RELEASE",
        "A draft requires an active content release to start from",
      );
    }

    return this.database.$transaction(async (transaction) => {
      const draft = await transaction.contentDraft.create({
        data: {
          baseContentVersion: pointer.contentVersion,
          baseCatalogCommit: snapshot.commit,
          schemaVersion: document.schemaVersion,
          document: document as Prisma.InputJsonValue,
          createdByAdminUserId: actor.id,
          updatedByAdminUserId: actor.id,
        },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.draft.created",
        targetType: "content_draft",
        targetId: draft.id,
        requestId,
        metadata: {
          baseContentVersion: draft.baseContentVersion,
          baseCatalogCommit: draft.baseCatalogCommit,
        },
      });
      return draft;
    });
  }

  async updateDocument(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    documentInput: Record<string, unknown>,
    requestId: string,
  ): Promise<ContentDraft> {
    const document = this.documents.assertValid(documentInput);
    return this.applyDocumentChange(
      actor,
      draftId,
      expectedRevision,
      () => document,
      {
        action: "admin.draft.document_updated",
        metadata: {
          fromRevision: expectedRevision,
          toRevision: expectedRevision + 1,
        },
      },
      requestId,
    );
  }

  /**
   * The one write path for a draft document: read under the expected
   * revision, let the caller derive the next document, then update with the
   * revision in the WHERE clause so two racing writers cannot both win.
   * Every editorial mutation (documents, decks, later assets) goes through
   * here, which is what keeps optimistic concurrency in one place.
   */
  async applyDocumentChange(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    mutate: (current: Record<string, unknown>) => Record<string, unknown>,
    audit: { action: string; metadata: Prisma.InputJsonObject },
    requestId: string,
  ): Promise<ContentDraft> {
    return this.database.$transaction(async (transaction) => {
      const draft = await transaction.contentDraft.findUnique({
        where: { id: draftId },
        select: { id: true, revision: true, status: true, document: true },
      });
      if (draft === null) {
        draftNotFound();
      }
      if (draft.status === ContentDraftStatus.MERGED) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "DRAFT_NOT_EDITABLE",
          "A merged draft is history and cannot be edited",
        );
      }
      if (draft.revision !== expectedRevision) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "DRAFT_REVISION_CONFLICT",
          "The draft changed since it was read; reload before editing",
          { currentRevision: draft.revision },
        );
      }

      const next = this.documents.assertValid(
        mutate(draft.document as Record<string, unknown>),
      );
      const updated = await transaction.contentDraft.updateMany({
        where: { id: draftId, revision: expectedRevision },
        data: {
          document: next as Prisma.InputJsonValue,
          schemaVersion: next.schemaVersion,
          revision: expectedRevision + 1,
          status: ContentDraftStatus.DRAFT,
          validationReport: Prisma.DbNull,
          updatedByAdminUserId: actor.id,
        },
      });
      if (updated.count === 0) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "DRAFT_REVISION_CONFLICT",
          "The draft changed since it was read; reload before editing",
        );
      }
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: audit.action,
        targetType: "content_draft",
        targetId: draftId,
        requestId,
        metadata: audit.metadata,
      });
      const result = await transaction.contentDraft.findUnique({
        where: { id: draftId },
      });
      if (result === null) {
        draftNotFound();
      }
      return result;
    });
  }

  async exportDocument(
    draftId: string,
  ): Promise<{ content: string; filename: string }> {
    const draft = await this.get(draftId);
    return { content: stableJson(draft.document), filename: "catalog.json" };
  }
}
