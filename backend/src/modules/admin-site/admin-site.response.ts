import type { SiteDocumentVersion } from "@prisma/client";

import { hasUnpublishedChanges } from "./admin-site.service";
import type { SiteDocumentRecord } from "./admin-site.service";
import { renderMarkdown } from "./markdown-renderer";

export function toDocumentSummary(
  document: SiteDocumentRecord,
): Record<string, unknown> {
  const published = document.publishedVersion;
  return {
    slug: document.slug,
    locale: document.locale,
    title: document.title,
    revision: document.revision,
    publishedVersion: published === null ? null : published.version,
    publishedAt:
      published === null ? null : published.publishedAt.toISOString(),
    hasUnpublishedChanges: hasUnpublishedChanges(document),
    updatedAt: document.updatedAt.toISOString(),
    updatedByAdminUserId: document.updatedByAdminUserId,
  };
}

export function toDocumentDetail(
  document: SiteDocumentRecord,
): Record<string, unknown> {
  return {
    ...toDocumentSummary(document),
    body: document.body,
    html: renderMarkdown(document.body),
    createdAt: document.createdAt.toISOString(),
    createdByAdminUserId: document.createdByAdminUserId,
  };
}

export function toVersionSummary(
  version: SiteDocumentVersion,
  current: boolean,
): Record<string, unknown> {
  return {
    version: version.version,
    title: version.title,
    note: version.note,
    publishedAt: version.publishedAt.toISOString(),
    publishedByAdminUserId: version.publishedByAdminUserId,
    current,
  };
}

export function toVersionDetail(
  version: SiteDocumentVersion,
  current: boolean,
): Record<string, unknown> {
  return {
    ...toVersionSummary(version, current),
    body: version.body,
    html: version.html,
  };
}
