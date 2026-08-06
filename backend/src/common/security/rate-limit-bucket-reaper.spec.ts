import { RateLimitBucketReaper } from "./rate-limit-bucket-reaper";

describe("RateLimitBucketReaper", () => {
  it("deletes buckets past retention and returns the removed count", async () => {
    const database = { $executeRaw: jest.fn().mockResolvedValue(4) };
    const logger = { warn: jest.fn() };
    const reaper = new RateLimitBucketReaper(
      database as never,
      logger as never,
    );

    await expect(reaper.sweep()).resolves.toBe(4);
    expect(database.$executeRaw).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("swallows a database failure and logs a warning instead of throwing", async () => {
    const database = {
      $executeRaw: jest.fn().mockRejectedValue(new Error("connection lost")),
    };
    const logger = { warn: jest.fn() };
    const reaper = new RateLimitBucketReaper(
      database as never,
      logger as never,
    );

    await expect(reaper.sweep()).resolves.toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rate_limit_bucket_sweep_failed",
      }),
    );
  });
});
