import { BadRequestException } from "@nestjs/common";

import {
  decodeUserChangeCursor,
  encodeUserChangeCursor,
} from "./change-cursor";

describe("user change cursor", () => {
  const scopeId = "10000000-0000-4000-8000-000000000001";

  it("round trips account-scoped sequences beyond the safe integer range", () => {
    const sequence = 9_007_199_254_740_993n;
    expect(
      decodeUserChangeCursor(
        encodeUserChangeCursor(scopeId, sequence),
        scopeId,
      ),
    ).toBe(sequence);
  });

  it("rejects a cursor from another account scope", () => {
    const cursor = encodeUserChangeCursor(scopeId, 1n);
    expect(() =>
      decodeUserChangeCursor(cursor, "10000000-0000-4000-8000-000000000002"),
    ).toThrow(BadRequestException);
  });
});
