import { HttpStatus, Injectable } from "@nestjs/common";
import { AssetType, ContentDraftStatus } from "@prisma/client";
import type { AdminUser, ContentDraft, DraftAsset } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { liftEditorialDocumentToV3 } from "./editorial-document.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
import { DraftObjectStore } from "./draft-object-storage";
import { GitHubClient } from "./github-client";
import type { CommittedFile } from "./github-client";
import { stableJson } from "./stable-json";
import type { DraftDiff } from "./draft-diff.service";
import type { ValidationReport } from "./draft-validation.service";

export interface ProposalExpectation {
  draftRevision: number;
  baseContentVersion: string;
  baseCatalogCommit: string;
}

export interface ProposalResult {
  draftId: string;
  status: string;
  proposalUrl: string;
  pullRequestNumber: number;
}

const CATALOG_PATH = "tools/content-pipeline/editorial/catalog.json";
const OVERRIDE_DIRECTORY = "tools/content-pipeline/editorial/overrides/assets";

function conflict(code: string, message: string, details = {}): never {
  throw new ApiException(HttpStatus.CONFLICT, code, message, details);
}

const EDITORIAL_ASSET_TYPE: Record<string, string> = {
  [AssetType.FLAG]: "flag",
  [AssetType.COAT_OF_ARMS]: "coat_of_arms",
  [AssetType.MAP]: "map",
};

interface EditorialAssetOverrideEntry extends Record<string, unknown> {
  entityKey: string;
  assetType: string;
  variant: string;
  aspectRatio: number;
  license: string;
  sourceUrl: string;
  attribution?: string;
  reason: string;
}

/**
 * Turns a validated draft into a reviewable pull request.
 *
 * Everything here exists to keep git the single merge point: the console
 * writes a branch and a draft PR, never the base branch, and it refuses
 * outright when the catalog it started from has moved on — opening a PR on
 * top of somebody else's change is exactly the silent overwrite the
 * ownership split was designed to prevent (ADR-014 §4).
 */
@Injectable()
export class DraftProposalService {
  constructor(
    private readonly database: PrismaService,
    private readonly drafts: AdminDraftsService,
    private readonly catalog: CatalogSourceService,
    private readonly github: GitHubClient,
    private readonly audit: AdminAuditService,
    private readonly objects: DraftObjectStore,
  ) {}

  async propose(
    actor: AdminUser,
    draftId: string,
    expected: ProposalExpectation,
    diff: DraftDiff,
    requestId: string,
  ): Promise<ProposalResult> {
    const draft = await this.drafts.get(draftId);
    this.assertExpectationsHold(draft, expected);
    this.assertReadyToPropose(draft, diff);

    // The catalog this deployment carries is the one the draft was imported
    // from; if master has moved since, the proposal would be built on a
    // stale base and quietly revert whatever landed meanwhile.
    const current = this.catalog.read();
    if (current.commit !== draft.baseCatalogCommit) {
      conflict(
        "CATALOG_MOVED_ON",
        "The editorial catalog changed since this draft was imported; start a new draft from the current catalog",
        { draftBase: draft.baseCatalogCommit, current: current.commit },
      );
    }

    if (draft.proposalUrl !== null) {
      // A repeated proposal is a retry, not a second pull request.
      return {
        draftId: draft.id,
        status: draft.status,
        proposalUrl: draft.proposalUrl,
        pullRequestNumber: 0,
      };
    }

    const branch = `admin/draft-${draft.id}`;
    const files = await this.committedFiles(draft);
    await this.github.commitFiles(
      branch,
      `chore(content): editorial changes from draft ${draft.id}`,
      files,
    );
    const pull = await this.github.openDraftPullRequest(
      branch,
      `chore(content): editorial changes from the admin console`,
      this.pullRequestBody(draft, diff),
    );

    const updated = await this.database.$transaction(async (transaction) => {
      const stored = await transaction.contentDraft.update({
        where: { id: draft.id },
        data: {
          proposalUrl: pull.url,
          status: ContentDraftStatus.PROPOSED,
        },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.draft.proposed",
        targetType: "content_draft",
        targetId: draft.id,
        requestId,
        metadata: {
          branch,
          pullRequest: pull.url,
          revision: draft.revision,
        },
      });
      return stored;
    });

    return {
      draftId: updated.id,
      status: updated.status,
      proposalUrl: pull.url,
      pullRequestNumber: pull.number,
    };
  }

  /**
   * The catalog document and, beside it, every uploaded drawing: an override
   * whose bytes stayed in the draft bucket would be a catalog claiming a
   * replacement the build cannot find. The `assetOverrides` entries carry
   * the provenance the upload collected, merged over whatever the catalog
   * already declared for the same entity.
   */
  private async committedFiles(draft: ContentDraft): Promise<CommittedFile[]> {
    const uploaded = await this.database.draftAsset.findMany({
      where: { draftId: draft.id },
      orderBy: [{ entityContentKey: "asc" }],
    });

    const document = draft.document as Record<string, unknown>;
    const files: CommittedFile[] = [];
    const entries: EditorialAssetOverrideEntry[] = [];
    for (const asset of uploaded) {
      entries.push(this.overrideEntry(asset));
      const bytes = await this.objects.get(asset.objectKey);
      if (bytes === null) {
        conflict(
          "DRAFT_ASSET_BYTES_MISSING",
          `The uploaded file for ${asset.entityContentKey} is no longer in the draft store; upload it again`,
        );
      }
      const extension = asset.mimeType === "image/png" ? "png" : "svg";
      const entry = entries[entries.length - 1];
      files.push({
        // Typed path: one entity holds several symbols, and under the old
        // flat name a coat of arms and a flag would have fought over one
        // file (ADR-020).
        path: `${OVERRIDE_DIRECTORY}/${asset.entityContentKey}/${String(entry?.assetType)}/${String(entry?.variant)}.${extension}`,
        content: bytes,
      });
    }

    const existing = (
      Array.isArray(document.assetOverrides) ? document.assetOverrides : []
    ) as EditorialAssetOverrideEntry[];
    const symbolKey = (entry: EditorialAssetOverrideEntry): string =>
      `${entry.entityKey}\u0000${String(entry.assetType)}\u0000${String(entry.variant ?? "current")}`;
    const replaced = new Set(entries.map(symbolKey));
    const merged = [
      ...existing.filter((entry) => !replaced.has(symbolKey(entry))),
      ...entries,
    ].sort((left, right) =>
      symbolKey(left).localeCompare(symbolKey(right), "en"),
    );

    // An override entry now names what the drawing depicts and which variant
    // it is, and v2 knows neither: its `assetType` is the single value
    // `flag` and it refuses an unknown field outright. So a document that
    // carries one is lifted, which is also the flip the catalog has been
    // waiting for — the console can read and write both versions since #350,
    // and the pipeline has read both since #342.
    const committedDocument =
      merged.length === 0
        ? document
        : { ...liftEditorialDocumentToV3(document), assetOverrides: merged };
    files.unshift({
      path: CATALOG_PATH,
      content: Buffer.from(stableJson(committedDocument), "utf8"),
    });
    return files;
  }

  private overrideEntry(asset: DraftAsset): EditorialAssetOverrideEntry {
    const assetType = EDITORIAL_ASSET_TYPE[asset.assetType];
    if (assetType === undefined) {
      conflict(
        "DRAFT_ASSET_NOT_EXPRESSIBLE",
        `The editorial override layer has no name for a ${asset.assetType} upload; remove the one for ${asset.entityContentKey}`,
      );
    }
    const aspectRatio =
      asset.aspectRatio === null ? null : Number(asset.aspectRatio);
    if (
      aspectRatio === null ||
      asset.licenseName === null ||
      asset.sourceUrl === null ||
      asset.replacementReason === null
    ) {
      // The upload path requires all of these today; a row without them
      // predates that rule, and a release must not publish an image nobody
      // can account for.
      conflict(
        "DRAFT_ASSET_PROVENANCE_MISSING",
        `The upload for ${asset.entityContentKey} is missing its provenance; upload it again with a license, a source and a reason`,
      );
    }
    return {
      entityKey: asset.entityContentKey,
      assetType,
      variant: asset.variant,
      aspectRatio,
      license: asset.licenseName,
      sourceUrl: asset.sourceUrl,
      ...(asset.attribution === null ? {} : { attribution: asset.attribution }),
      reason: asset.replacementReason,
    };
  }

  private assertExpectationsHold(
    draft: ContentDraft,
    expected: ProposalExpectation,
  ): void {
    if (draft.revision !== expected.draftRevision) {
      conflict(
        "DRAFT_REVISION_CONFLICT",
        "The draft changed since it was read; reload before proposing",
        { currentRevision: draft.revision },
      );
    }
    if (draft.baseContentVersion !== expected.baseContentVersion) {
      conflict(
        "BASE_VERSION_MISMATCH",
        "The draft was started from a different content version than the one this request expects",
        { current: draft.baseContentVersion },
      );
    }
    if (draft.baseCatalogCommit !== expected.baseCatalogCommit) {
      conflict(
        "BASE_CATALOG_MISMATCH",
        "The draft was imported from a different catalog commit than the one this request expects",
        { current: draft.baseCatalogCommit },
      );
    }
  }

  private assertReadyToPropose(draft: ContentDraft, diff: DraftDiff): void {
    const report = draft.validationReport as ValidationReport | null;
    if (report === null) {
      conflict("DRAFT_NOT_VALIDATED", "Validate the draft before proposing it");
    }
    if (report.blocking > 0) {
      conflict(
        "DRAFT_HAS_BLOCKING_FINDINGS",
        `The draft has ${String(report.blocking)} blocking findings; a release cannot be proposed until they are fixed`,
      );
    }
    if (diff.isEmpty) {
      conflict(
        "NOTHING_TO_RELEASE",
        "This draft matches the active version, so there is nothing to propose",
      );
    }
  }

  /**
   * The body is what a reviewer reads before merging, so it carries the
   * same diff and verdict the editor saw rather than a link to them.
   */
  private pullRequestBody(draft: ContentDraft, diff: DraftDiff): string {
    const report = draft.validationReport as ValidationReport | null;
    const lines = [
      "## Editorial changes from the admin console",
      "",
      `- Draft: \`${draft.id}\` (revision ${String(draft.revision)})`,
      `- Based on content version: \`${draft.baseContentVersion}\``,
      `- Based on catalog commit: \`${draft.baseCatalogCommit}\``,
      "",
      "### What changes",
      "",
    ];
    for (const deck of diff.decks) {
      lines.push(
        `- Deck \`${deck.deckKey ?? deck.publishedCode ?? "unknown"}\` ${deck.change}`,
      );
      for (const detail of deck.details) {
        lines.push(`  - ${detail}`);
      }
    }
    for (const entity of diff.entities) {
      lines.push(`- Entity \`${entity.entityKey}\` changed`);
      for (const detail of entity.details) {
        lines.push(`  - ${detail}`);
      }
    }
    for (const asset of diff.assets) {
      lines.push(
        `- ${asset.assetType} replaced for \`${asset.entityContentKey}\`${
          asset.reason === null ? "" : `: ${asset.reason}`
        }`,
      );
    }
    lines.push(
      "",
      "### Validation",
      "",
      report === null
        ? "- Not validated."
        : `- ${String(report.blocking)} blocking, ${String(report.warnings)} warnings (checked ${report.validatedAt}).`,
    );
    if (report !== null && report.warnings > 0) {
      for (const finding of report.findings.filter(
        (entry) => entry.level === "warning",
      )) {
        lines.push(`  - ${finding.subject}: ${finding.message}`);
      }
    }
    lines.push(
      "",
      "Merging this does not publish anything: a release is still an",
      "intentional run of the publish workflow.",
    );
    return lines.join("\n");
  }
}
