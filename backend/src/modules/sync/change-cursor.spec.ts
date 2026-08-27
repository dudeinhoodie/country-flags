import { ApiException } from "../../common/http/api.exception";
import {
  decodeUserChangeCursor,
  encodeUserChangeCursor,
} from "./change-cursor";

/// Every refusal of a request is 422 `VALIDATION_FAILED`, whichever endpoint
/// and whichever field it came from (#276). Asserting the status rather than
/// just the exception type is the point: the class of mistake is what a
/// client keys on.
function expectsRefusal(act: () => unknown): void {
  expect(act).toThrow(ApiException);
  try {
    act();
  } catch (error) {
    expect((error as ApiException).getStatus()).toBe(422);
  }
}

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
    expectsRefusal(() =>
      decodeUserChangeCursor(cursor, "10000000-0000-4000-8000-000000000002"),
    );
  });
});
