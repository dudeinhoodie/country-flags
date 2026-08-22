import { Prisma } from "@prisma/client";

import { PrismaService } from "./prisma.service";

/** Postgres aborted this transaction to keep the schedule serializable. */
const WRITE_CONFLICT = "P2034";

/** How many times a transaction may lose before the caller hears about it. */
const DEFAULT_ATTEMPTS = 4;

export interface SerializableTransactionOptions {
  attempts?: number;
  maxWait?: number;
  timeout?: number;
}

/**
 * Runs a transaction that is allowed to lose.
 *
 * Serializable is the right level for the erasures and the sign-in that use
 * it: they read rows they then delete or depend on, and a weaker level would
 * let a half-finished account through. But the level is only half a bargain.
 * Postgres keeps the schedule serializable by aborting one side of any
 * conflict, and the side it picks is not the side that did anything wrong —
 * it is expected to come back and try again. Without that, an ordinary
 * concurrent write turns a correct request into a 500, and the person who
 * pressed the button is told their account could not be touched.
 *
 * Retried whole, because that is the only safe unit: the work inside is
 * scoped to one user and counts what it changed, so a second attempt sees
 * whatever the first one rolled back and reaches the same place.
 */
export async function inSerializableTransaction<T>(
  database: PrismaService,
  run: (transaction: Prisma.TransactionClient) => Promise<T>,
  options: SerializableTransactionOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // Spread rather than assigned: the project forbids handing an
        // optional property the literal `undefined`, and Prisma's own
        // defaults are what should apply when a caller says nothing.
        ...(options.maxWait === undefined ? {} : { maxWait: options.maxWait }),
        ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      });
    } catch (error) {
      if (attempt >= attempts || !isWriteConflict(error)) throw error;
    }
  }
}

export function isWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === WRITE_CONFLICT
  );
}
