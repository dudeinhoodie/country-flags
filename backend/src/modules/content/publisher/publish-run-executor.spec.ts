import {
  PublishRunKind,
  PublishRunStatus,
  type PublishRun,
} from "@prisma/client";

import {
  executePublishRun,
  PublishRunFailure,
  type PublishRunStore,
  type ReleaseWork,
} from "./publish-run-executor";

function queuedRun(overrides: Partial<PublishRun> = {}): PublishRun {
  return {
    id: "d3f6d0f6-0000-4000-8000-000000000001",
    kind: PublishRunKind.PUBLISH,
    status: PublishRunStatus.RUNNING,
    contentVersion: "fixture-v2",
    minimumClientVersion: "0.1.0",
    previousVersion: "fixture-v1",
    stage: "claimed",
    failureCode: null,
    failureMessage: null,
    executionName: null,
    requestedByAdminUserId: "d3f6d0f6-0000-4000-8000-0000000000ff",
    createdAt: new Date("2026-09-06T10:00:00.000Z"),
    startedAt: new Date("2026-09-06T10:00:01.000Z"),
    finishedAt: null,
    ...overrides,
  };
}

/**
 * The store as four spies rather than as a typed mock of the interface: the
 * assertions below read the calls straight off the object, which a method
 * declared on an interface would make an unbound reference to.
 */
interface FakeStore {
  claim: jest.Mock;
  recordStage: jest.Mock;
  recordSuccess: jest.Mock;
  recordFailure: jest.Mock;
}

function storeHolding(run: PublishRun | null): FakeStore {
  return {
    claim: jest.fn().mockResolvedValue(run),
    recordStage: jest.fn().mockResolvedValue(undefined),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };
}

function asStore(store: FakeStore): PublishRunStore {
  return store;
}

interface FakeWork {
  publish: jest.Mock;
  rollback: jest.Mock;
}

function workThat(
  behaviour: Partial<Record<"publish" | "rollback", () => Promise<void>>> = {},
): FakeWork {
  const resolved = (): Promise<void> => Promise.resolve();
  return {
    publish: jest.fn().mockImplementation(behaviour.publish ?? resolved),
    rollback: jest.fn().mockImplementation(behaviour.rollback ?? resolved),
  };
}

function asWork(work: FakeWork): ReleaseWork {
  return work;
}

describe("executing a release run", () => {
  it("does nothing at all when there is no run to take", async () => {
    const store = storeHolding(null);
    const work = workThat();

    await expect(
      executePublishRun(asStore(store), asWork(work)),
    ).resolves.toEqual({
      taken: false,
    });
    expect(work.publish).not.toHaveBeenCalled();
    expect(work.rollback).not.toHaveBeenCalled();
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it("carries out a publish and records the success", async () => {
    const run = queuedRun();
    const store = storeHolding(run);

    await expect(
      executePublishRun(asStore(store), asWork(workThat()), {
        runId: run.id,
        executionName: "executions/content-publisher-dev-abcde",
      }),
    ).resolves.toEqual({ taken: true, run, succeeded: true });
    expect(store.claim).toHaveBeenCalledWith(
      run.id,
      "executions/content-publisher-dev-abcde",
    );
    expect(store.recordSuccess).toHaveBeenCalledWith(run.id);
  });

  it("sends a rollback run to the rollback path", async () => {
    const run = queuedRun({
      kind: PublishRunKind.ROLLBACK,
      minimumClientVersion: null,
    });
    const work = workThat();

    await executePublishRun(asStore(storeHolding(run)), asWork(work));

    expect(work.rollback).toHaveBeenCalledTimes(1);
    expect(work.publish).not.toHaveBeenCalled();
  });

  it("keeps the code a failure names", async () => {
    const run = queuedRun();
    const store = storeHolding(run);

    const outcome = await executePublishRun(
      asStore(store),
      asWork(
        workThat({
          publish: () =>
            Promise.reject(
              new PublishRunFailure(
                "PUBLISH_RUN_BUILD_FAILED",
                "3 blocking report item(s)",
              ),
            ),
        }),
      ),
    );

    expect(outcome).toEqual({ taken: true, run, succeeded: false });
    expect(store.recordFailure).toHaveBeenCalledWith(
      run.id,
      "PUBLISH_RUN_BUILD_FAILED",
      "3 blocking report item(s)",
    );
    expect(store.recordSuccess).not.toHaveBeenCalled();
  });

  it("reports an unexpected error as one, rather than inventing a code", async () => {
    const store = storeHolding(queuedRun());

    await executePublishRun(
      asStore(store),
      asWork(
        workThat({
          publish: () => Promise.reject(new Error("socket hang up")),
        }),
      ),
    );

    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.any(String),
      "PUBLISH_RUN_FAILED",
      "socket hang up",
    );
  });

  it("still reports the run as failed when the failure cannot be recorded", async () => {
    // The database being what broke is exactly when the process has to exit
    // non-zero, so a failed write of the failure must not swallow it.
    const store = storeHolding(queuedRun());
    store.recordFailure.mockRejectedValue(new Error("connection lost"));

    await expect(
      executePublishRun(
        asStore(store),
        asWork(workThat({ publish: () => Promise.reject(new Error("nope")) })),
      ),
    ).resolves.toMatchObject({ taken: true, succeeded: false });
  });

  it("reports the stages the screen is waiting on", async () => {
    const run = queuedRun();
    const store = storeHolding(run);

    await executePublishRun(asStore(store), asWork(workThat({})));
    // The work is a fake here, so nothing is staged by it; what this pins is
    // that the executor hands the work a way to report and does not stage on
    // its behalf.
    expect(store.recordStage).not.toHaveBeenCalled();

    const staging = storeHolding(run);
    await executePublishRun(asStore(staging), {
      publish: async (_run, stage) => {
        await stage("building");
        await stage("applying");
      },
      rollback: () => Promise.resolve(),
    });
    expect(staging.recordStage.mock.calls).toEqual([
      [run.id, "building"],
      [run.id, "applying"],
    ]);
  });
});
