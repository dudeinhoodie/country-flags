import { Prisma, UserStatus } from "@prisma/client";

import { AccountDeletionService } from "./account-deletion.service";

/**
 * The two-step shape of a deletion: the mark that stops writes, and what
 * happens to it when the erasure after it fails. The erasure itself runs
 * against PostgreSQL in `account-lifecycle.e2e-spec.ts` and
 * `account-deletion-writes.e2e-spec.ts`.
 */
describe("AccountDeletionService", () => {
  function database(markedRows: number): {
    client: unknown;
    markQuery: jest.Mock;
    mark: jest.Mock;
    revert: jest.Mock;
  } {
    const markQuery = jest.fn().mockResolvedValue([{ locked: 1 }]);
    const mark = jest.fn().mockResolvedValue({ count: markedRows });
    const revert = jest.fn().mockResolvedValue({ count: 1 });
    const client = {
      user: { updateMany: revert },
      authIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(
        (
          run: (transaction: unknown) => Promise<unknown>,
          options?: { isolationLevel?: string },
        ): Promise<unknown> => {
          if (
            options?.isolationLevel ===
            Prisma.TransactionIsolationLevel.Serializable
          ) {
            return Promise.reject(new Error("erasure failed"));
          }
          return run({ $queryRaw: markQuery, user: { updateMany: mark } });
        },
      ),
    };
    return { client, markQuery, mark, revert };
  }

  function appleTokens(): { revoke: jest.Mock } {
    return {
      revoke: jest.fn().mockResolvedValue({
        outcome: "not_applicable_no_apple_identity",
        failure: null,
      }),
    };
  }

  it("marks the account DELETION_PENDING before erasing it", async () => {
    const { client, markQuery, mark } = database(1);
    const apple = appleTokens();
    const service = new AccountDeletionService(
      client as never,
      {} as never,
      apple as never,
    );

    await expect(service.delete("user-1", "request-1")).rejects.toThrow(
      "erasure failed",
    );

    const [strings] = markQuery.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(mark).toHaveBeenCalledWith({
      where: { id: "user-1", status: UserStatus.ACTIVE },
      data: {
        status: UserStatus.DELETION_PENDING,
        deletionRequestedAt: expect.any(Date) as Date,
      },
    });
    // Apple is asked only once nothing else can write to the account.
    expect(apple.revoke.mock.invocationCallOrder[0]).toBeGreaterThan(
      mark.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("hands the account back when the erasure fails, so it can be asked again", async () => {
    const { client, revert } = database(1);
    const service = new AccountDeletionService(
      client as never,
      {} as never,
      appleTokens() as never,
    );

    await expect(service.delete("user-1", "request-1")).rejects.toThrow(
      "erasure failed",
    );

    expect(revert).toHaveBeenCalledWith({
      where: { id: "user-1", status: UserStatus.DELETION_PENDING },
      data: { status: UserStatus.ACTIVE, deletionRequestedAt: null },
    });
  });

  it("does not hand back a mark some earlier request set", async () => {
    const { client, revert } = database(0);
    const service = new AccountDeletionService(
      client as never,
      {} as never,
      appleTokens() as never,
    );

    await expect(service.delete("user-1", "request-1")).rejects.toThrow(
      "erasure failed",
    );

    expect(revert).not.toHaveBeenCalled();
  });
});
