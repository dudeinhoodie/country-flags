/**
 * What a refused draft write says, and what the console can do about it.
 *
 * Every editorial mutation carries the revision it was read at, so a second
 * editor saving over the first is answered with `409` rather than accepted
 * (docs/19-admin-redesign.md §9). The refusal names both revisions, when the
 * draft moved and who moved it, which is exactly what a recovery dialog
 * needs: silent last-write-wins is forbidden, so the failure has to arrive
 * as data rather than as a sentence.
 */

/** The code the backend uses for a stale write. */
export const DRAFT_REVISION_CONFLICT = "DRAFT_REVISION_CONFLICT";

export interface DraftConflict {
  draftId: string | null;
  /** The revision the console believed it was writing over. */
  expectedRevision: number | null;
  /** The revision the draft actually carries now. */
  currentRevision: number | null;
  updatedAt: string | null;
  updatedByAdminUserId: string | null;
}

interface ErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: Record<string, unknown>;
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The conflict a refusal describes, or null when the refusal is about
 * something else. Other `409`s live on the same routes — a merged draft, a
 * deck key already taken — and they carry the plain envelope, so the code is
 * what decides rather than the status.
 */
export function conflictOf(payload: unknown): DraftConflict | null {
  const envelope = payload as ErrorEnvelope | undefined;
  if (envelope?.error?.code !== DRAFT_REVISION_CONFLICT) {
    return null;
  }
  const details = envelope.error.details ?? {};
  return {
    draftId: stringOrNull(details.draftId),
    expectedRevision: numberOrNull(details.expectedRevision),
    currentRevision: numberOrNull(details.currentRevision),
    updatedAt: stringOrNull(details.updatedAt),
    updatedByAdminUserId: stringOrNull(details.updatedByAdminUserId),
  };
}

/** The server's own words for a refusal, or the caller's fallback. */
export function messageOf(payload: unknown, fallback: string): string {
  const envelope = payload as ErrorEnvelope | undefined;
  const message = envelope?.error?.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

/**
 * A refused write, carrying the conflict when there was one.
 *
 * Editors catch this rather than reading response bodies themselves: an
 * editor that had to parse the envelope would be free to treat a stale
 * revision as an ordinary failure, and the whole point is that it cannot.
 */
export class DraftWriteError extends Error {
  readonly conflict: DraftConflict | null;

  constructor(message: string, conflict: DraftConflict | null) {
    super(message);
    this.name = "DraftWriteError";
    this.conflict = conflict;
  }
}

export function draftWriteError(
  payload: unknown,
  fallback: string,
): DraftWriteError {
  return new DraftWriteError(messageOf(payload, fallback), conflictOf(payload));
}

/** The conflict behind a rejected promise, when there is one. */
export function conflictOfError(cause: unknown): DraftConflict | null {
  return cause instanceof DraftWriteError ? cause.conflict : null;
}
