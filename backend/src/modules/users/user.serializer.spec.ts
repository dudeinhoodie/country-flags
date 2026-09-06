import { UserStatus } from "@prisma/client";
import type { User } from "@prisma/client";

import { serializeUser } from "./user.serializer";

const USER_ID = "80000000-0000-4000-8000-000000000001";
const STORE_ACCOUNT_TOKEN = "a0000000-0000-4000-8000-000000000001";

function row(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    syncStreamId: "90000000-0000-4000-8000-000000000001",
    storeAccountToken: STORE_ACCOUNT_TOKEN,
    displayName: null,
    preferredLocale: "ru",
    status: UserStatus.ACTIVE,
    createdAt: new Date("2026-07-01T08:00:00.000Z"),
    updatedAt: new Date("2026-07-29T09:59:00.000Z"),
    deletionRequestedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("serializeUser", () => {
  // The list the contract's `User` schema names, and nothing else: the row
  // carries columns — the sync stream, the deletion timestamps — that are the
  // server's business, and a serializer that forwarded the row would hand
  // them out the moment somebody added one.
  it("hands out the fields the contract names and no others", () => {
    expect(Object.keys(serializeUser(row())).sort()).toEqual([
      "createdAt",
      "displayName",
      "id",
      "preferredLocale",
      "status",
      "storeAccountToken",
      "updatedAt",
    ]);
  });

  it("carries the store account token the account was minted with", () => {
    expect(serializeUser(row())).toMatchObject({
      id: USER_ID,
      storeAccountToken: STORE_ACCOUNT_TOKEN,
    });
  });

  // It travels to Apple inside a signed purchase, so it must be a value of its
  // own rather than anything the account id could be read out of.
  it("says something other than the account id", () => {
    const profile = serializeUser(row());

    expect(profile.storeAccountToken).not.toBe(profile.id);
  });
});
