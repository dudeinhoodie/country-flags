import type { Prisma } from "@prisma/client";
import { StudySessionStatus } from "@prisma/client";

import {
  lastCompletedPortionAt,
  nextPortionAt,
  PORTION_INTERVAL_MS,
} from "./portion-cadence";

/**
 * The rhythm the app can name: three hours after a sitting was finished, the
 * next portion is the scheduled one. ADR-022 already put that floor under
 * every card; this is the part a learner can read.
 */
describe("nextPortionAt", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");

  it("opens three hours after the last finished sitting", () => {
    const finished = new Date("2026-09-21T11:00:00.000Z");

    expect(nextPortionAt(finished, now)).toEqual(
      new Date(finished.getTime() + PORTION_INTERVAL_MS),
    );
  });

  it("says nothing once the three hours have passed", () => {
    expect(nextPortionAt(new Date("2026-09-21T08:59:59.000Z"), now)).toBeNull();
  });

  // The boundary belongs to the learner: at exactly three hours the portion is
  // open, so there is nothing left to wait for and nothing to announce.
  it("says nothing at the moment the portion opens", () => {
    expect(
      nextPortionAt(new Date(now.getTime() - PORTION_INTERVAL_MS), now),
    ).toBeNull();
  });

  it("says nothing to a learner who has never finished a sitting", () => {
    expect(nextPortionAt(null, now)).toBeNull();
  });
});

describe("lastCompletedPortionAt", () => {
  function transactionReturning(completedAt: Date | null): {
    client: Prisma.TransactionClient;
    calls: unknown[];
  } {
    const calls: unknown[] = [];
    const client = {
      studySession: {
        findFirst: (args: unknown) => {
          calls.push(args);
          return Promise.resolve(completedAt === null ? null : { completedAt });
        },
      },
    } as unknown as Prisma.TransactionClient;
    return { client, calls };
  }

  it("reads the most recent completed session", async () => {
    const completedAt = new Date("2026-09-21T11:00:00.000Z");
    const { client, calls } = transactionReturning(completedAt);

    await expect(lastCompletedPortionAt(client, "user-1")).resolves.toEqual(
      completedAt,
    );
    // Across decks, not within one: decks overlap, so a per-deck rhythm would
    // multiply into no rhythm at all.
    expect(calls[0]).toMatchObject({
      where: {
        userId: "user-1",
        status: StudySessionStatus.COMPLETED,
      },
      orderBy: { completedAt: "desc" },
    });
    expect(calls[0]).not.toHaveProperty("where.deckId");
  });

  it("answers null when no session has been finished", async () => {
    const { client } = transactionReturning(null);

    await expect(lastCompletedPortionAt(client, "user-1")).resolves.toBeNull();
  });
});
