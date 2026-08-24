import { HttpStatus, Injectable } from "@nestjs/common";
import { ContentDraftStatus } from "@prisma/client";
import type { AdminUser, ContentDraft } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { AdminDraftsService } from "./admin-drafts.service";
import { CatalogSourceService } from "./catalog-source.service";
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

function conflict(code: string, message: string, details = {}): never {
  throw new ApiException(HttpStatus.CONFLICT, code, message, details);
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
    const files: CommittedFile[] = [
      {
        path: CATALOG_PATH,
        content: Buffer.from(stableJson(draft.document), "utf8"),
      },
    ];
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
