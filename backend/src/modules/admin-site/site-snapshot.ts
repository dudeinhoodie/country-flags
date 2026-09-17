/**
 * The static shape the site reads (ADR-023).
 *
 * Two kinds of file, both JSON, both under `documents/`:
 *
 * - `documents/index.json` — what is published, per slug and locale, so the
 *   home page can list documents and a document page can find its siblings
 *   and its fallback language;
 * - `documents/<slug>.<locale>.json` — one published version, with the HTML
 *   the backend rendered for it.
 *
 * Pure functions: what goes into a file is decided here and tested here,
 * and the store only carries bytes.
 */

export interface SnapshotDocumentEntry {
  slug: string;
  locale: string;
  title: string;
  version: number;
  publishedAt: string;
}

export interface SnapshotIndex {
  generatedAt: string;
  documents: SnapshotDocumentEntry[];
}

export interface SnapshotDocument extends SnapshotDocumentEntry {
  html: string;
}

export const SNAPSHOT_INDEX_KEY = "documents/index.json";

/**
 * A minute: the site's nginx and the reader's browser may keep a copy that
 * long, so a publish shows within a minute and a bucket read is not paid
 * for every visitor.
 */
export const SNAPSHOT_CACHE_CONTROL = "public, max-age=60";

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * The file a document lives in. The pattern checks are a guard on the key,
 * not validation of the request — that happened at the API boundary — so a
 * value that somehow got here with a slash in it cannot name a path.
 */
export function snapshotDocumentKey(slug: string, locale: string): string {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Site document slug ${slug} cannot name a snapshot file`);
  }
  if (!LOCALE_PATTERN.test(locale)) {
    throw new Error(
      `Site document locale ${locale} cannot name a snapshot file`,
    );
  }
  return `documents/${slug}.${locale}.json`;
}

/**
 * Sorted by slug then locale so the file is the same bytes for the same
 * state whatever order the rows came back in — a diff between two
 * publishes then shows only what changed.
 */
export function buildSnapshotIndex(
  entries: readonly SnapshotDocumentEntry[],
  generatedAt: Date,
): SnapshotIndex {
  const documents = [...entries].sort((left, right) =>
    left.slug === right.slug
      ? left.locale.localeCompare(right.locale)
      : left.slug.localeCompare(right.slug),
  );
  return { generatedAt: generatedAt.toISOString(), documents };
}

export function serializeSnapshot(
  value: SnapshotIndex | SnapshotDocument,
): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
