import { Prisma } from "@prisma/client";

/**
 * How long the one transaction that applies a release may run.
 *
 * Twenty minutes because a real bundle needs them. The five minutes publish
 * used to allow were set when the only bundle anyone had published was the
 * two-entity fixture. The first publish of the 250-entity catalogue from a CI
 * runner used them up on the learning cards alone and was closed
 * mid-transaction. The release applies as one transaction or not at all, so
 * the answer is to let it finish rather than to split it. Making it quicker
 * means fewer round trips, and that is a separate change.
 *
 * Publish and rollback share this budget because they do the same work.
 * Publish overwrites shared rows in place, so a rollback cannot just move the
 * pointer. It re-applies the whole target bundle through the same
 * `applyBundleToDatabase`. The rollback kept the old five minutes, and three
 * re-applies of an already-published release on dev ran 667 to 972 seconds
 * from a CI runner (#441, `docs/ops/deployment-runbooks.md` §13). During an
 * incident that rollback would have timed out and left the bad release
 * active.
 */
export const RELEASE_TRANSACTION_TIMEOUT_MS = 1_200_000;

/**
 * What both release transactions open with.
 *
 * Serializable, so the diff a release computes cannot race another release.
 * The pointer lock (ADR-017 §4) turns such a race into a refusal first
 * anyway. `maxWait` bounds only the wait for a pooled connection, not the
 * work.
 */
export const RELEASE_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 30_000,
  timeout: RELEASE_TRANSACTION_TIMEOUT_MS,
} as const;
