import { PublishRunKind, PublishRunStatus } from "@prisma/client";
import type { AdminUser, PublishRun } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { parseReleaseRollbackRequest } from "./admin-drafts.request";
import { PublishRunService } from "./publish-run.service";
import { PublisherJobClient } from "./publisher-job.client";
import type { AdminAuditService } from "../admin-auth/admin-audit.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";

const actor = { id: "11111111-1111-4111-8111-111111111111" } as AdminUser;

interface Fakes {
  activeVersion?: string | null;
  inFlight?: {
    id: string;
    kind: PublishRunKind;
    contentVersion: string;
  } | null;
  publishedVersions?: string[];
  /** The run `cancel` finds, or null when it should find nothing. */
  storedRun?: {
    id: string;
    status: PublishRunStatus;
    kind: PublishRunKind;
  } | null;
  /** What the executor does when it is asked for an execution. */
  executor?: PublisherJobClient;
}

/** A publisher job that accepts every request and names the execution. */
function executorThatStarts(executionName: string): PublisherJobClient {
  return {
    isConfigured: true,
    start: () => Promise.resolve(executionName),
  } as unknown as PublisherJobClient;
}

/** One that is there and refuses, which is not the same as one that is absent. */
function executorThatRefuses(reason: string): PublisherJobClient {
  return {
    isConfigured: true,
    start: () => Promise.reject(new Error(reason)),
  } as unknown as PublisherJobClient;
}

/** No job configured at all: the run queues and waits for one. */
const noExecutor = new PublisherJobClient(null);

/**
 * One conditional write, kept as the two halves the service sent: the filter
 * is the guard being asserted as much as the data is.
 */
interface Patch {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

/**
 * The service is exercised through the same seam it uses in production: a
 * transaction callback handed a client. What is asserted is the rule — which
 * requests are refused, and what the record says when one is accepted —
 * rather than Prisma's own behaviour.
 */
function serviceWith(fakes: Fakes = {}): {
  service: PublishRunService;
  created: () => Record<string, unknown> | null;
  updated: () => Record<string, unknown> | null;
  audited: () => string | null;
  /** Every `updateMany` the service made, in order. */
  patches: () => Patch[];
} {
  let created: Record<string, unknown> | null = null;
  let updated: Record<string, unknown> | null = null;
  let audited: string | null = null;
  const patches: Patch[] = [];
  const client = {
    contentPointer: {
      findUnique: (): Promise<{ contentVersion: string } | null> =>
        Promise.resolve(
          fakes.activeVersion === undefined || fakes.activeVersion === null
            ? null
            : { contentVersion: fakes.activeVersion },
        ),
    },
    contentRelease: {
      findUnique: ({
        where,
      }: {
        where: { version: string };
      }): Promise<{ publishedAt: Date } | null> =>
        Promise.resolve(
          (fakes.publishedVersions ?? []).includes(where.version)
            ? { publishedAt: new Date("2026-08-20T10:00:00Z") }
            : null,
        ),
    },
    publishRun: {
      findFirst: (): Promise<Fakes["inFlight"]> =>
        Promise.resolve(fakes.inFlight ?? null),
      create: ({
        data,
      }: {
        data: Record<string, unknown>;
      }): Promise<PublishRun> => {
        created = data;
        return Promise.resolve({
          id: "run-1",
          ...data,
        } as unknown as PublishRun);
      },
      findUnique: (): Promise<PublishRun | null> =>
        Promise.resolve(
          (fakes.storedRun ?? null) as unknown as PublishRun | null,
        ),
      update: ({
        data,
      }: {
        data: Record<string, unknown>;
      }): Promise<PublishRun> => {
        updated = data;
        return Promise.resolve({
          ...(fakes.storedRun ?? {}),
          ...data,
        } as unknown as PublishRun);
      },
      updateMany: (patch: Patch): Promise<{ count: number }> => {
        patches.push(patch);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const database = {
    ...client,
    // Prisma's `$transaction` takes either a callback or a list of promises,
    // and this service uses both: a queue writes through the callback, a
    // status reads through the batch.
    $transaction: (
      argument: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[],
    ) => (Array.isArray(argument) ? Promise.all(argument) : argument(client)),
  } as unknown as PrismaService;
  const audit = {
    record: (_tx: unknown, event: { action: string }) => {
      audited = event.action;
      return Promise.resolve();
    },
  } as unknown as AdminAuditService;
  return {
    service: new PublishRunService(
      database,
      audit,
      fakes.executor ?? noExecutor,
    ),
    created: () => created,
    updated: () => updated,
    audited: () => audited,
    patches: () => patches,
  };
}

describe("PublishRunService", () => {
  it("records what a queued publish is for", async () => {
    const { service, created, audited } = serviceWith({
      activeVersion: "2026.08.20",
    });

    const run = await service.publish(
      actor,
      { contentVersion: "2026.08.26", minimumClientVersion: "0.1.0" },
      "req-1",
    );

    expect(run.id).toBe("run-1");
    expect(created()).toMatchObject({
      kind: PublishRunKind.PUBLISH,
      contentVersion: "2026.08.26",
      minimumClientVersion: "0.1.0",
      // The way back, recoverable from the record alone.
      previousVersion: "2026.08.20",
      requestedByAdminUserId: actor.id,
    });
    expect(audited()).toBe("admin.release.publish_queued");
  });

  /// Republishing the live version is a no-op the publisher reports as
  /// success, which teaches an operator that nothing they do matters.
  it("refuses to republish the version that is already live", async () => {
    const { service } = serviceWith({ activeVersion: "2026.08.26" });

    await expect(
      service.publish(
        actor,
        { contentVersion: "2026.08.26", minimumClientVersion: "0.1.0" },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "CONTENT_VERSION_ALREADY_ACTIVE" } },
    });
  });

  /// Answered now rather than after twenty minutes of losing a race over the
  /// active pointer (ADR-017 §4). The reply names the run already under way.
  it("refuses a second run while one is in flight", async () => {
    const { service } = serviceWith({
      activeVersion: "2026.08.20",
      inFlight: {
        id: "run-0",
        kind: PublishRunKind.PUBLISH,
        contentVersion: "2026.08.25",
      },
    });

    await expect(
      service.publish(
        actor,
        { contentVersion: "2026.08.26", minimumClientVersion: "0.1.0" },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: {
        error: {
          code: "PUBLISH_RUN_IN_FLIGHT",
          details: { runId: "run-0" },
        },
      },
    });
  });

  it("queues a rollback to a release this deployment published", async () => {
    const { service, created, audited } = serviceWith({
      activeVersion: "2026.08.26",
      publishedVersions: ["2026.08.20"],
    });

    await service.rollback(actor, { toVersion: "2026.08.20" }, "req-1");

    expect(created()).toMatchObject({
      kind: PublishRunKind.ROLLBACK,
      contentVersion: "2026.08.20",
      previousVersion: "2026.08.26",
      // The release being returned to already carries its own minimum.
      minimumClientVersion: null,
    });
    expect(audited()).toBe("admin.release.rollback_queued");
  });

  /// A version that was never applied would point clients at nothing.
  it("refuses a rollback to a version that was never published", async () => {
    const { service } = serviceWith({
      activeVersion: "2026.08.26",
      publishedVersions: [],
    });

    await expect(
      service.rollback(actor, { toVersion: "2026.08.01" }, "req-1"),
    ).rejects.toMatchObject({
      response: { error: { code: "CONTENT_VERSION_NOT_PUBLISHED" } },
    });
  });

  /// The request records the run and the job carries it out (ADR-017 §2), so
  /// the handle the job answers with is stamped on the record: it is what an
  /// operator pastes into a log query for a run that failed outside our own
  /// reporting.
  it("records the execution the publisher job started", async () => {
    const { service, patches } = serviceWith({
      activeVersion: "2026.08.20",
      executor: executorThatStarts(
        "projects/p/locations/europe-west3/jobs/content-publisher-dev/executions/x-9",
      ),
    });

    const run = await service.publish(
      actor,
      { contentVersion: "2026.08.26", minimumClientVersion: "0.1.0" },
      "req-1",
    );

    expect(run.executionName).toBe(
      "projects/p/locations/europe-west3/jobs/content-publisher-dev/executions/x-9",
    );
    expect(patches()).toEqual([
      {
        where: { id: "run-1" },
        data: {
          executionName:
            "projects/p/locations/europe-west3/jobs/content-publisher-dev/executions/x-9",
        },
      },
    ]);
  });

  /// A run holds the only live slot. One that could not be started and is
  /// left queued would block every release after it, with the database as
  /// the only remedy — so the refusal is recorded on the run instead.
  it("fails a run the publisher job refused to start", async () => {
    const { service, patches } = serviceWith({
      activeVersion: "2026.08.20",
      executor: executorThatRefuses("Cloud Run refused to start the job"),
    });

    await service.publish(
      actor,
      { contentVersion: "2026.08.26", minimumClientVersion: "0.1.0" },
      "req-1",
    );

    expect(patches()).toEqual([
      {
        // Only while it is still queued: a start that failed on the way back
        // may well have started, and a job already running must not be
        // declared dead by the request that asked for it.
        where: { id: "run-1", status: PublishRunStatus.QUEUED },
        data: expect.objectContaining({
          status: PublishRunStatus.FAILED,
          failureCode: "PUBLISH_RUN_NOT_STARTED",
          failureMessage: "Cloud Run refused to start the job",
        }) as unknown,
      },
    ]);
  });

  /// A deployment with no job is a normal state, not a broken one: the run
  /// waits, the console says nothing is draining the queue, and cancelling
  /// is the way out.
  it("leaves the run queued when no publisher job is configured", async () => {
    const { service, patches } = serviceWith({ activeVersion: "2026.08.20" });

    const run = await service.publish(
      actor,
      { contentVersion: "2026.08.26", minimumClientVersion: "0.1.0" },
      "req-1",
    );

    expect(run.executionName).toBeUndefined();
    expect(patches()).toEqual([]);
  });

  it("says whether anything is there to drain the queue", async () => {
    const configured = await serviceWith({
      executor: executorThatStarts("x"),
    }).service.status();
    const absent = await serviceWith().service.status();

    expect(configured.executorConfigured).toBe(true);
    expect(absent.executorConfigured).toBe(false);
  });

  it("reports the run in flight beside what is live", async () => {
    const { service } = serviceWith({
      activeVersion: "2026.08.26",
      inFlight: {
        id: "run-0",
        kind: PublishRunKind.PUBLISH,
        contentVersion: "2026.08.27",
      },
    });

    const status = await service.status();

    expect(status.activeVersion).toBe("2026.08.26");
    expect(status.current?.id).toBe("run-0");
  });
});

describe("PublishRunStatus", () => {
  it("names the states a watcher has to tell apart", () => {
    expect(Object.values(PublishRunStatus)).toEqual([
      "QUEUED",
      "RUNNING",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
    ]);
  });
});

/**
 * A rollback names a version and nothing else.
 *
 * Accepting a minimum client version here would let an operator change what
 * an already-published release demands of a client without republishing it,
 * which is a way to lock every installed app out of content that is already
 * live.
 */
describe("parseReleaseRollbackRequest", () => {
  it("reads the version to return to", () => {
    expect(parseReleaseRollbackRequest({ toVersion: "fixture-v2.2" })).toEqual({
      toVersion: "fixture-v2.2",
    });
  });

  it("refuses a minimum client version smuggled alongside it", () => {
    expect(() =>
      parseReleaseRollbackRequest({
        toVersion: "fixture-v2.2",
        minimumClientVersion: "9.9.9",
      }),
    ).toThrow(ApiException);
  });

  it.each([{}, { toVersion: "" }, { toVersion: "../etc/passwd" }])(
    "refuses a malformed request %#",
    (body) => {
      expect(() => parseReleaseRollbackRequest(body)).toThrow(ApiException);
    },
  );
});

/**
 * Giving up on a queued run.
 *
 * A run holds the only live slot, so one nothing picks up would block every
 * release after it. This is the way out, and it is deliberately narrow.
 */
describe("PublishRunService.cancel", () => {
  it("cancels a queued run and stamps when it ended", async () => {
    const { service, updated, audited } = serviceWith({
      storedRun: {
        id: "run-1",
        status: PublishRunStatus.QUEUED,
        kind: PublishRunKind.PUBLISH,
      },
    });

    await service.cancel(actor, "run-1", "request-1");

    expect(updated()).toMatchObject({ status: PublishRunStatus.CANCELLED });
    expect(updated()?.finishedAt).toBeInstanceOf(Date);
    expect(audited()).toBe("admin.release.run_cancelled");
  });

  /// A running job has already started, and cancelling the record under it
  /// would leave the two disagreeing about what happened.
  it("refuses a run that has already started", async () => {
    const { service, updated } = serviceWith({
      storedRun: {
        id: "run-1",
        status: PublishRunStatus.RUNNING,
        kind: PublishRunKind.PUBLISH,
      },
    });

    await expect(service.cancel(actor, "run-1", "request-1")).rejects.toThrow(
      ApiException,
    );
    expect(updated()).toBeNull();
  });

  it("refuses a run that is already finished", async () => {
    const { service } = serviceWith({
      storedRun: {
        id: "run-1",
        status: PublishRunStatus.SUCCEEDED,
        kind: PublishRunKind.ROLLBACK,
      },
    });

    await expect(service.cancel(actor, "run-1", "request-1")).rejects.toThrow(
      ApiException,
    );
  });

  it("says a run it cannot find is missing", async () => {
    const { service } = serviceWith({ storedRun: null });

    await expect(service.cancel(actor, "run-1", "request-1")).rejects.toThrow(
      ApiException,
    );
  });
});
