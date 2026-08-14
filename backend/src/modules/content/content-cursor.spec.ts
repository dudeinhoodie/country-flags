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

  it("accepts the legacy plain cursor the published manifests hand out", () => {
    // The content pipeline writes `content:<version>:0` into every manifest
    // it has built so far, and clients have stored it. Refusing it would
    // strand every installed client of those releases.
    expect(decodeContentChangeCursor("content:fixture-v2:0")).toEqual({
      version: "fixture-v2",
      sequence: 0n,
    });
    // Versions containing colons keep everything up to the last separator.
    expect(decodeContentChangeCursor("content:v2:beta:41")).toEqual({
      version: "v2:beta",
      sequence: 41n,
    });
  });

  it("rejects a legacy-looking cursor with a malformed sequence", () => {
    for (const value of [
      "content:fixture-v2:",
      "content:fixture-v2:01",
      "content::0",
    ]) {
      expect(() => decodeContentChangeCursor(value)).toThrow(
        BadRequestException,
      );
    }
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
