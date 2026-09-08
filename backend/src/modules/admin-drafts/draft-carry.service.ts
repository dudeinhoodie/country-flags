import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AdminUser } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { MetricsService } from "../../common/telemetry/metrics.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
import { planCarry } from "./draft-carry";
import type { CarriedAsset, CarriedChange } from "./draft-carry";
import { routeOfFinding } from "./draft-validation.service";
import type { ValidationFinding } from "./draft-validation.service";
import {
  EditorialDocumentService,
  normalizeEditorialDocument,
} from "./editorial-document.service";

/** What the console believed when it asked for the carry. */
export interface CarryExpectation {
  draftRevision: number;
  baseCatalogCommit: string;
}

export interface CarryResult {
  draftId: string;
  revision: number;
  status: string;
  /** The catalog commit the draft was imported from before this call. */
  previousBaseCatalogCommit: string;
  /** The catalog commit it is based on now. */
  baseCatalogCommit: string;
  /** False when the catalog had not moved and nothing was written. */
  carried: boolean;
  incoming: CarriedChange[];
}

function conflict(code: string, message: string, details = {}): never {
  throw new ApiException(HttpStatus.CONFLICT, code, message, details);
}

/**
 * Moves a draft's base forward onto the catalog this deployment carries.
 *
 * `DraftProposalService` refuses a proposal whose base has moved, and it is
 * right to: building the pull request on a stale export would silently
 * revert whatever landed in `master` meanwhile (ADR-014 §4). But that
 * refusal used to be the only answer, and since every merge redeploys dev
 * with a new catalog, it killed drafts wholesale — including the uploaded
 * drawings, which live on the draft row and cannot be re-created by
 * starting again (#395).
 *
 * This is the other answer. It proves, object by object and field by field,
 * that moving the base reverts nothing, and moves it; where it cannot prove
 * that, it refuses *that field* and leaves the draft, its edits and its
 * uploads untouched. The refusal is data, in the same vocabulary validation
 * findings use, so the console can open the object, the tab and the field
 * the collision is about (#356) instead of printing a sentence.
 */
@Injectable()
export class DraftCarryService {
  constructor(
    private readonly database: PrismaService,
    private readonly drafts: AdminDraftsService,
    private readonly catalog: CatalogSourceService,
    private readonly documents: EditorialDocumentService,
    private readonly metrics: MetricsService,
  ) {}

  async carry(
    actor: AdminUser,
    draftId: string,
    expected: CarryExpectation,
    requestId: string,
  ): Promise<CarryResult> {
    const draft = await this.drafts.get(draftId);
    if (draft.revision !== expected.draftRevision) {
      // The same structured refusal every other draft write gives, so the
      // console's recovery dialog reads it without a second shape (#355).
      conflict(
        "DRAFT_REVISION_CONFLICT",
        "The draft changed since it was read; reload before carrying it",
        {
          draftId: draft.id,
          expectedRevision: expected.draftRevision,
          currentRevision: draft.revision,
          updatedAt: draft.updatedAt.toISOString(),
          updatedByAdminUserId: draft.updatedByAdminUserId,
        },
      );
    }
    if (draft.baseCatalogCommit !== expected.baseCatalogCommit) {
      conflict(
        "BASE_CATALOG_MISMATCH",
        "The draft was imported from a different catalog commit than the one this request expects",
        { current: draft.baseCatalogCommit },
      );
    }
    if (draft.proposalUrl !== null) {
      // The branch is already pushed and the pull request already open;
      // moving the document under it would describe a review nobody had.
      // Git rebases the branch, or a fresh draft replaces it.
      conflict(
        "DRAFT_ALREADY_PROPOSED",
        "This draft already has a pull request; update it in git rather than carrying the draft",
        { proposalUrl: draft.proposalUrl },
      );
    }

    const current = this.catalog.read();
    if (current.commit === draft.baseCatalogCommit) {
      this.metrics.recordDraftCarry("unchanged");
      return {
        draftId: draft.id,
        revision: draft.revision,
        status: draft.status,
        previousBaseCatalogCommit: draft.baseCatalogCommit,
        baseCatalogCommit: draft.baseCatalogCommit,
        carried: false,
        incoming: [],
      };
    }

    const base = draft.baseDocument;
    if (base === null) {
      // Drafts started before the base document was recorded cannot be
      // carried: without the document they began from there is no way to
      // tell an edit of theirs from a change of somebody else's, and
      // guessing is exactly the silent revert this whole path exists to
      // prevent. Such a draft is still readable, still exportable, and
      // still proposable while the catalog stands still.
      conflict(
        "DRAFT_BASE_NOT_RECORDED",
        "This draft was started before the catalog it was imported from was recorded, so it cannot be carried forward; export it and start a new draft from the current catalog",
        { draftBase: draft.baseCatalogCommit, current: current.commit },
      );
    }

    const theirs = this.documents.assertValid(
      normalizeEditorialDocument(current.document as Record<string, unknown>),
    );
    const plan = planCarry(
      normalizeEditorialDocument(base as Record<string, unknown>),
      draft.document as Record<string, unknown>,
      theirs,
      await this.uploadsOf(draftId),
    );

    if (plan.collisions.length > 0) {
      this.metrics.recordDraftCarry("collided");
      conflict(
        "CATALOG_CARRY_COLLISION",
        `The catalog and this draft changed the same ${plan.collisions.length === 1 ? "thing" : "things"}; resolve the listed fields before carrying it forward`,
        {
          draftId: draft.id,
          draftBase: draft.baseCatalogCommit,
          current: current.commit,
          collisions: this.withRoutes(plan.collisions, draftId),
        },
      );
    }

    const document = this.documents.assertValid(plan.document);
    const updated = await this.drafts.applyDraftChange(
      actor,
      draftId,
      expected.draftRevision,
      () => ({
        document: document as Prisma.InputJsonValue,
        schemaVersion: document.schemaVersion,
        baseCatalogCommit: current.commit,
        baseDocument: theirs as Prisma.InputJsonValue,
      }),
      {
        action: "admin.draft.carried",
        metadata: {
          fromCatalogCommit: draft.baseCatalogCommit,
          toCatalogCommit: current.commit,
          incoming: plan.incoming.length,
        },
      },
      requestId,
    );

    this.metrics.recordDraftCarry("carried");
    return {
      draftId: updated.id,
      revision: updated.revision,
      status: updated.status,
      previousBaseCatalogCommit: draft.baseCatalogCommit,
      baseCatalogCommit: updated.baseCatalogCommit,
      carried: true,
      incoming: plan.incoming,
    };
  }

  /**
   * The drawings uploaded into this draft, named the way the editorial
   * layer names them: the database spells a symbol in the enum's case and
   * the catalog in lower case, and the merge compares the two.
   */
  private async uploadsOf(draftId: string): Promise<CarriedAsset[]> {
    const rows = await this.database.draftAsset.findMany({
      where: { draftId },
      select: { entityContentKey: true, assetType: true, variant: true },
      orderBy: [{ entityContentKey: "asc" }],
    });
    return rows.map((row) => ({
      entityContentKey: row.entityContentKey,
      assetType: row.assetType.toLowerCase(),
      variant: row.variant,
    }));
  }

  private withRoutes(
    collisions: ValidationFinding[],
    draftId: string,
  ): ValidationFinding[] {
    return collisions.map((finding) => ({
      ...finding,
      route: routeOfFinding(draftId, finding.target),
    }));
  }
}
