import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

/**
 * One release at a time, as a property of the database rather than of CI.
 *
 * Until this existed the only thing keeping two publishes apart was
 * `concurrency: publish-content-dev` in the workflow, which guards a second
 * run of that one workflow and nothing else — not a publish from the CLI,
 * not a run started by the in-product publisher, not the two racing each
 * other. Both would apply a bundle and then fight over `ContentPointer`, and
 * the loser would have written a release nobody points at.
 *
 * So the lock is taken on the pointer itself, in the transaction that moves
 * it, by everything that moves it (ADR-017 §4).
 */
const ACTIVE_POINTER_LOCK_NAME = "content:active";

/**
 * The lock name as the two 32-bit integers `pg_advisory_lock` actually takes.
 *
 * Postgres offers a single-bigint form too, but the pair is the one every
 * client can produce identically: a signed 64-bit literal is a language
 * question in JavaScript and not one worth having between a CLI and a job
 * that must agree on the same lock. The halves come from a hash of the name
 * so the constant is derived and readable rather than a magic number
 * somebody would eventually change without knowing what it was.
 */
function lockKeysFor(name: string): readonly [number, number] {
  const digest = createHash("sha256").update(name).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export const ACTIVE_CONTENT_POINTER_LOCK = lockKeysFor(
  ACTIVE_POINTER_LOCK_NAME,
);

/**
 * Raised when somebody else is already moving the active pointer.
 *
 * The alternative — waiting — is what `pg_advisory_xact_lock` would do, and
 * it would wait behind a transaction allowed to run for twenty minutes. A
 * caller who is told now can say so; a caller who blocks looks identical to
 * one that is working, right up to the timeout.
 */
export class ContentPointerBusyError extends Error {
  constructor() {
    super(
      "Another release run holds the active content pointer; wait for it to finish before publishing or rolling back",
    );
    this.name = "ContentPointerBusyError";
  }
}

/**
 * Takes the release lock for the rest of the transaction.
 *
 * Transaction-scoped on purpose: it is released by commit or rollback, with
 * no unlock to forget and nothing left held by a process that died holding
 * it. Call it first — before any write — so a refusal costs nothing.
 */
export async function lockActiveContentPointer(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  const [namespace, key] = ACTIVE_CONTENT_POINTER_LOCK;
  const rows = await transaction.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(${namespace}::int, ${key}::int) AS locked
  `;
  if (rows[0]?.locked !== true) {
    throw new ContentPointerBusyError();
  }
}
