import type { Prisma } from "@prisma/client";

/**
 * How many cards a day the app asks for.
 *
 * A backlog is not a to-do list. Two weeks away and everything comes due at
 * once, and a queue of two hundred and fifty is not a day's work — it is a
 * reason to stop opening the app. The rest is not lost: it stays due and
 * comes back tomorrow.
 *
 * The ceiling is the learner's day, not one deck's: the decks overlap, so a
 * cap on each of them would multiply into no cap at all.
 */
export const DAILY_REVIEW_LIMIT = 50;

export function remainingDailyAllowance(reviewedToday: number): number {
  return Math.max(0, DAILY_REVIEW_LIMIT - reviewedToday);
}

/**
 * How many different cards this learner has already answered today.
 *
 * Different cards rather than answers: a card that came round twice in one
 * sitting is one card's worth of work, and charging it twice would end the
 * day early.
 *
 * The day is the learner's own, resolved in their stored zone by the
 * database rather than in JavaScript — `date_trunc` over a zoned timestamp
 * is right across a daylight-saving change, and hand-rolled midnight
 * arithmetic is not.
 */
export async function reviewedTodayCount(
  transaction: Prisma.TransactionClient,
  userId: string,
  timezone: string,
): Promise<number> {
  const rows = await transaction.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT learning_card_id) AS count
      FROM review_events
     WHERE user_id = ${userId}::uuid
       AND effective_occurred_at >=
           date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}
  `;
  return Number(rows[0]?.count ?? 0n);
}
