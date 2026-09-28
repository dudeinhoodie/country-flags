import { HttpStatus } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import {
  isAccountUnavailable,
  lockAccountForWrite,
  requireWritableAccount,
} from "./account-write-guard";

describe("account write guard", () => {
  it("holds a writable account and lets the write go on", async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ id: "user-1" }]);
    await expect(
      lockAccountForWrite({ $queryRaw } as never, "user-1"),
    ).resolves.toBeUndefined();
    const [strings] = $queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join("?")).toContain("status = 'ACTIVE'");
    expect(strings.join("?")).toContain("FOR KEY SHARE");
  });

  it("refuses an account that is deleted or being deleted", async () => {
    const $queryRaw = jest.fn().mockResolvedValue([]);
    const refusal = await lockAccountForWrite(
      { $queryRaw } as never,
      "user-1",
    ).catch((error: unknown) => error);
    expect(isAccountUnavailable(refusal)).toBe(true);
    expect((refusal as ApiException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it("reads the deletion mark inside a serializable transaction", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const refusal = await requireWritableAccount(
      { user: { findFirst } } as never,
      "user-1",
    ).catch((error: unknown) => error);
    expect(isAccountUnavailable(refusal)).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "user-1", status: "ACTIVE" },
      select: { id: true },
    });
  });

  it("tells its refusal apart from any other error", () => {
    expect(
      isAccountUnavailable(
        new ApiException(HttpStatus.FORBIDDEN, "ENTITLEMENT_REQUIRED", "No"),
      ),
    ).toBe(false);
    expect(isAccountUnavailable(new Error("ACCOUNT_UNAVAILABLE"))).toBe(false);
  });
});
