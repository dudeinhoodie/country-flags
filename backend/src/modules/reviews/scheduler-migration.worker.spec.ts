import { ReconciliationJobStatus } from "@prisma/client";

import {
  MAX_IDLE_POLL_INTERVAL_MS,
  nextPollDelay,
  POLL_INTERVAL_MS,
  SchedulerMigrationWorker,
} from "./scheduler-migration.worker";

describe("SchedulerMigrationWorker", () => {
  const targetSchedulerVersion = "fsrs-v2";

  it("persists the last queued card as the resume checkpoint", async () => {
    const runUpdates: unknown[] = [];
    const queued: unknown[] = [];
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "run-1",
          targetSchedulerVersion,
          afterUserId: null,
          afterLearningCardId: null,
        },
      ]),
      schedulerMigrationRun: {
        update: jest.fn(({ data }: { data: unknown }) => {
          runUpdates.push(data);
          return Promise.resolve({});
        }),
      },
      userCardState: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "user-1", learningCardId: "card-1" },
          { userId: "user-1", learningCardId: "card-2" },
        ]),
      },
      reconciliationJob: {
        createMany: jest.fn(
          ({ data }: { data: Array<Record<string, unknown>> }) => {
            queued.push(...data);
            return Promise.resolve({ count: data.length });
          },
        ),
      },
    };
    const database = {
      schedulerDefinition: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(
        (callback: (value: typeof transaction) => Promise<number>) =>
          callback(transaction),
      ),
    };

    const worker = new SchedulerMigrationWorker(
      database as never,
      {} as never,
      { report: jest.fn() } as never,
    );
    await expect(worker.drain()).resolves.toBe(2);
    // Two ranges the scheduler_version index can serve, not `<>`.
    expect(transaction.userCardState.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { schedulerVersion: { lt: targetSchedulerVersion } },
                { schedulerVersion: { gt: targetSchedulerVersion } },
              ],
            },
          ],
        },
      }),
    );
    expect(queued).toEqual([
      expect.objectContaining({
        learningCardId: "card-1",
        targetSchedulerVersion,
      }),
      expect.objectContaining({
        learningCardId: "card-2",
        targetSchedulerVersion,
      }),
    ]);
    expect(runUpdates).toContainEqual({
      afterUserId: "user-1",
      afterLearningCardId: "card-2",
    });
  });

  it("completes a resumed run only after its queued jobs finish", async () => {
    const runUpdates: unknown[] = [];
    const update = jest.fn(({ data }: { data: unknown }) => {
      runUpdates.push(data);
      return Promise.resolve({});
    });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "run-1",
          targetSchedulerVersion,
          afterUserId: "user-1",
          afterLearningCardId: "card-2",
        },
      ]),
      schedulerMigrationRun: { update },
      userCardState: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationJob: {
        count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0),
      },
    };
    const database = {
      schedulerDefinition: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(
        (callback: (value: typeof transaction) => Promise<number>) =>
          callback(transaction),
      ),
    };

    const worker = new SchedulerMigrationWorker(
      database as never,
      {} as never,
      { report: jest.fn() } as never,
    );
    await expect(worker.drain()).resolves.toBe(0);
    const completion = runUpdates.at(-1) as {
      status: ReconciliationJobStatus;
      completedAt: Date;
    };
    expect(completion.status).toBe(ReconciliationJobStatus.COMPLETED);
    expect(completion.completedAt).toBeInstanceOf(Date);
  });

  describe("deciding whether a run is needed", () => {
    function workerSeeing(range: {
      lowest: string | null;
      highest: string | null;
    }): { worker: SchedulerMigrationWorker; create: jest.Mock } {
      const create = jest.fn().mockResolvedValue({});
      const database = {
        schedulerDefinition: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ version: targetSchedulerVersion }),
        },
        $queryRaw: jest.fn().mockResolvedValue([range]),
        schedulerMigrationRun: {
          findUnique: jest.fn().mockResolvedValue(null),
          create,
        },
        // No run to page through: the drain only decides.
        $transaction: jest.fn((callback: (value: unknown) => Promise<number>) =>
          callback({ $queryRaw: jest.fn().mockResolvedValue([]) }),
        ),
      };
      return {
        worker: new SchedulerMigrationWorker(
          database as never,
          {} as never,
          { report: jest.fn() } as never,
        ),
        create,
      };
    }

    it("starts no run when every state is on the active version", async () => {
      const { worker, create } = workerSeeing({
        lowest: targetSchedulerVersion,
        highest: targetSchedulerVersion,
      });
      await expect(worker.drain()).resolves.toBe(0);
      expect(create).not.toHaveBeenCalled();
    });

    it("starts no run when there are no states at all", async () => {
      const { worker, create } = workerSeeing({ lowest: null, highest: null });
      await expect(worker.drain()).resolves.toBe(0);
      expect(create).not.toHaveBeenCalled();
    });

    it.each([
      ["below", { lowest: "fsrs-v1", highest: targetSchedulerVersion }],
      ["above", { lowest: targetSchedulerVersion, highest: "fsrs-v3" }],
    ])(
      "starts a run when a state is on a version %s the active one",
      async (_side, range) => {
        const { worker, create } = workerSeeing(range);
        await worker.drain();
        expect(create).toHaveBeenCalledWith({
          data: { targetSchedulerVersion },
        });
      },
    );
  });

  describe("polling", () => {
    it("backs off while idle, up to the ceiling", () => {
      const delays: number[] = [];
      let delay = POLL_INTERVAL_MS;
      for (let poll = 0; poll < 10; poll += 1) {
        delay = nextPollDelay(delay, 0);
        delays.push(delay);
      }
      expect(delays.slice(0, 4)).toEqual([4_000, 8_000, 16_000, 32_000]);
      expect(delays.at(-1)).toBe(MAX_IDLE_POLL_INTERVAL_MS);
      expect(Math.max(...delays)).toBe(MAX_IDLE_POLL_INTERVAL_MS);
    });

    it("returns to the base pace as soon as a poll finds work", () => {
      expect(nextPollDelay(MAX_IDLE_POLL_INTERVAL_MS, 1)).toBe(
        POLL_INTERVAL_MS,
      );
    });

    // The backlog heartbeat rides on the poll, and the alert on a silent
    // queue fires after fifteen minutes.
    it("keeps the idle ceiling inside the heartbeat alert window", () => {
      expect(MAX_IDLE_POLL_INTERVAL_MS).toBeLessThan(15 * 60_000);
    });

    describe("on a timer", () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it("waits longer after each idle poll and stops when the module stops", async () => {
        const worker = new SchedulerMigrationWorker(
          {} as never,
          { warn: jest.fn() } as never,
          { report: jest.fn().mockResolvedValue(undefined) } as never,
        );
        const drain = jest.spyOn(worker, "drain").mockResolvedValue(0);

        worker.onModuleInit();
        await jest.advanceTimersByTimeAsync(0);
        expect(drain).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(3_999);
        expect(drain).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(drain).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(7_999);
        expect(drain).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1);
        expect(drain).toHaveBeenCalledTimes(3);

        // A poll that queued a page brings the next one back to two seconds.
        drain.mockResolvedValue(100);
        await jest.advanceTimersByTimeAsync(16_000);
        expect(drain).toHaveBeenCalledTimes(4);
        await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(drain).toHaveBeenCalledTimes(5);

        await worker.onModuleDestroy();
        await jest.advanceTimersByTimeAsync(MAX_IDLE_POLL_INTERVAL_MS);
        expect(drain).toHaveBeenCalledTimes(5);
      });

      it("backs off after a failed poll too", async () => {
        const warn = jest.fn();
        const worker = new SchedulerMigrationWorker(
          {} as never,
          { warn } as never,
          { report: jest.fn().mockResolvedValue(undefined) } as never,
        );
        const drain = jest
          .spyOn(worker, "drain")
          .mockRejectedValue(new Error("database unavailable"));

        worker.onModuleInit();
        await jest.advanceTimersByTimeAsync(0);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "scheduler_migration_worker_poll_failed",
          }),
        );
        await jest.advanceTimersByTimeAsync(3_999);
        expect(drain).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(drain).toHaveBeenCalledTimes(2);
        await worker.onModuleDestroy();
      });
    });
  });
});
