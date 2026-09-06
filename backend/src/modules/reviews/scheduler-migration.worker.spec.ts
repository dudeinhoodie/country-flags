import { ReconciliationJobStatus } from "@prisma/client";

import { SchedulerMigrationWorker } from "./scheduler-migration.worker";

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
});
