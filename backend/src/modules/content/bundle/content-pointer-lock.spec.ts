import type { Prisma } from "@prisma/client";

import {
  ACTIVE_CONTENT_POINTER_LOCK,
  ContentPointerBusyError,
  lockActiveContentPointer,
} from "./content-pointer-lock";

function transactionAnswering(
  locked: boolean | undefined,
): { $queryRaw: jest.Mock } & Prisma.TransactionClient {
  const $queryRaw = jest
    .fn()
    .mockResolvedValue(locked === undefined ? [] : [{ locked }]);
  return { $queryRaw } as unknown as {
    $queryRaw: jest.Mock;
  } & Prisma.TransactionClient;
}

describe("the lock on the active content pointer", () => {
  it("asks for the same pair of keys every time", () => {
    // The whole point of the lock is that a CLI rollback and a publisher job
    // in different processes contend for it, which they only do if they
    // derive the same two integers. Pinning them makes a change to the
    // derivation a failing test rather than a silent loss of the guard.
    expect(ACTIVE_CONTENT_POINTER_LOCK).toEqual([2026927973, -1404143726]);
  });

  it("returns once the lock is held", async () => {
    const transaction = transactionAnswering(true);

    await expect(
      lockActiveContentPointer(transaction),
    ).resolves.toBeUndefined();
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("refuses rather than waits when somebody else holds it", async () => {
    await expect(
      lockActiveContentPointer(transactionAnswering(false)),
    ).rejects.toBeInstanceOf(ContentPointerBusyError);
  });

  it("treats an answer it cannot read as a refusal", async () => {
    // A row that never arrived says nothing about who holds the lock, and
    // "assume we have it" is the one reading that could apply two releases
    // at once.
    await expect(
      lockActiveContentPointer(transactionAnswering(undefined)),
    ).rejects.toBeInstanceOf(ContentPointerBusyError);
  });
});
