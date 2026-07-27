import { ServiceUnavailableException } from "@nestjs/common";

import type { JsonLoggerService } from "../../common/logging/json-logger.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  const ping = jest.fn<Promise<void>, []>();
  const warn = jest.fn<void, [unknown]>();
  const service = new HealthService(
    { ping } as unknown as PrismaService,
    { warn } as unknown as JsonLoggerService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
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
});
