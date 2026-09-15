import { DEFAULT_LANGUAGE } from "../i18n/language";

/**
 * The published documents, as the backend writes them into the bucket the
 * site reads. Nothing here talks to the API: the console publishes a
 * snapshot, and the page reads the snapshot, so the documents answer whether
 * or not the backend is up — which is the point of a privacy policy an app
 * links to.
 */

export interface DocumentSummary {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly version: number;
  readonly publishedAt: string;
}

export interface DocumentIndex {
  readonly generatedAt: string | null;
  readonly documents: readonly DocumentSummary[];
}

export interface PublishedDocument extends DocumentSummary {
  readonly html: string;
}

/** The snapshot could not be read at all — as opposed to a document not being in it. */
export class DocumentsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentsUnavailableError";
  }
}

export const DOCUMENTS_BASE = "/documents";

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function isDocumentSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSummary(value: unknown): DocumentSummary {
  if (
    !isRecord(value) ||
    typeof value.slug !== "string" ||
    typeof value.locale !== "string" ||
    typeof value.title !== "string" ||
    typeof value.version !== "number" ||
    typeof value.publishedAt !== "string"
  ) {
    throw new DocumentsUnavailableError("A document entry is malformed");
  }
  return {
    slug: value.slug,
    locale: value.locale,
    title: value.title,
    version: value.version,
    publishedAt: value.publishedAt,
  };
}

export function parseIndex(value: unknown): DocumentIndex {
  if (!isRecord(value) || !Array.isArray(value.documents)) {
    throw new DocumentsUnavailableError("The document index is malformed");
  }
  return {
    generatedAt:
      typeof value.generatedAt === "string" ? value.generatedAt : null,
    documents: value.documents.map(readSummary),
  };
}

export function parseDocument(value: unknown): PublishedDocument {
  const summary = readSummary(value);
  if (!isRecord(value) || typeof value.html !== "string") {
    throw new DocumentsUnavailableError("The document has no html");
  }
  return { ...summary, html: value.html };
}

type Answer = { found: false } | { found: true; body: unknown };

async function readJson(url: string): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (cause) {
    throw new DocumentsUnavailableError(
      cause instanceof Error ? cause.message : "The request failed",
    );
  }
  // The bucket answers a missing object with 404 and an XML body; only the
  // status is read, so the body never matters.
  if (response.status === 404) {
    return { found: false };
  }
  if (!response.ok) {
    throw new DocumentsUnavailableError(
      `${url} answered ${String(response.status)}`,
    );
  }
  try {
    return { found: true, body: await response.json() };
  } catch {
    throw new DocumentsUnavailableError(`${url} is not JSON`);
  }
}

/** A missing index is an empty one: a site with nothing published yet is a working site. */
export async function fetchIndex(): Promise<DocumentIndex> {
  const answer = await readJson(`${DOCUMENTS_BASE}/index.json`);
  if (!answer.found) {
    return { generatedAt: null, documents: [] };
  }
  return parseIndex(answer.body);
}

export async function fetchDocument(
  slug: string,
  locale: string,
): Promise<PublishedDocument | null> {
  const answer = await readJson(
    `${DOCUMENTS_BASE}/${encodeURIComponent(slug)}.${encodeURIComponent(locale)}.json`,
  );
  return answer.found ? parseDocument(answer.body) : null;
}

/**
 * Which edition of a document the reader gets: theirs if it exists, English
 * if not, and whatever is published if not even that. Null means the slug
 * is not published in any language.
 */
export function chooseLocale(
  index: DocumentIndex,
  slug: string,
  requested: string,
): string | null {
  const editions = index.documents.filter((entry) => entry.slug === slug);
  const exact = editions.find((entry) => entry.locale === requested);
  if (exact !== undefined) {
    return exact.locale;
  }
  const fallback = editions.find((entry) => entry.locale === DEFAULT_LANGUAGE);
  if (fallback !== undefined) {
    return fallback.locale;
  }
  return editions[0]?.locale ?? null;
}

/** One entry per slug, in the language the reader would get for each. */
export function documentsFor(
  index: DocumentIndex,
  language: string,
): DocumentSummary[] {
  const slugs = [...new Set(index.documents.map((entry) => entry.slug))];
  const chosen: DocumentSummary[] = [];
  for (const slug of slugs) {
    const locale = chooseLocale(index, slug, language);
    const entry = index.documents.find(
      (candidate) => candidate.slug === slug && candidate.locale === locale,
    );
    if (entry !== undefined) {
      chosen.push(entry);
    }
  }
  return chosen;
}
