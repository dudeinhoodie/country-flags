import { BadRequestException } from "@nestjs/common";

import {
  decodeContentChangeCursor,
  encodeContentChangeCursor,
} from "./content-cursor";

describe("content change cursor", () => {
  it("round trips sequences beyond the safe integer range", () => {
    const sequence = 9_007_199_254_740_993n;

    expect(
      decodeContentChangeCursor(
        encodeContentChangeCursor("content-v2", sequence),
      ),
    ).toEqual({ version: "content-v2", sequence });
  });

  it("accepts the numeric zero cursor committed in existing manifests", () => {
    const cursor = Buffer.from(
      JSON.stringify({ version: "content-v1", sequence: 0 }),
    ).toString("base64url");

    expect(decodeContentChangeCursor(cursor)).toEqual({
      version: "content-v1",
      sequence: 0n,
    });
  });

  it.each([
    { version: "content-v1", sequence: -1 },
    { version: "content-v1", sequence: "01" },
    { version: "content-v1", sequence: "1.5" },
    { version: "", sequence: "0" },
    { kind: "deck", code: "ALL" },
  ])("rejects a non-feed cursor %#", (payload) => {
    const cursor = Buffer.from(JSON.stringify(payload)).toString("base64url");

    expect(() => decodeContentChangeCursor(cursor)).toThrow(
      BadRequestException,
    );
  });
});
