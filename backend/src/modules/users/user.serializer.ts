import type { User } from "@prisma/client";

/**
 * The `User` document, in the one shape the contract describes it.
 *
 * `GET /v1/me` is not the only place a profile is handed out — a sign-in and a
 * refresh both answer with one — and two writings of the same schema is how a
 * field ends up on one of them and not the other. This is that schema, once.
 */
export function serializeUser(user: User): Record<string, unknown> {
  return {
    id: user.id,
    displayName: user.displayName,
    preferredLocale: user.preferredLocale,
    status: user.status,
    // The token a purchase is made under. It leaves our system inside a
    // signed StoreKit transaction, so it is minted independently of the
    // account id rather than derived from it (ADR-019): a derivable token
    // would hand Apple the identifier it was derived from.
    storeAccountToken: user.storeAccountToken,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
