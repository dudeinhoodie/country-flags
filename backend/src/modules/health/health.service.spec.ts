import { ServiceUnavailableException } from "@nestjs/common";

import type { JsonLoggerService } from "../../common/logging/json-logger.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  const ping = jest.fn<Promise<void>, []>();
  const warn = jest.fn<void, [unknown]>();
  const log = jest.fn<void, [unknown]>();
  const configGet = jest.fn<number | undefined, [string]>();
  const service = new HealthService(
    { ping } as unknown as PrismaService,
    { warn, log } as unknown as JsonLoggerService,
    { get: configGet } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configGet.mockReturnValue(0);
  });

  it("reports liveness without checking external dependencies", () => {
    expect(service.getLiveness()).toEqual({ status: "ok" });
    expect(ping).not.toHaveBeenCalled();
  });

  it("reports readiness when PostgreSQL responds", async () => {
    ping.mockResolvedValueOnce(undefined);

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: "ok",
      checks: {
        database: {
          status: "up",
        },
      },
    });
  });

  it("stays quiet while the database answers quickly", async () => {
    ping.mockResolvedValueOnce(undefined);

    await service.getReadiness();

    expect(warn).not.toHaveBeenCalled();
  });

  it("says so when the database answers but takes its time", async () => {
    // A connection that is merely slow still passes the check, so the only way
    // pool pressure becomes alertable is for the check to report the latency.
    ping.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 300)),
    );

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: "ok",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "readiness_check_slow",
        dependency: "postgresql",
        thresholdMs: 250,
      }),
    );
  });

  it("reports unready when PostgreSQL is unavailable", async () => {
    ping.mockRejectedValueOnce(new Error("connection refused"));

    await expect(service.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "readiness_check_failed",
      }),
    );
  });

  it("does not drain or mark unready on a signal-less close (e.g. test teardown)", async () => {
    const fresh = new HealthService(
      { ping } as unknown as PrismaService,
      { warn, log } as unknown as JsonLoggerService,
      { get: configGet } as never,
    );

    await fresh.beforeApplicationShutdown(undefined);

    expect(log).not.toHaveBeenCalled();
    ping.mockResolvedValueOnce(undefined);
    await expect(fresh.getReadiness()).resolves.toMatchObject({
      status: "ok",
    });
  });

  it("marks readiness as failing immediately once a real shutdown signal arrives", async () => {
    const fresh = new HealthService(
      { ping } as unknown as PrismaService,
      { warn, log } as unknown as JsonLoggerService,
      { get: configGet } as never,
    );
    configGet.mockReturnValue(0);

    await fresh.beforeApplicationShutdown("SIGTERM");

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "application_shutdown_draining",
        signal: "SIGTERM",
      }),
    );
    await expect(fresh.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(ping).not.toHaveBeenCalled();
  });
});
