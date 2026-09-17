import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AdminUser,
  SiteDocument,
  SiteDocumentVersion,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import type {
  SiteDocumentCreateRequest,
  SiteDocumentPublishRequest,
  SiteDocumentUpdateRequest,
} from "./admin-site.request";
import { renderMarkdown } from "./markdown-renderer";
import { buildSnapshotIndex } from "./site-snapshot";
import type { SnapshotDocumentEntry } from "./site-snapshot";
import {
  describeSiteObjectStorage,
  SiteSnapshotStore,
} from "./site-snapshot-store";

export type SiteDocumentRecord = SiteDocument & {
  publishedVersion: SiteDocumentVersion | null;
};

export interface SiteStatus {
  snapshotConfigured: boolean;
  snapshotBaseUrl: string | null;
  siteUrl: string | null;
  publishedCount: number;
}

const TARGET_TYPE = "site_document";

function documentNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    "The requested resource was not found",
  );
}

/**
 * The editor read one revision and is writing against another. Refused
 * rather than merged: the two texts are prose, and "last write wins" would
 * lose a colleague's paragraph without anyone noticing.
 */
function revisionConflict(currentRevision: number): never {
  throw new ApiException(
    HttpStatus.CONFLICT,
    "SITE_DOCUMENT_REVISION_CONFLICT",
    "The document changed since it was read",
    { currentRevision },
  );
}

/** Whether the site would show something other than the draft. */
export function hasUnpublishedChanges(document: SiteDocumentRecord): boolean {
  const published = document.publishedVersion;
  return (
    published === null ||
    published.title !== document.title ||
    published.body !== document.body
  );
}

/**
 * The site's documents as the console works on them (ADR-023).
 *
 * Every write goes through a transaction that checks the revision the
 * caller read, and every write leaves an audit row. Publishing is the one
 * operation with a side effect outside the database — the snapshot the site
 * reads — and it is done after the version is committed: a version the
 * bucket does not yet carry is repaired by publishing again, while a bucket
 * file no version stands behind would be a page nobody could explain.
 */
@Injectable()
export class AdminSiteService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly snapshot: SiteSnapshotStore,
    private readonly siteUrl: string | null,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async status(): Promise<SiteStatus> {
    const storage = describeSiteObjectStorage(this.environment);
    const publishedCount = await this.database.siteDocument.count({
      where: { publishedVersionId: { not: null } },
    });
    return {
      snapshotConfigured: storage.configured,
      snapshotBaseUrl: storage.publicBaseUrl,
      siteUrl: this.siteUrl,
      publishedCount,
    };
  }

  list(): Promise<SiteDocumentRecord[]> {
    return this.database.siteDocument.findMany({
      include: { publishedVersion: true },
      orderBy: [{ slug: "asc" }, { locale: "asc" }],
    });
  }

  async get(slug: string, locale: string): Promise<SiteDocumentRecord> {
    const document = await this.database.siteDocument.findUnique({
      where: { slug_locale: { slug, locale } },
      include: { publishedVersion: true },
    });
    if (document === null) {
      documentNotFound();
    }
    return document;
  }

  async create(
    actor: AdminUser,
    request: SiteDocumentCreateRequest,
    requestId: string,
  ): Promise<SiteDocumentRecord> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const created = await transaction.siteDocument.create({
          data: {
            slug: request.slug,
            locale: request.locale,
            title: request.title,
            body: request.body,
            createdByAdminUserId: actor.id,
            updatedByAdminUserId: actor.id,
          },
          include: { publishedVersion: true },
        });
        await this.audit.record(transaction, {
          actorAdminUserId: actor.id,
          action: "site.document.created",
          targetType: TARGET_TYPE,
          targetId: created.id,
          requestId,
          metadata: { slug: created.slug, locale: created.locale },
        });
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "SITE_DOCUMENT_EXISTS",
          "That document already exists in that locale",
          { slug: request.slug, locale: request.locale },
        );
      }
      throw error;
    }
  }

  update(
    actor: AdminUser,
    slug: string,
    locale: string,
    request: SiteDocumentUpdateRequest,
    requestId: string,
  ): Promise<SiteDocumentRecord> {
    return this.writeDraft(actor, slug, locale, request.revision, requestId, {
      action: "site.document.updated",
      changes: {
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.body === undefined ? {} : { body: request.body }),
      },
      metadata: {
        fields: Object.keys(request).filter((k) => k !== "revision"),
      },
    });
  }

  async restore(
    actor: AdminUser,
    slug: string,
    locale: string,
    version: number,
    revision: number,
    requestId: string,
  ): Promise<SiteDocumentRecord> {
    const record = await this.getVersion(slug, locale, version);
    return this.writeDraft(actor, slug, locale, revision, requestId, {
      action: "site.document.restored",
      changes: { title: record.title, body: record.body },
      metadata: { version },
    });
  }

  async publish(
    actor: AdminUser,
    slug: string,
    locale: string,
    request: SiteDocumentPublishRequest,
    requestId: string,
  ): Promise<SiteDocumentRecord> {
    const published = await this.database.$transaction(async (transaction) => {
      const document = await transaction.siteDocument.findUnique({
        where: { slug_locale: { slug, locale } },
      });
      if (document === null) {
        documentNotFound();
      }
      if (document.revision !== request.revision) {
        revisionConflict(document.revision);
      }
      if (document.body.trim().length === 0) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "SITE_DOCUMENT_EMPTY",
          "An empty document cannot be published",
        );
      }
      const latest = await transaction.siteDocumentVersion.aggregate({
        where: { documentId: document.id },
        _max: { version: true },
      });
      const version = await transaction.siteDocumentVersion.create({
        data: {
          documentId: document.id,
          version: (latest._max.version ?? 0) + 1,
          title: document.title,
          body: document.body,
          html: renderMarkdown(document.body),
          note: request.note ?? null,
          publishedByAdminUserId: actor.id,
        },
      });
      const updated = await transaction.siteDocument.update({
        where: { id: document.id },
        data: { publishedVersionId: version.id },
        include: { publishedVersion: true },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "site.document.published",
        targetType: TARGET_TYPE,
        targetId: document.id,
        requestId,
        metadata: {
          slug,
          locale,
          version: version.version,
          ...(request.note === undefined ? {} : { note: request.note }),
        },
      });
      return updated;
    });

    const current = published.publishedVersion;
    if (current !== null) {
      await this.snapshot.writeDocument({
        slug: published.slug,
        locale: published.locale,
        title: current.title,
        version: current.version,
        publishedAt: current.publishedAt.toISOString(),
        html: current.html,
      });
    }
    await this.rebuildIndex();
    return published;
  }

  async unpublish(
    actor: AdminUser,
    slug: string,
    locale: string,
    requestId: string,
  ): Promise<SiteDocumentRecord> {
    const document = await this.database.$transaction(async (transaction) => {
      const existing = await transaction.siteDocument.findUnique({
        where: { slug_locale: { slug, locale } },
        include: { publishedVersion: true },
      });
      if (existing === null) {
        documentNotFound();
      }
      if (existing.publishedVersion === null) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "SITE_DOCUMENT_NOT_PUBLISHED",
          "The document is not published",
        );
      }
      const updated = await transaction.siteDocument.update({
        where: { id: existing.id },
        data: { publishedVersionId: null },
        include: { publishedVersion: true },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "site.document.unpublished",
        targetType: TARGET_TYPE,
        targetId: existing.id,
        requestId,
        metadata: {
          slug,
          locale,
          version: existing.publishedVersion.version,
        },
      });
      return updated;
    });

    await this.snapshot.removeDocument(slug, locale);
    await this.rebuildIndex();
    return document;
  }

  async delete(
    actor: AdminUser,
    slug: string,
    locale: string,
    requestId: string,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const existing = await transaction.siteDocument.findUnique({
        where: { slug_locale: { slug, locale } },
      });
      if (existing === null) {
        documentNotFound();
      }
      if (existing.publishedVersionId !== null) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "SITE_DOCUMENT_PUBLISHED",
          "A published document cannot be deleted; unpublish it first",
        );
      }
      await transaction.siteDocument.delete({ where: { id: existing.id } });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "site.document.deleted",
        targetType: TARGET_TYPE,
        targetId: existing.id,
        requestId,
        metadata: { slug, locale },
      });
    });
  }

  async listVersions(
    slug: string,
    locale: string,
  ): Promise<{ versions: SiteDocumentVersion[]; currentId: string | null }> {
    const document = await this.get(slug, locale);
    const versions = await this.database.siteDocumentVersion.findMany({
      where: { documentId: document.id },
      orderBy: { version: "desc" },
    });
    return { versions, currentId: document.publishedVersionId };
  }

  async getVersion(
    slug: string,
    locale: string,
    version: number,
  ): Promise<SiteDocumentVersion & { current: boolean }> {
    const document = await this.get(slug, locale);
    const record = await this.database.siteDocumentVersion.findUnique({
      where: { documentId_version: { documentId: document.id, version } },
    });
    if (record === null) {
      documentNotFound();
    }
    return { ...record, current: record.id === document.publishedVersionId };
  }

  preview(body: string): string {
    return renderMarkdown(body);
  }

  /**
   * The index names everything published, so it is rebuilt from the
   * database rather than edited: the file is then right whatever order
   * publishes and unpublishes happened in, and whatever a previous write
   * left behind.
   */
  async rebuildIndex(): Promise<void> {
    const published = await this.database.siteDocument.findMany({
      where: { publishedVersionId: { not: null } },
      include: { publishedVersion: true },
    });
    const entries: SnapshotDocumentEntry[] = [];
    for (const document of published) {
      const version = document.publishedVersion;
      if (version === null) {
        continue;
      }
      entries.push({
        slug: document.slug,
        locale: document.locale,
        title: version.title,
        version: version.version,
        publishedAt: version.publishedAt.toISOString(),
      });
    }
    await this.snapshot.writeIndex(buildSnapshotIndex(entries, new Date()));
  }

  private async writeDraft(
    actor: AdminUser,
    slug: string,
    locale: string,
    revision: number,
    requestId: string,
    write: {
      action: string;
      changes: { title?: string; body?: string };
      metadata: Prisma.InputJsonObject;
    },
  ): Promise<SiteDocumentRecord> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.siteDocument.findUnique({
        where: { slug_locale: { slug, locale } },
      });
      if (existing === null) {
        documentNotFound();
      }
      // The revision is checked inside the UPDATE as well as before it, so
      // two editors racing through the read both cannot win.
      const result = await transaction.siteDocument.updateMany({
        where: { id: existing.id, revision },
        data: {
          ...write.changes,
          revision: { increment: 1 },
          updatedByAdminUserId: actor.id,
        },
      });
      if (result.count === 0) {
        revisionConflict(existing.revision);
      }
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: write.action,
        targetType: TARGET_TYPE,
        targetId: existing.id,
        requestId,
        metadata: { slug, locale, ...write.metadata },
      });
      const updated = await transaction.siteDocument.findUniqueOrThrow({
        where: { id: existing.id },
        include: { publishedVersion: true },
      });
      return updated;
    });
  }
}
