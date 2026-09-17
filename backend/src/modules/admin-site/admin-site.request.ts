import {
  canonicalLocale,
  exactRequestKeys,
  requestRecord,
  requiredString,
  validationError,
} from "../../common/http/request-validation";

/** The page's address on the site: `/privacy`, `/terms`. */
const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const TITLE_MAX = 200;
const BODY_MAX = 200_000;
const NOTE_MAX = 500;

export interface SiteDocumentCreateRequest {
  slug: string;
  locale: string;
  title: string;
  body: string;
}

export interface SiteDocumentUpdateRequest {
  revision: number;
  title?: string;
  body?: string;
}

export interface SiteDocumentPublishRequest {
  revision: number;
  note?: string;
}

export function parseSlug(value: unknown, field = "slug"): string {
  return requiredString(value, field, 1, 63, SLUG_PATTERN);
}

/**
 * Locales are stored as the site addresses them, `en` or `ru` or `pt-BR`:
 * the canonical BCP 47 form, which is also what the app sends in `?lang=`
 * once it has dropped the region.
 */
export function parseLocale(value: unknown, field = "locale"): string {
  return canonicalLocale(value, field);
}

export function parseVersionNumber(value: unknown, field = "version"): number {
  const raw = requiredString(value, field, 1, 10, /^[0-9]+$/);
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1) {
    validationError(field, "must be a version number");
  }
  return version;
}

function revision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    validationError(field, "must be a positive integer");
  }
  return value;
}

/**
 * A body may be empty on creation — a title is a document being started —
 * but it is a string, and it is bounded: nothing here should be able to
 * hold a file.
 */
function body(value: unknown, field: string): string {
  if (typeof value !== "string") {
    validationError(field, "must be a string");
  }
  if (value.length > BODY_MAX) {
    validationError(field, `must be at most ${String(BODY_MAX)} characters`);
  }
  return value;
}

function title(value: unknown, field: string): string {
  const trimmed = requiredString(value, field, 1, TITLE_MAX).trim();
  if (trimmed.length === 0) {
    validationError(field, "must not be blank");
  }
  return trimmed;
}

export function parseCreateRequest(raw: unknown): SiteDocumentCreateRequest {
  const root = requestRecord(raw, "body");
  exactRequestKeys(root, ["slug", "locale", "title", "body"], "body");
  return {
    slug: parseSlug(root.slug),
    locale: parseLocale(root.locale),
    title: title(root.title, "title"),
    body: root.body === undefined ? "" : body(root.body, "body"),
  };
}

export function parseUpdateRequest(raw: unknown): SiteDocumentUpdateRequest {
  const root = requestRecord(raw, "body");
  exactRequestKeys(root, ["revision", "title", "body"], "body");
  const request: SiteDocumentUpdateRequest = {
    revision: revision(root.revision, "revision"),
  };
  if (root.title !== undefined) {
    request.title = title(root.title, "title");
  }
  if (root.body !== undefined) {
    request.body = body(root.body, "body");
  }
  if (request.title === undefined && request.body === undefined) {
    validationError("body", "must change the title or the body");
  }
  return request;
}

export function parsePublishRequest(raw: unknown): SiteDocumentPublishRequest {
  const root = requestRecord(raw, "body");
  exactRequestKeys(root, ["revision", "note"], "body");
  const request: SiteDocumentPublishRequest = {
    revision: revision(root.revision, "revision"),
  };
  if (root.note !== undefined) {
    const note = requiredString(root.note, "note", 0, NOTE_MAX).trim();
    if (note.length > 0) {
      request.note = note;
    }
  }
  return request;
}

export function parseRestoreRequest(raw: unknown): { revision: number } {
  const root = requestRecord(raw, "body");
  exactRequestKeys(root, ["revision"], "body");
  return { revision: revision(root.revision, "revision") };
}

export function parsePreviewRequest(raw: unknown): { body: string } {
  const root = requestRecord(raw, "body");
  exactRequestKeys(root, ["body"], "body");
  return { body: body(root.body, "body") };
}
