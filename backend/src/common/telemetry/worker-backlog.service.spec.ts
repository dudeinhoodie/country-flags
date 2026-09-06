import type { JsonLoggerService } from "../logging/json-logger.service";
import type { MetricsService } from "./metrics.service";
import {
  type WorkerBacklogSnapshot,
  WorkerBacklogService,
} from "./worker-backlog.service";

describe("WorkerBacklogService", () => {
  const snapshot = (
    overrides: Partial<WorkerBacklogSnapshot> = {},
  ): WorkerBacklogSnapshot => ({
    pending: 3,
    processing: 1,
    deadLetter: 2,
    oldestPendingAgeMs: 90_000,
    ...overrides,
  });

  function build(): {
    metrics: { recordOutboxDepth: jest.Mock };
    logger: { log: jest.Mock };
    service: WorkerBacklogService;
  } {
    const metrics = { recordOutboxDepth: jest.fn() };
    const logger = { log: jest.fn() };
    return {
      metrics,
      logger,
      service: new WorkerBacklogService(
        metrics as unknown as MetricsService,
        logger as unknown as JsonLoggerService,
      ),
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes the backlog as both a metric and a log line", () => {
    const { metrics, logger, service } = build();

    service.report("analytics", snapshot());

    expect(metrics.recordOutboxDepth).toHaveBeenCalledWith(
      "analytics",
      3,
      90,
      2,
    );
    expect(logger.log).toHaveBeenCalledWith({
      message: "Worker backlog snapshot",
      event: "worker_backlog_snapshot",
      queue: "analytics",
      pending: 3,
      processing: 1,
      deadLetter: 2,
      oldestPendingAgeSeconds: 90,
    });
  });

  it("reports an idle queue too, so a worker that stopped can be told from one with nothing to do", () => {
    const { logger, service } = build();

    service.report(
      "learning",
      snapshot({ pending: 0, oldestPendingAgeMs: null }),
    );

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ pending: 0, oldestPendingAgeSeconds: 0 }),
    );
  });

  it("throttles a queue polled every second down to one report a minute", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-06T10:00:00Z"));
    const { logger, service } = build();

    service.report("analytics", snapshot());
    jest.setSystemTime(new Date("2026-09-06T10:00:30Z"));
    service.report("analytics", snapshot());
    expect(logger.log).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date("2026-09-06T10:01:01Z"));
    service.report("analytics", snapshot());
    expect(logger.log).toHaveBeenCalledTimes(2);
  });

  it("throttles each queue on its own clock", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-06T10:00:00Z"));
    const { logger, service } = build();

    service.report("analytics", snapshot());
    service.report("learning", snapshot());
    service.report("reconciliation", snapshot());

    expect(logger.log).toHaveBeenCalledTimes(3);
  });

  it("swallows a telemetry failure rather than breaking the worker's poll", () => {
    const { metrics, service } = build();
    metrics.recordOutboxDepth.mockImplementation(() => {
      throw new Error("exporter unavailable");
    });

    expect(() => service.report("analytics", snapshot())).not.toThrow();
  });
});
