import { HttpStatus } from "@nestjs/common";

import { RateLimiter } from "./rate-limiter.service";

function config(): { getOrThrow: () => string } {
  return { getOrThrow: () => "a".repeat(32) };
}

describe("RateLimiter", () => {
  it("allows a request that stays within the window limit", async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { request_count: 3, window_started_at: new Date() },
        ]),
    };
    const limiter = new RateLimiter(database as never, config() as never);

    await expect(
      limiter.consume("reviews:batch", "user-1", 30),
    ).resolves.toBeUndefined();
  });

  it("throws a 429 ApiException with retryAfter once the window limit is exceeded", async () => {
    const windowStartedAt = new Date();
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { request_count: 31, window_started_at: windowStartedAt },
        ]),
    };
    const limiter = new RateLimiter(database as never, config() as never);

    try {
      await limiter.consume("reviews:batch", "user-1", 30);
      throw new Error("expected consume() to throw");
    } catch (error) {
      const apiError = error as {
        getStatus(): number;
        getResponse(): {
          error: { code: string; details: Record<string, unknown> };
        };
      };
      expect(apiError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const response = apiError.getResponse();
      expect(response.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(typeof response.error.details.retryAfter).toBe("number");
    }
  });

  it("issues one bucket query per scoped call", async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { request_count: 1, window_started_at: new Date() },
        ]),
    };
    const limiter = new RateLimiter(database as never, config() as never);

    await limiter.consume("diagnostics:metrickit", "203.0.113.1", 10);

    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
