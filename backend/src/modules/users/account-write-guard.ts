import { HttpStatus } from "@nestjs/common";
import { UserStatus, type Prisma } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";

/**
 * Writes that must not outlive the account they write for.
 *
 * Account deletion first marks the account `DELETION_PENDING` in a short
 * transaction of its own that takes the row `FOR UPDATE`, and only then
 * erases its rows in a second, serializable one. A request already past the
 * auth guard, or a guest import that runs for a minute, used to keep writing
 * after the erasure: into a device row it recreated, a session, a mastery row
 * or an analytics event that still named the deleted account.
 *
 * Every write of account data happens in a transaction that asks one of the
 * two questions below first, and the answer depends on its isolation level.
 */

/**
 * For a read-committed transaction: holds the account open until this
 * transaction ends, or refuses.
 *
 * The deletion mark waits for every transaction holding this lock, and a
 * transaction that asks after the mark sees it and is refused. So by the
 * time the erasure takes its snapshot, every write that got through here has
 * committed and is erased with the rest.
 *
 * `FOR KEY SHARE` because it is the weakest lock that conflicts with
 * `FOR UPDATE`: writers do not wait for each other, and a profile update of
 * the same row does not wait for them.
 */
export async function lockAccountForWrite(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
      FROM users
     WHERE id = ${userId}::uuid
       AND status = 'ACTIVE'
       FOR KEY SHARE
  `;
  if (rows.length === 0) {
    throw accountUnavailable();
  }
}

/**
 * For a serializable transaction: refuses an account that is deleted or
 * being deleted.
 *
 * A plain read, not the lock: in a serializable transaction a row lock on a
 * row the mark updated fails outright instead of waiting, and the read is
 * already enough. The erasure is serializable and rewrites the account row
 * this transaction read, so PostgreSQL aborts one of the two if they
 * overlap, and the retry sees the mark.
 */
export async function requireWritableAccount(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const account = await transaction.user.findFirst({
    where: { id: userId, status: UserStatus.ACTIVE },
    select: { id: true },
  });
  if (account === null) {
    throw accountUnavailable();
  }
}

export function accountUnavailable(): ApiException {
  return new ApiException(
    HttpStatus.UNAUTHORIZED,
    "ACCOUNT_UNAVAILABLE",
    "The account is not available",
  );
}

/** Whether an error is the refusal above, which no retry can change. */
export function isAccountUnavailable(error: unknown): boolean {
  if (!(error instanceof ApiException)) {
    return false;
  }
  const response = error.getResponse();
  return (
    typeof response === "object" &&
    response !== null &&
    "error" in response &&
    typeof response.error === "object" &&
    response.error !== null &&
    "code" in response.error &&
    response.error.code === "ACCOUNT_UNAVAILABLE"
  );
}
