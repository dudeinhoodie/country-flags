import { Prisma } from "@prisma/client";

import { PrismaService } from "./prisma.service";
import { inSerializableTransaction } from "./serializable-transaction";

function writeConflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: "test" },
  );
}

/**
 * A database that answers with a scripted sequence: each entry is either an
 * error to throw or the value to return.
 */
function databaseAnswering(answers: (Error | string)[]): {
  database: PrismaService;
  attempts: () => number;
} {
  let attempt = 0;
  const database = {
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) => {
      const answer = answers[attempt];
      attempt += 1;
      if (answer instanceof Error) throw answer;
      return run({});
    },
  } as unknown as PrismaService;
  return { database, attempts: () => attempt };
}

describe("inSerializableTransaction", () => {
  /// Serializable lets Postgres abort either side of a conflict, and the side
  /// it picks did nothing wrong. Losing once has to be survivable, or an
  /// ordinary concurrent write reaches the caller as a 500.
  it("comes back after losing a write conflict", async () => {
    const { database, attempts } = databaseAnswering([writeConflict(), "done"]);

    const result = await inSerializableTransaction(database, () =>
      Promise.resolve("done"),
    );

    expect(result).toBe("done");
    expect(attempts()).toBe(2);
  });

  /// Retrying forever would hide a conflict that is not going to clear, so
  /// the caller hears about it once the attempts run out.
  it("gives up and reports the conflict once the attempts run out", async () => {
    const { database, attempts } = databaseAnswering([
      writeConflict(),
      writeConflict(),
    ]);

    await expect(
      inSerializableTransaction(database, () => Promise.resolve("done"), {
        attempts: 2,
      }),
    ).rejects.toMatchObject({ code: "P2034" });
    expect(attempts()).toBe(2);
  });

  /// Only a conflict is worth repeating. A refusal the work itself raised
  /// would give the same answer every time, and running it again would mean
  /// doing the work twice to learn nothing.
  it("does not repeat work that failed for its own reasons", async () => {
    const failure = new Error("the account is not available");
    const { database, attempts } = databaseAnswering([failure, "done"]);

    await expect(
      inSerializableTransaction(database, () => Promise.resolve("done")),
    ).rejects.toThrow("the account is not available");
    expect(attempts()).toBe(1);
  });
});
