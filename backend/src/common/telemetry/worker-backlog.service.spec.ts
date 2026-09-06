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

  it("publishes the backlog as both a metric and a log line", async () => {
    const { metrics, logger, service } = build();

    await service.report("analytics", () => Promise.resolve(snapshot()));

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

  it("reports an idle queue too, so a stopped worker can be told from one with nothing to do", async () => {
    const { logger, service } = build();

    await service.report("learning", () =>
      Promise.resolve(snapshot({ pending: 0, oldestPendingAgeMs: null })),
    );

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ pending: 0, oldestPendingAgeSeconds: 0 }),
    );
  });

  it("does not count the queue at all when the report is throttled", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-06T10:00:00Z"));
    const { logger, service } = build();
    const load = jest.fn(() => Promise.resolve(snapshot()));

    await service.report("analytics", load);
    jest.setSystemTime(new Date("2026-09-06T10:00:30Z"));
    await service.report("analytics", load);

    // Counting a queue is four database queries. A worker polling every second
    // must not pay for sixty counts to publish one.
    expect(load).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date("2026-09-06T10:01:01Z"));
    await service.report("analytics", load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledTimes(2);
  });

  it("throttles each queue on its own clock", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-06T10:00:00Z"));
    const { logger, service } = build();
    const load = (): Promise<WorkerBacklogSnapshot> =>
      Promise.resolve(snapshot());

    await service.report("analytics", load);
    await service.report("learning", load);
    await service.report("reconciliation", load);

    expect(logger.log).toHaveBeenCalledTimes(3);
  });

  it("swallows a failing count rather than breaking the worker's poll", async () => {
    const { logger, service } = build();

    await expect(
      service.report("analytics", () =>
        Promise.reject(new Error("connection refused")),
      ),
    ).resolves.toBeUndefined();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("swallows a failing exporter too", async () => {
    const { metrics, service } = build();
    metrics.recordOutboxDepth.mockImplementation(() => {
      throw new Error("exporter unavailable");
    });

    await expect(
      service.report("analytics", () => Promise.resolve(snapshot())),
    ).resolves.toBeUndefined();
  });

  it("does not retry a failed count until the next window", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-06T10:00:00Z"));
    const { service } = build();
    const load = jest.fn(() => Promise.reject(new Error("connection refused")));

    await service.report("analytics", load);
    jest.setSystemTime(new Date("2026-09-06T10:00:05Z"));
    await service.report("analytics", load);

    // A database that is refusing counts must not be asked again a second later.
    expect(load).toHaveBeenCalledTimes(1);
  });
});
