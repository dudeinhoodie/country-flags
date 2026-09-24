import type { Request } from "express";

import { forwardedClientAddress } from "./client-address";

function requestWith(
  remoteAddress: string | undefined,
  forwardedFor?: string | string[],
): Request {
  return {
    socket: { remoteAddress },
    headers:
      forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  } as unknown as Request;
}

describe("forwardedClientAddress", () => {
  it("is the socket peer when no proxy is trusted", () => {
    expect(
      forwardedClientAddress(requestWith("10.0.0.1", "198.51.100.7"), 0),
    ).toBe("10.0.0.1");
  });

  it("reads the forwarded addresses from the right end", () => {
    const request = requestWith(
      "10.0.0.1",
      "203.0.113.9, 198.51.100.7, 192.0.2.44",
    );
    expect(forwardedClientAddress(request, 1)).toBe("192.0.2.44");
    expect(forwardedClientAddress(request, 2)).toBe("198.51.100.7");
  });

  it("ignores entries to the left of the trusted hops", () => {
    // Whatever a client writes into the header itself ends up on the left,
    // before the entries the trusted proxies appended.
    expect(
      forwardedClientAddress(
        requestWith("10.0.0.1", "203.0.113.9, 198.51.100.7"),
        1,
      ),
    ).toBe("198.51.100.7");
  });

  it("stops at the leftmost address when fewer hops are present", () => {
    expect(
      forwardedClientAddress(requestWith("10.0.0.1", "198.51.100.7"), 3),
    ).toBe("198.51.100.7");
    expect(forwardedClientAddress(requestWith("10.0.0.1"), 2)).toBe("10.0.0.1");
  });

  it("joins repeated headers in arrival order", () => {
    expect(
      forwardedClientAddress(
        requestWith("10.0.0.1", ["203.0.113.9", "198.51.100.7"]),
        2,
      ),
    ).toBe("203.0.113.9");
  });

  it("skips empty entries", () => {
    expect(
      forwardedClientAddress(requestWith("10.0.0.1", "198.51.100.7, ,"), 1),
    ).toBe("198.51.100.7");
  });

  it("names an unknown client when the socket has no address", () => {
    expect(forwardedClientAddress(requestWith(undefined), 0)).toBe(
      "unknown-client",
    );
  });
});
