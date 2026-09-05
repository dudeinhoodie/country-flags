import { HttpStatus, Injectable } from "@nestjs/common";
import { ContentDraftStatus, DeckStatus, Prisma } from "@prisma/client";
import type { AdminUser, ContentDraft } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { CatalogSourceService } from "./catalog-source.service";
import {
  EditorialDocumentService,
  normalizeEditorialDocument,
} from "./editorial-document.service";
import { stableJson } from "./stable-json";

function draftNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    "The requested resource was not found",
  );
}

/** What the draft looked like when a stale write lost the race. */
interface ConflictingDraft {
  id: string;
  revision: number;
  updatedAt: Date;
  updatedByAdminUserId: string;
}

/**
 * The refusal a stale write gets, with enough in it to recover from.
 *
 * A bare 409 leaves the console with a form full of unsaved words and no way
 * to say what happened, so the editor either loses the work or overwrites a
 * colleague. The body names both revisions, when the draft moved and who
 * moved it, which is what the reload-or-copy dialog is built out of
 * (docs/19-admin-redesign.md §9). Silent last-write-wins is forbidden.
 */
function draftRevisionConflict(
  draft: ConflictingDraft,
  expectedRevision: number,
): never {
  throw new ApiException(
    HttpStatus.CONFLICT,
    "DRAFT_REVISION_CONFLICT",
    "The draft changed since it was read; reload before editing",
    {
      draftId: draft.id,
      expectedRevision,
      currentRevision: draft.revision,
      updatedAt: draft.updatedAt.toISOString(),
      updatedByAdminUserId: draft.updatedByAdminUserId,
    },
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
    return {
      ...draft,
      document: normalizeEditorialDocument(
        draft.document as Record<string, unknown>,
      ) as ContentDraft["document"],
    };
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
   * revision, derive the next document, then update with the revision in the
   * WHERE clause so two racing writers cannot both win.
   */
  async applyDocumentChange(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    mutate: (current: Record<string, unknown>) => Record<string, unknown>,
    audit: { action: string; metadata: Prisma.InputJsonObject },
    requestId: string,
  ): Promise<ContentDraft> {
    return this.applyDraftChange(
      actor,
      draftId,
      expectedRevision,
      (_transaction, current) => {
        const next = this.documents.assertValid(mutate(current));
        return {
          document: next as Prisma.InputJsonValue,
          schemaVersion: next.schemaVersion,
        };
      },
      audit,
      requestId,
    );
  }

  /**
   * The one place optimistic concurrency lives. Every editorial mutation —
   * documents, decks, assets — comes through here: read under the expected
   * revision, let the caller make its own change inside the same
   * transaction, then move the revision on with the old one still in the
   * WHERE clause, so a stale tab loses instead of overwriting a colleague.
   *
   * The caller returns whatever else the draft row should carry. An asset
   * change returns nothing: the drawing lives in its own table, but the
   * draft it belongs to has still moved, and a reader holding the old
   * revision has still gone stale.
   */
  async applyDraftChange(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    change: (
      transaction: Prisma.TransactionClient,
      currentDocument: Record<string, unknown>,
    ) =>
      | Promise<Prisma.ContentDraftUpdateManyMutationInput>
      | Prisma.ContentDraftUpdateManyMutationInput,
    audit: {
      action: string;
      /** Defaults to the draft; an asset change names the asset instead. */
      targetType?: string;
      targetId?: string;
      metadata: Prisma.InputJsonObject;
    },
    requestId: string,
  ): Promise<ContentDraft> {
    return this.database.$transaction(async (transaction) => {
      const draft = await transaction.contentDraft.findUnique({
        where: { id: draftId },
        select: {
          id: true,
          revision: true,
          status: true,
          document: true,
          updatedAt: true,
          updatedByAdminUserId: true,
        },
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
        draftRevisionConflict(draft, expectedRevision);
      }

      const extra = await change(
        transaction,
        normalizeEditorialDocument(draft.document as Record<string, unknown>),
      );
      const updated = await transaction.contentDraft.updateMany({
        where: { id: draftId, revision: expectedRevision },
        data: {
          ...extra,
          revision: expectedRevision + 1,
          status: ContentDraftStatus.DRAFT,
          validationReport: Prisma.DbNull,
          updatedByAdminUserId: actor.id,
        },
      });
      if (updated.count === 0) {
        // The revision moved between the read and the write. Re-read it so
        // the answer carries the same detail the first check gives, rather
        // than a bare 409 the console cannot recover from.
        const current = await transaction.contentDraft.findUnique({
          where: { id: draftId },
          select: {
            id: true,
            revision: true,
            updatedAt: true,
            updatedByAdminUserId: true,
          },
        });
        if (current === null) {
          draftNotFound();
        }
        draftRevisionConflict(current, expectedRevision);
      }
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: audit.action,
        targetType: audit.targetType ?? "content_draft",
        targetId: audit.targetId ?? draftId,
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

  /** What the draft would replace, for validation and for the diff. */
  async draftAssetsOf(draftId: string): Promise<
    {
      entityContentKey: string;
      assetType: string;
      licenseName: string | null;
      sourceUrl: string | null;
      replacementReason: string | null;
    }[]
  > {
    const rows = await this.database.draftAsset.findMany({
      where: { draftId },
      select: {
        entityContentKey: true,
        assetType: true,
        licenseName: true,
        sourceUrl: true,
        replacementReason: true,
      },
      orderBy: { entityContentKey: "asc" },
    });
    // The editorial layer names a symbol in lower case; the database names
    // it in the enum's. Validation compares them, so one of the two has to
    // give, and the document is the thing an editor reads.
    return rows.map((row) => ({
      ...row,
      assetType: row.assetType.toLowerCase(),
    }));
  }

  /**
   * How the active release publishes each deck's access, which is what a
   * draft is checked against: making a shipped free deck paid takes it away
   * from everybody who has it.
   */
  async publishedDeckAccess(): Promise<
    {
      code: string;
      accessModel: "FREE" | "ENTITLEMENT";
      requiredEntitlementKey: string | null;
    }[]
  > {
    const decks = await this.database.deck.findMany({
      where: { status: DeckStatus.PUBLISHED },
      select: {
        code: true,
        accessModel: true,
        requiredEntitlementKey: true,
      },
      orderBy: { code: "asc" },
    });
    return decks.map((deck) => ({
      code: deck.code,
      accessModel: deck.accessModel,
      requiredEntitlementKey: deck.requiredEntitlementKey,
    }));
  }

  /**
   * The validation report is stored on the draft rather than only returned:
   * the release screen, the proposal check and the audit trail all read the
   * same verdict instead of three re-runs that could disagree.
   */
  async storeValidationReport(
    draftId: string,
    report: Prisma.InputJsonValue,
    blocking: number,
  ): Promise<ContentDraft> {
    await this.database.contentDraft.updateMany({
      where: { id: draftId },
      data: {
        validationReport: report,
        status:
          blocking === 0 ? ContentDraftStatus.READY : ContentDraftStatus.FAILED,
      },
    });
    return this.get(draftId);
  }

  async exportDocument(
    draftId: string,
  ): Promise<{ content: string; filename: string }> {
    const draft = await this.get(draftId);
    return { content: stableJson(draft.document), filename: "catalog.json" };
  }
}
