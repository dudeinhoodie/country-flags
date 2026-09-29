import type { Prisma } from "@prisma/client";

import { reviewedTodayCount } from "./daily-review-limit";

/**
 * A transaction that knows two zones and has counted three cards today, and
 * remembers the zone each count was asked in.
 */
function transactionCounting(): {
  transaction: Prisma.TransactionClient;
  zonesCountedIn: string[];
} {
  const zonesCountedIn: string[] = [];
  const $queryRaw = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("").includes("pg_timezone_names")) {
        return Promise.resolve([{ name: "Europe/Berlin" }, { name: "UTC" }]);
      }
      // userId, then the zone twice.
      zonesCountedIn.push(String(values[1]));
      return Promise.resolve([{ count: 3n }]);
    },
  );
  return {
    transaction: { $queryRaw } as unknown as Prisma.TransactionClient,
    zonesCountedIn,
  };
}

describe("reviewedTodayCount", () => {
  it("counts the day in the stored zone", async () => {
    const { transaction, zonesCountedIn } = transactionCounting();

    await expect(
      reviewedTodayCount(transaction, "user-1", "Europe/Berlin"),
    ).resolves.toBe(3);
    expect(zonesCountedIn).toEqual(["Europe/Berlin"]);
  });

  // The zone used to reach AT TIME ZONE as stored; one PostgreSQL did not
  // know failed the statement and every progress rebuild with it (#452).
  it("counts the day in UTC when PostgreSQL does not know the stored zone", async () => {
    const { transaction, zonesCountedIn } = transactionCounting();

    await expect(
      reviewedTodayCount(transaction, "user-1", "Mars/Olympus_Mons"),
    ).resolves.toBe(3);
    expect(zonesCountedIn).toEqual(["UTC"]);
  });
});
