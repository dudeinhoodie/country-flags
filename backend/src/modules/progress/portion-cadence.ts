import type { Prisma } from "@prisma/client";
import { StudySessionStatus } from "@prisma/client";

/**
 * How long the app waits before the next portion of cards is the scheduled
 * one.
 *
 * ADR-022 already made three hours the rhythm of the scheduler: no answer
 * returns a card sooner, so a sitting finished now comes round again in three.
 * This is the same three hours said out loud. Without it the app had no way to
 * tell a learner when it expected them back, and filled the silence by dealing
 * cards that were not owed — which reads exactly like a queue, and is not one.
 *
 * The cadence belongs to the learner, not to a deck. Decks overlap, so a
 * per-deck rhythm would multiply into no rhythm at all — the same reasoning
 * `DAILY_REVIEW_LIMIT` is built on.
 */
export const PORTION_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * When the next portion opens, or `null` when one is open already.
 *
 * `null` covers both honest cases: a learner who has never finished a sitting
 * is not waiting for anything, and neither is one whose three hours have
 * passed. A caller renders a time or says nothing; it never has to compare
 * dates to find out which.
 */
export function nextPortionAt(
  lastCompletedAt: Date | null,
  now: Date,
): Date | null {
  if (lastCompletedAt === null) {
    return null;
  }
  const opensAt = new Date(lastCompletedAt.getTime() + PORTION_INTERVAL_MS);
  return opensAt.getTime() > now.getTime() ? opensAt : null;
}

/**
 * When this learner last finished a portion, across every deck.
 *
 * Finished, not started: a sitting left half-answered is resumable, and
 * starting the clock on it would charge the learner for work they did not
 * get to do.
 */
export async function lastCompletedPortionAt(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<Date | null> {
  const session = await transaction.studySession.findFirst({
    where: {
      userId,
      status: StudySessionStatus.COMPLETED,
      completedAt: { not: null },
    },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  return session?.completedAt ?? null;
}
